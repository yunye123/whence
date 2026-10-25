import { VIDEO_IMPORT_TERMINAL, type FieldVideoImportsAPI, type VideoImportInput, type VideoImportOptions, type VideoImportTask } from '../native/contracts';
import type { CardData } from './model';
import { copyNativeCardMedia } from './native';

export * from '../native/contracts';

const POLL_MS = 1_500;
const SUBMIT_TIMEOUT_MS = 60_000;
const WAIT_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const CANCEL_TIMEOUT_MS = 15_000;
type Listener = (task: VideoImportTask) => void;
type MediaCopy = { mediaId?: string; poster?: string; nativeMediaWarning?: string };
interface Hub {
  latest: Map<string, VideoImportTask>;
  listeners: Set<Listener>;
  copies: Map<string, { promise: Promise<void>; patch?: MediaCopy }>;
  unsubscribe?: () => void;
}
const hubs = new WeakMap<FieldVideoImportsAPI, Hub>();

export function isVideoImportAvailable(): boolean {
  const backend = typeof window === 'undefined' ? undefined : window.fieldVideoImports;
  return !!backend && ['submit', 'list', 'cancel', 'retry', 'onTask'].every(key => typeof backend[key as keyof FieldVideoImportsAPI] === 'function');
}

function api(): FieldVideoImportsAPI {
  if (!isVideoImportAvailable()) throw new Error('视频链接下载与本机转写需要最新版来处桌面版，请在桌面版中打开此画布。');
  return window.fieldVideoImports!;
}
function hubFor(backend: FieldVideoImportsAPI): Hub {
  let hub = hubs.get(backend);
  if (!hub) { hub = { latest: new Map(), listeners: new Set(), copies: new Map() }; hubs.set(backend, hub); }
  return hub;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function abortError(detail = '视频导入已取消。'): Error { return new DOMException(detail, 'AbortError'); }
function mediaKey(card?: Partial<CardData>): string | undefined {
  if (!card?.url?.startsWith('media:') || (card.kind !== 'video' && card.kind !== 'image')) return undefined;
  return card.nativeProjectId && card.nativeAssetId ? JSON.stringify([card.nativeProjectId, card.nativeAssetId]) : card.url;
}
function withCopy(hub: Hub, task: VideoImportTask): VideoImportTask {
  const key = mediaKey(task.card);
  const patch = key && hub.copies.get(key)?.patch;
  return patch && task.card ? { ...task, card: { ...task.card, ...patch } } : task;
}
function emit(hub: Hub, task: VideoImportTask): void {
  const decorated = withCopy(hub, task);
  for (const listener of [...hub.listeners]) {
    try { listener(decorated); }
    catch (error) { console.error('视频导入状态监听失败：', error); }
  }
}
function copyInBackground(hub: Hub, task: VideoImportTask): void {
  const key = mediaKey(task.card);
  if (!key || !task.card || task.card.mediaId || hub.copies.has(key)) return;
  const entry: { promise: Promise<void>; patch?: MediaCopy } = { promise: Promise.resolve() };
  hub.copies.set(key, entry);
  // Playback uses the native URL immediately. The optional portable copy never gates ASR.
  entry.promise = Promise.resolve().then(() => copyNativeCardMedia(task.card!)).then(result => {
    const patch: MediaCopy = {};
    if (typeof result.mediaId === 'string') patch.mediaId = result.mediaId;
    if (typeof result.poster === 'string') patch.poster = result.poster;
    if (typeof result.nativeMediaWarning === 'string') patch.nativeMediaWarning = result.nativeMediaWarning;
    entry.patch = patch;
  }, error => {
    entry.patch = { nativeMediaWarning: `素材副本未保存，仍可使用桌面原始素材。${message(error)}` };
    console.warn('视频素材副本保存失败：', error);
  }).then(() => {
    // Read the newest task, never the card captured before an ASR result arrived.
    for (const latest of hub.latest.values()) if (mediaKey(latest.card) === key) emit(hub, latest);
  });
}
function accept(hub: Hub, incoming: VideoImportTask, notify: boolean): VideoImportTask {
  const previous = hub.latest.get(incoming.id);
  if (previous && (incoming.attempt < previous.attempt || (incoming.attempt === previous.attempt &&
    (incoming.updatedAt < previous.updatedAt || (VIDEO_IMPORT_TERMINAL.has(previous.status) && !VIDEO_IMPORT_TERMINAL.has(incoming.status)))))) {
    return withCopy(hub, previous);
  }
  hub.latest.set(incoming.id, incoming);
  if (notify) { emit(hub, incoming); copyInBackground(hub, incoming); }
  return withCopy(hub, incoming);
}

/** Persistent backend snapshots, including any portable media already copied this session. */
export async function listVideoImports(): Promise<VideoImportTask[]> {
  const backend = api(), hub = hubFor(backend);
  return (await backend.list()).map(task => accept(hub, task, false));
}

/** Independent of an import promise or active board; the caller controls subscription lifetime. */
export function subscribeVideoImports(listener: Listener): () => void {
  const backend = api(), hub = hubFor(backend);
  hub.listeners.add(listener);
  try {
    if (!hub.unsubscribe) hub.unsubscribe = backend.onTask(task => { accept(hub, task, true); });
  } catch (error) { hub.listeners.delete(listener); throw error; }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    hub.listeners.delete(listener);
    if (!hub.listeners.size) { const unsubscribe = hub.unsubscribe; hub.unsubscribe = undefined; unsubscribe?.(); }
  };
}

export async function cancelVideoImport(taskId: string, expectedAttempt?: number): Promise<VideoImportTask> {
  const backend = api();
  return accept(hubFor(backend), await backend.cancel(taskId, expectedAttempt), true);
}
export async function retryVideoImport(taskId: string): Promise<VideoImportTask> {
  const backend = api();
  return accept(hubFor(backend), await backend.retry(taskId), true);
}

/** Import one node's video, exposing playable media while transcription continues in the backend. */
export async function importVideoLink(input: VideoImportInput, options: VideoImportOptions = {}): Promise<Partial<CardData>> {
  const backend = api();
  if (options.signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    let submitted: VideoImportTask | undefined;
    let settled = false, abortRequested = false, cancelling = false, polling = false;
    let unsubscribe = () => {};
    let poll: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelTimeout: ReturnType<typeof setTimeout> | undefined;
    let lastMediaSignature: string | undefined;
    let missingPolls = 0;
    const early = new Map<string, VideoImportTask>();
    const finish = (error?: Error, card?: Partial<CardData>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout); clearTimeout(cancelTimeout); clearInterval(poll);
      options.signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      if (error) reject(error); else resolve(card!);
    };
    const observe = (task: VideoImportTask) => {
      if (settled || abortRequested) return;
      if (!submitted) {
        if (task.boardId === input.boardId && task.nodeId === input.nodeId) early.set(task.id, task);
        return;
      }
      if (task.id !== submitted.id || task.attempt < submitted.attempt) return;
      if (task.attempt > submitted.attempt) { finish(new Error('这次导入已被新的重试替代，请查看卡片上的最新任务。')); return; }
      if (task.boardId !== input.boardId || task.nodeId !== input.nodeId) {
        finish(new Error('桌面服务返回的导入任务属于其他卡片，已停止等待，未取消该任务。')); return;
      }
      try {
        options.onProgress?.({ stage: task.status, progress: task.progress, message: task.message, jobId: task.id, attempt: task.attempt });
        if (task.card) {
          const signature = JSON.stringify([task.card.nativeProjectId, task.card.nativeAssetId, task.card.url, task.card.mediaId, task.card.poster, task.card.nativeMediaWarning]);
          if (lastMediaSignature !== signature && task.card.kind !== 'note') { lastMediaSignature = signature; options.onMediaReady?.(task.card); }
        }
      } catch (error) { finish(new Error(`处理视频导入状态失败：${message(error)}`)); return; }
      if (settled || abortRequested) return;
      if (task.status === 'completed') {
        try { options.onComplete?.(task); }
        catch (error) { finish(new Error(`处理图文导入结果失败：${message(error)}`)); return; }
        if (!task.card) finish(new Error('视频导入已结束，但桌面服务没有返回媒体卡片。'));
        else finish(undefined, task.card);
      } else if (task.status === 'cancelled') finish(abortError(task.error || task.message || undefined));
      else if (task.status === 'failed' || task.status === 'interrupted') finish(new Error(task.error || task.message || '视频导入未完成，请重试。'));
    };
    const cancelOwned = async (task: VideoImportTask) => {
      if (cancelling) return;
      cancelling = true;
      cancelTimeout = setTimeout(() => finish(abortError('取消请求等待超时，请在任务列表确认后台是否已停止。')), CANCEL_TIMEOUT_MS);
      try {
        // Reused media may be shared, but cancellation must only address this node's exact attempt.
        if (task.boardId !== input.boardId || task.nodeId !== input.nodeId) {
          finish(abortError('返回的任务属于其他卡片，已停止等待且未取消其他卡片的任务。')); return;
        }
        if (!VIDEO_IMPORT_TERMINAL.has(task.status)) {
          accept(hubFor(backend), await backend.cancel(task.id, task.attempt), true);
        }
        finish(abortError());
      } catch (error) { finish(abortError(`取消未获桌面服务确认：${message(error)}。请在任务列表查看后台状态。`)); }
      finally { clearTimeout(cancelTimeout); }
    };
    function onAbort() {
      if (settled) return;
      abortRequested = true;
      if (submitted) void cancelOwned(submitted);
      // If submit is still in flight, its result identifies the one task we are allowed to cancel.
    }
    const pollOnce = async () => {
      if (polling || settled || abortRequested || !submitted) return;
      polling = true;
      try {
        const tasks = await backend.list();
        if (settled || abortRequested) return;
        const found = tasks.find(task => task.id === submitted!.id);
        if (found) { missingPolls = 0; observe(accept(hubFor(backend), found, true)); }
        else if (++missingPolls >= 3) finish(new Error('桌面任务列表中找不到本次导入，请查看任务列表后重试。'));
      } catch (error) {
        if (!abortRequested) finish(new Error(`无法读取后台导入状态：${message(error)}。任务可能仍在运行，请查看任务列表。`));
      }
      finally { polling = false; }
    };
    try {
      // Register before submit: a fast cached import can emit its completion inside submit itself.
      unsubscribe = subscribeVideoImports(observe);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => finish(abortRequested ? abortError('提交任务仍未返回，取消状态尚未确认。') : new Error('桌面服务提交视频导入超时，请查看任务列表。')), SUBMIT_TIMEOUT_MS);
      void backend.submit(input).then(task => {
        submitted = task;
        if (abortRequested) { void cancelOwned(task); return; }
        if (settled) return;
        clearTimeout(timeout);
        timeout = setTimeout(() => finish(new Error('等待视频下载或转写超过 2 小时，后台任务仍可继续，请在任务列表查看进度。')), WAIT_TIMEOUT_MS);
        const cached = early.get(task.id);
        early.clear();
        // accept chooses the newest version if an event beat the submit response.
        if (cached) accept(hubFor(backend), cached, false);
        observe(accept(hubFor(backend), task, true));
        if (!settled) { poll = setInterval(() => { void pollOnce(); }, POLL_MS); void pollOnce(); }
      }, error => finish(abortRequested ? abortError(`提交过程中取消：${message(error)}`) : new Error(`视频导入提交失败：${message(error)}`)));
    } catch (error) { finish(new Error(`无法连接视频导入服务：${message(error)}`)); }
  });
}

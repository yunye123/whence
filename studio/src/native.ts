import type { Asset, Job, ProjectState, StudioAPI, Transcript } from '../../shared/types';
import type { Board, BoardNode, CardData, TranscriptLine } from './model';
import { getMedia, getNativeMedia, saveMedia, saveNativeMedia } from './storage';
import type {} from '../native/contracts';
import { readingLines } from '../native/transcript-sentences';

const COPY_LIMIT = 64 * 1024 * 1024;
const MATERIAL_PROJECT_KEY = 'field-native-material-project-v1';
const noop = (_message: string) => {};
type Progress = (message: string) => void;
let operation: Promise<unknown> = Promise.resolve();

/** The desktop API is absent in a normal browser. Browser imports never claim ASR support. */
export function isNative(): boolean {
  return typeof window !== 'undefined' && typeof window.studio?.getState === 'function';
}
function api(): StudioAPI {
  if (!isNative()) throw new Error('本机转写和导入原有素材库需要使用来处桌面版。');
  return window.studio;
}
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = operation.then(run, run);
  operation = next.catch(() => {});
  return next;
}
const normalizedDirectory = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
async function ensureProject(node: BoardNode): Promise<ProjectState> {
  const studio = api();
  const { nativeProjectId, nativeDirectory } = node.data;
  if (!nativeProjectId || !nativeDirectory) throw new Error('这张卡片没有本机素材来源，请在桌面版导入后再转写。');
  if (window.fieldVideoImports) {
    const library = await window.fieldVideoImports.libraryState();
    if (library.id === nativeProjectId && normalizedDirectory(library.directory) === normalizedDirectory(nativeDirectory)) return library;
  }
  let state = await studio.getState();
  if (state?.id !== nativeProjectId || normalizedDirectory(state.directory) !== normalizedDirectory(nativeDirectory)) {
    state = await studio.openProject(nativeDirectory);
  }
  if (!state || state.id !== nativeProjectId || normalizedDirectory(state.directory) !== normalizedDirectory(nativeDirectory)) {
    throw new Error('原有素材库与卡片记录不一致，请重新导入对应的素材库。');
  }
  return state;
}

/** Needed before playing large native files that could not be copied into the new workspace. */
export function ensureNativeProject(node: BoardNode): Promise<ProjectState> {
  return serial(() => ensureProject(node));
}

function plainText(html: string): string {
  // A template is inert: imported scripts, handlers, iframes and images never enter the live DOM.
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,iframe,object,embed,noscript').forEach(el => el.remove());
  template.content.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  template.content.querySelectorAll('p,div,li,h1,h2,h3,h4,blockquote').forEach(el => el.append('\n'));
  return (template.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
/** CORE-06: reading lines regrouped from word times (no word split across lines); proofread segments stay whole. */
function lines(transcript: Transcript, state: ProjectState): TranscriptLine[] {
  return readingLines(transcript.segments, state.content.corrections);
}
function latestTranscript(state: ProjectState, assetId: string): Transcript | undefined {
  return state.transcripts.filter(t => t.assetId === assetId).at(-1);
}
function provenance(state: ProjectState): Pick<CardData, 'nativeDirectory' | 'nativeProjectId'> {
  return { nativeProjectId: state.id, nativeDirectory: state.directory };
}
function assetData(state: ProjectState, asset: Asset): CardData {
  const transcript = latestTranscript(state, asset.id);
  const source = state.sources.find(item => item.id === asset.sourceId);
  return {
    kind: asset.kind, title: asset.name,
    body: state.content.imageNotes[asset.id] ?? '',
    url: api().mediaUrl(state.id, asset.proxy || asset.path),
    poster: asset.poster ? api().mediaUrl(state.id, asset.poster) : undefined,
    duration: asset.durationMs / 1000, transcript: transcript ? lines(transcript, state) : undefined,
    ...provenance(state), nativeAssetId: asset.id, nativeSourceId: asset.sourceId,
    nativeTranscriptId: transcript?.id, nativeHasAudio: asset.hasAudio,
    sourceUrl: source?.url, sourceTitle: source?.title, sourceAuthor: source?.author,
    sourceOriginalText: source?.originalText, nativeCapture: asset.capture,
  };
}

async function readNativeBlob(url: string, limit: number): Promise<Blob> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`素材读取失败 (${response.status})`);
    const length = Number(response.headers.get('content-length'));
    if (length > limit) { await response.body?.cancel(); throw new Error('素材超过 64 MB，仍从原有素材库读取'); }
    // Bound streamed reads as well when the backend does not supply a Content-Length.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('素材没有可读数据');
    const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('素材超过 64 MB，仍从原有素材库读取'); }
      chunks.push(new Uint8Array(result.value));
    }
    return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' });
  } finally { clearTimeout(timeout); }
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function copyMedia(nodes: BoardNode[], onProgress: Progress): Promise<void> {
  const cache = new Map<string, { mediaId?: string; poster?: string; nativeMediaWarning?: string }>();
  for (const node of nodes) {
    if (!['video', 'image'].includes(node.data.kind) || !node.data.url?.startsWith('media:')) continue;
    const url = node.data.url;
    const previous = cache.get(url);
    if (previous) { Object.assign(node.data, previous); continue; }
    const result: { mediaId?: string; poster?: string; nativeMediaWarning?: string } = {};
    onProgress(`正在保存素材副本：${node.data.title}`);
    try {
      const { nativeProjectId, nativeAssetId } = node.data;
      const cached = nativeProjectId && nativeAssetId ? await getNativeMedia(nativeProjectId, nativeAssetId) : undefined;
      if (cached) result.mediaId = cached.id;
      else {
        const blob = await readNativeBlob(url, COPY_LIMIT);
        result.mediaId = nativeProjectId && nativeAssetId
          ? (await saveNativeMedia(blob, node.data.title, nativeProjectId, nativeAssetId)).id
          : (await saveMedia(blob, node.data.title)).id;
      }
    } catch (error) {
      result.nativeMediaWarning = `素材仍保存在原有素材库中；便携画布文件暂未包含媒体副本。${error instanceof Error ? error.message : String(error)}`;
      onProgress(`${node.data.title}：${result.nativeMediaWarning}`);
    }
    if (node.data.poster?.startsWith('media:')) {
      try { result.poster = await dataUrl(await readNativeBlob(node.data.poster, 2 * 1024 * 1024)); }
      catch { result.poster = undefined; }
    }
    Object.assign(node.data, result); cache.set(url, result);
  }
}

/** Optional portable copy; native video playback does not wait for this operation. */
export async function copyNativeCardMedia(patch: Partial<CardData>): Promise<Partial<CardData>> {
  if (!patch.url?.startsWith('media:') || (patch.kind !== 'video' && patch.kind !== 'image')) return {};
  const node: BoardNode = { id: crypto.randomUUID(), type: 'card', position: { x: 0, y: 0 }, data: {
    ...patch, kind: patch.kind, title: patch.title || '导入媒体', body: patch.body || '',
  } };
  await copyMedia([node], noop);
  return Object.fromEntries(Object.entries({ mediaId: node.data.mediaId, poster: node.data.poster, nativeMediaWarning: node.data.nativeMediaWarning }).filter(([, value]) => value !== undefined));
}

async function mapProject(state: ProjectState, onProgress: Progress): Promise<Board> {
  const nodes: BoardNode[] = [];
  const entityNodes = new Map<string, string>();
  for (const item of state.content.nodes) if (!entityNodes.has(item.entityId)) entityNodes.set(item.entityId, item.id);
  // Preserve sources for excerpts even when the old asset card was removed from its canvas.
  for (const asset of state.assets) if (!entityNodes.has(asset.id)) entityNodes.set(asset.id, `native-${state.id}-${asset.id}`);
  const mediaNode = (asset: Asset, id: string, position: { x: number; y: number }, width = 400): BoardNode => ({
    id, type: 'card', position, style: { width }, data: { ...assetData(state, asset), nativeNodeId: id, nativeEntityId: asset.id },
  });
  for (const item of state.content.nodes) {
    let data: CardData | undefined;
    if (item.type === 'video' || item.type === 'image') {
      const asset = state.assets.find(a => a.id === item.entityId);
      if (asset) { nodes.push(mediaNode(asset, item.id, { x: item.x, y: item.y }, item.width)); continue; }
    } else if (item.type === 'draft') {
      const draft = state.content.drafts.find(d => d.id === item.entityId);
      if (draft) data = {
        kind: 'draft', title: draft.title, body: plainText(draft.html),
        draftVersions: draft.versions.map(v => ({ id: v.id, title: v.title, body: plainText(v.html), createdAt: v.createdAt })),
      };
    } else if (item.type === 'excerpt') {
      const excerpt = state.content.excerpts.find(e => e.id === item.entityId);
      const asset = excerpt && state.assets.find(a => a.id === excerpt.assetId);
      if (excerpt) data = {
        kind: 'quote', title: asset?.name || '原文摘录', body: excerpt.quote, tone: 'butter',
        citation: { nodeId: entityNodes.get(excerpt.assetId) || '', title: asset?.name || '来源视频',
          start: excerpt.ranges[0]?.startMs === undefined ? undefined : excerpt.ranges[0].startMs / 1000,
          end: excerpt.ranges.at(-1)?.endMs === undefined ? undefined : excerpt.ranges.at(-1)!.endMs / 1000, text: excerpt.quote },
        nativeAssetId: excerpt.assetId, nativeTranscriptId: excerpt.transcriptId,
        nativeSegmentIds: excerpt.segmentIds, nativeWordIds: excerpt.wordIds, nativeRanges: excerpt.ranges,
        excerptNote: excerpt.note,
      };
    } else if (item.type === 'source') {
      const source = state.sources.find(s => s.id === item.entityId);
      if (source) data = {
        kind: 'link', title: source.title || source.platform || '链接资料', body: source.originalText,
        url: source.url, nativeSourceId: source.id, sourceAuthor: source.author, sourceStatus: source.status,
      };
    }
    if (data) nodes.push({ id: item.id, type: 'card', position: { x: item.x, y: item.y }, style: { width: item.width },
      data: { ...data, ...provenance(state), nativeNodeId: item.id, nativeEntityId: item.entityId, nativeGroup: item.group } });
  }
  for (const asset of state.assets) if (!nodes.some(n => n.data.nativeAssetId === asset.id && ['video', 'image'].includes(n.data.kind))) {
    nodes.push(mediaNode(asset, entityNodes.get(asset.id)!, { x: (nodes.length % 3) * 460, y: 500 + Math.floor(nodes.length / 3) * 380 }));
  }
  await copyMedia(nodes, onProgress);
  return {
    id: crypto.randomUUID(), title: state.name, description: '从原有素材库导入的独立画布', category: 'video',
    createdAt: state.createdAt, updatedAt: new Date().toISOString(), nodes,
    edges: nodes.filter(n => n.data.citation?.nodeId && nodes.some(s => s.id === n.data.citation!.nodeId)).map(n => ({
      id: `citation-${n.id}`, source: n.data.citation!.nodeId, target: n.id, label: '摘录来源',
    })), viewport: { ...state.content.viewport },
  };
}

/** Opens the old project through its native picker; never calls saveContent on that project. */
export function importNativeProject(onProgress: Progress = noop): Promise<Board | null> {
  return serial(async () => {
    const state = await api().openProject();
    if (!state) return null;
    onProgress('正在读取原有素材库与来源记录');
    return mapProject(state, onProgress);
  });
}

function waitForJobs(studio: StudioAPI, projectId: string, ids: Set<string>, onProgress: Progress, timeoutMs: number): Promise<ProjectState> {
  return new Promise((resolve, reject) => {
    let settled = false; let polling = false; let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout>; let poll: ReturnType<typeof setInterval>;
    const finish = (error?: Error, state?: ProjectState) => {
      if (settled) return; settled = true; unsubscribe(); clearTimeout(timer); clearInterval(poll);
      if (error) reject(error); else resolve(state!);
    };
    const observe = (state: ProjectState | null) => {
      if (settled) return;
      if (!state || state.id !== projectId) { finish(new Error('原有素材库已切换，请重新执行。')); return; }
      const jobs = state.jobs.filter(j => ids.has(j.id));
      const active = jobs.find(j => j.status === 'running') || jobs.find(j => j.status === 'queued');
      if (active) onProgress(`${active.message} · ${Math.round(active.progress)}%`);
      if (jobs.length === ids.size && jobs.every(j => !['queued', 'running'].includes(j.status))) finish(undefined, state);
    };
    unsubscribe = studio.onState(observe);
    timer = setTimeout(() => finish(new Error('等待后台任务超时。任务可能仍在桌面后台运行，请稍后再看。')), timeoutMs);
    poll = setInterval(() => {
      if (polling || settled) return;
      polling = true;
      studio.getState().then(observe, error => finish(new Error(String(error)))).finally(() => { polling = false; });
    }, 1_000);
    void studio.getState().then(observe, error => finish(new Error(String(error))));
  });
}
function jobFailure(jobs: Job[]): string {
  return jobs.filter(j => j.status !== 'completed').map(j => j.error || j.message || `任务${j.status}`).join('；');
}

async function waitManagedTranscript(taskId: string, onProgress: Progress): Promise<TranscriptLine[]> {
  const service = window.fieldVideoImports!;
  let task = (await service.list()).find(item => item.id === taskId);
  if (!task) throw new Error('找不到来处视频任务，请重新粘贴来源链接。');
  if (['failed', 'cancelled', 'interrupted'].includes(task.status)) task = await service.retry(task.id);
  return new Promise((resolve, reject) => {
    let settled = false; let off = () => {};
    let timer: ReturnType<typeof setTimeout>; let poll: ReturnType<typeof setInterval>;
    const finish = (error?: Error, result?: TranscriptLine[]) => {
      if (settled) return; settled = true; off(); clearTimeout(timer); clearInterval(poll);
      if (error) reject(error); else resolve(result || []);
    };
    const observe = (value: NonNullable<typeof task>) => {
      if (settled || value.id !== taskId) return;
      onProgress(value.message);
      if (value.status === 'completed') finish(undefined, value.card?.transcript);
      else if (['failed', 'cancelled', 'interrupted'].includes(value.status)) finish(new Error(value.error || value.message));
    };
    off = service.onTask(observe);
    timer = setTimeout(() => finish(new Error('等待逐字稿超时；视频任务仍保存在本机，可在卡片上查看进度。')), 60 * 60 * 1000);
    poll = setInterval(() => { void service.list().then(items => { const latest = items.find(item => item.id === taskId); if (latest) observe(latest); }, error => finish(new Error(String(error)))); }, 1500);
    observe(task!);
  });
}

export function transcribeNative(node: BoardNode, onProgress: Progress = noop): Promise<TranscriptLine[]> {
  return serial(async () => {
    const studio = api();
    const state = await ensureProject(node);
    const asset = state.assets.find(a => a.id === node.data.nativeAssetId);
    if (!asset || asset.kind !== 'video') throw new Error('找不到原视频，请重新导入。');
    if (!asset.hasAudio) throw new Error('这条视频没有音轨，无法进行语音转写。');
    if (window.fieldVideoImports && state.id === (await window.fieldVideoImports.libraryState()).id) {
      const tasks = await window.fieldVideoImports.list();
      const managedTask = tasks.find(task => task.id === node.data.nativeImportJobId) || tasks.find(task => task.assetId === asset.id);
      if (managedTask) return waitManagedTranscript(managedTask.id, onProgress);
      const transcript = latestTranscript(state, asset.id);
      if (transcript) return lines(transcript, state);
      throw new Error('原素材仍可播放，但没有对应的转写任务。请重新粘贴来源链接生成逐字稿。');
    }
    const before = new Set(state.jobs.map(j => j.id));
    const existing = state.jobs.find(j => j.kind === 'transcribe' && j.assetId === asset.id && ['queued', 'running'].includes(j.status));
    onProgress(existing ? '正在等待这条视频已有的转写任务' : '已提交本机转写任务');
    if (!existing) await studio.transcribe(asset.id);
    const started = await studio.getState();
    if (!started || started.id !== state.id) throw new Error('原有素材库已切换，请重新生成逐字稿。');
    const ids = new Set(started.jobs.filter(j => j.kind === 'transcribe' && j.assetId === asset.id && (j.id === existing?.id || !before.has(j.id))).map(j => j.id));
    if (!ids.size) throw new Error('桌面服务没有创建转写任务。');
    const completed = await waitForJobs(studio, state.id, ids, onProgress, 60 * 60 * 1_000);
    const failure = jobFailure(completed.jobs.filter(j => ids.has(j.id)));
    if (failure) throw new Error(`转写未完成：${failure}`);
    const transcript = latestTranscript(completed, asset.id);
    if (!transcript) throw new Error('任务已结束，但没有可用转写结果。');
    onProgress('本机转写已完成');
    return lines(transcript, completed);
  });
}

/** Ordinary file paste/import stays playable in IndexedDB; ASR starts only from this explicit action. */
export async function transcribePastedVideo(node: BoardNode, boardId: string, onProgress: Progress = noop): Promise<Partial<CardData>> {
  const service = window.fieldVideoImports; if (!service?.submitLocal) throw new Error('请使用新版来处桌面版生成本机逐字稿。');
  const record = node.data.mediaId ? await getMedia(node.data.mediaId) : undefined;
  if (!record) throw new Error('找不到粘贴的视频素材，请重新导入。');
  onProgress('正在准备本机视频');
  const task = await service.submitLocal({ boardId, nodeId: node.id, name: record.name, data: new Uint8Array(await record.blob.arrayBuffer()) });
  const transcript = await waitManagedTranscript(task.id, onProgress);
  const completed = (await service.list()).find(item => item.id === task.id);
  if (!completed?.card) throw new Error('任务已结束，但没有可用视频记录。');
  return { ...completed.card, transcript };
}

export function importNativeFiles(onProgress: Progress = noop): Promise<BoardNode[]> {
  return serial(async () => {
    const studio = api();
    let before = await studio.getState();
    // importFiles itself appends nodes in the legacy database. Keep those writes in a
    // dedicated materials project, never in a project that was opened for migration.
    let materials: { id: string; directory: string } | null = null;
    try { materials = JSON.parse(localStorage.getItem(MATERIAL_PROJECT_KEY) || 'null'); } catch { /* Use a fresh materials project. */ }
    if (materials?.id && materials.directory && (before?.id !== materials.id || normalizedDirectory(before.directory) !== normalizedDirectory(materials.directory))) {
      try { before = await studio.openProject(materials.directory); }
      catch { before = null; }
    }
    if (!materials || !before || before.id !== materials.id) {
      onProgress('先选择素材库的保存位置');
      before = await studio.createProject(`来处素材-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
      if (!before) return [];
      localStorage.setItem(MATERIAL_PROJECT_KEY, JSON.stringify({ id: before.id, directory: before.directory }));
    }
    const oldJobs = new Set(before.jobs.map(j => j.id));
    const oldAssets = new Set(before.assets.map(a => a.id));
    await studio.importFiles();
    const started = await studio.getState();
    if (!started || started.id !== before.id) throw new Error('原有素材库已切换，请重试。');
    const ids = new Set(started.jobs.filter(j => j.kind === 'import' && !oldJobs.has(j.id)).map(j => j.id));
    if (!ids.size) return []; // File picker was cancelled.
    const completed = await waitForJobs(studio, started.id, ids, onProgress, 20 * 60 * 1_000);
    const assets = completed.assets.filter(a => !oldAssets.has(a.id));
    const failure = jobFailure(completed.jobs.filter(j => ids.has(j.id)));
    if (failure && !assets.length) throw new Error(`素材导入未完成：${failure}`);
    const nodes: BoardNode[] = assets.map((asset, index) => ({
      id: crypto.randomUUID(), type: 'card', position: { x: (index % 3) * 440, y: Math.floor(index / 3) * 360 },
      style: { width: 400 }, data: assetData(completed, asset),
    }));
    await copyMedia(nodes, onProgress);
    onProgress(failure ? `已导入 ${nodes.length} 个素材；部分失败：${failure}` : `已导入 ${nodes.length} 个素材`);
    return nodes;
  });
}

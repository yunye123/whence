import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Asset, Diagnostics, Segment, Source, Transcript } from '../shared/types';

export interface ToolPaths { python: string; ffmpeg: string; ffprobe: string; model: string }
const EMPTY_SAVED: ToolPaths = { python: '', ffmpeg: '', ffprobe: '', model: '' };
let savedToolPaths: ToolPaths = { ...EMPTY_SAVED };

/** Paths chosen in 本机工具. Blank fields fall through to the environment, then the platform default. */
export function setSavedToolPaths(saved: Partial<ToolPaths> | null): void {
  savedToolPaths = {
    python: saved?.python?.trim() || '',
    ffmpeg: saved?.ffmpeg?.trim() || '',
    ffprobe: saved?.ffprobe?.trim() || '',
    model: saved?.model?.trim() || '',
  };
}
export interface MediaOptions { signal?: AbortSignal; onProgress?: (n: number, message: string) => void }
type Imported = Omit<Asset, 'id' | 'createdAt' | 'sourceId'>;
const abort = () => Object.assign(new Error('任务已取消'), { name: 'AbortError' });
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abort(); }
const relative = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

/** A path saved in 本机工具 wins, then CANVAS_PYTHON and the other CANVAS_* variables, then the installer runtime, then the platform default. Does not launch anything. */
/** A file inside CANVAS_RUNTIME, when the installer placed it there. */
export function bundledRuntimeFile(env: NodeJS.ProcessEnv, ...parts: string[]): string {
  const root = env.CANVAS_RUNTIME?.trim();
  if (!root || parts.some(part => !part || part === '.' || part === '..')) return '';
  const file = path.join(root, ...parts);
  return existsSync(file) ? file : '';
}

export function toolPaths(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir(), ignoreSaved = false): ToolPaths {
  const windows = platform === 'win32';
  const saved = ignoreSaved ? EMPTY_SAVED : savedToolPaths;
  const pick = (chosen: string, fromEnv: string | undefined, bundled: string, fallback: string) => chosen.trim() || fromEnv?.trim() || bundled || fallback;
  const bundledModel = bundledRuntimeFile(env, 'models', 'faster-whisper', 'large-v3', 'model.bin');
  return {
    python: pick(saved.python, env.CANVAS_PYTHON, bundledRuntimeFile(env, 'python', windows ? 'python.exe' : 'bin/python3'), windows ? path.join(home, 'AppData/Local/Programs/Python/Python312/python.exe') : 'python3'),
    ffmpeg: pick(saved.ffmpeg, env.CANVAS_FFMPEG, bundledRuntimeFile(env, 'ffmpeg', windows ? 'ffmpeg.exe' : 'ffmpeg'), windows ? path.join(home, 'AppData/Local/Programs/ffmpeg/bin/ffmpeg.exe') : 'ffmpeg'),
    ffprobe: pick(saved.ffprobe, env.CANVAS_FFPROBE, bundledRuntimeFile(env, 'ffmpeg', windows ? 'ffprobe.exe' : 'ffprobe'), windows ? path.join(home, 'AppData/Local/Programs/ffmpeg/bin/ffprobe.exe') : 'ffprobe'),
    model: pick(saved.model, env.CANVAS_MODEL, bundledModel ? path.dirname(bundledModel) : '', path.join(home, '.cache/faster-whisper/large-v3')),
  };
}

export function runProcess(command: string, args: string[], options: MediaOptions & { onLine?: (line: string) => void; maxOutput?: number } = {}): Promise<string> {
  checkAbort(options.signal);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    let stdout = '', stderr = '', lineBuffer = '', cancelled = false, parseError: unknown;
    const stop = () => {
      cancelled = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        killer.on('error', () => child.kill());
        killer.on('close', code => { if (code !== 0) child.kill(); });
      } else child.kill('SIGKILL');
    };
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) stop();
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!options.onLine) stdout = (stdout + chunk).slice(-(options.maxOutput || 8_000_000));
      else {
        lineBuffer += chunk;
        const lines = lineBuffer.split(/\r?\n/); lineBuffer = lines.pop() || '';
        try { for (const line of lines) if (line.trim()) options.onLine(line); }
        catch (error) { parseError = error; stop(); }
      }
    });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-6000); });
    child.on('error', error => { options.signal?.removeEventListener('abort', stop); reject(error); });
    child.on('close', code => {
      options.signal?.removeEventListener('abort', stop);
      if (parseError) return reject(parseError);
      if (cancelled) return reject(abort());
      try { if (options.onLine && lineBuffer.trim()) options.onLine(lineBuffer); }
      catch (error) { return reject(error); }
      if (code !== 0) reject(new Error(`${path.basename(command)} 执行失败 (${code})：${stderr || stdout}`));
      else resolve(stdout);
    });
  });
}

export async function detectTools(): Promise<Diagnostics> {
  const tools = toolPaths();
  const checks: Diagnostics['checks'] = [];
  await Promise.all([
    ['Python', tools.python, ['--version']], ['FFmpeg', tools.ffmpeg, ['-version']], ['ffprobe', tools.ffprobe, ['-version']],
  ].map(async ([name, command, args]) => {
    try { const result = await runProcess(command as string, args as string[]); checks.push({ name: name as string, ok: true, detail: result.split('\n')[0] }); }
    catch (error) { checks.push({ name: name as string, ok: false, detail: String(error) }); }
  }));
  try {
    const result = await runProcess(tools.python, ['-c', 'import importlib.metadata as m, ctranslate2; print("faster-whisper="+m.version("faster-whisper")+", ctranslate2="+m.version("ctranslate2")+", CUDA devices="+str(ctranslate2.get_cuda_device_count()))']);
    checks.push({ name: '转写依赖', ok: true, detail: result.trim() + '（未验证模型推理）' });
  } catch (error) { checks.push({ name: '转写依赖', ok: false, detail: String(error) }); }
  const present = ['model.bin', 'config.json', 'tokenizer.json'].every(name => existsSync(path.join(tools.model, name)));
  checks.push({ name: '本地模型', ok: present, detail: tools.model + '（仅文件存在性检查）' });
  let downloader = false;
  try { const result = await runProcess(tools.python, ['-m', 'yt_dlp', '--version']); downloader = true; checks.push({ name: '链接下载器', ok: true, detail: result.trim() }); }
  catch (error) { checks.push({ name: '链接下载器', ok: false, detail: `下载器检查失败：${String(error)}；可手动导入素材` }); }
  return { ...tools, downloader, checks };
}

interface ProbeStream { codec_type: string; codec_name?: string; width?: number; height?: number; start_time?: string; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }
interface Probe { streams: ProbeStream[]; format: { duration?: string; start_time?: string; format_name?: string } }
async function probe(file: string, tools: ToolPaths, options: MediaOptions): Promise<Probe> {
  const result = JSON.parse(await runProcess(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], options));
  if (!Array.isArray(result.streams)) throw new Error('无法读取媒体轨道');
  return result;
}
async function renderImage(tools: ToolPaths, args: string[], destination: string, options: MediaOptions) {
  if (existsSync(destination)) return;
  const temporary = path.join(path.dirname(destination), `${randomUUID()}${path.extname(destination)}`);
  try {
    await runProcess(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, temporary], options);
    const output = await stat(temporary);
    if (!output.size) throw new Error('没有生成有效图片');
    checkAbort(options.signal);
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}
function safeAssetPath(projectDir: string, assetPath: string) {
  const root = path.resolve(projectDir), resolved = path.resolve(root, assetPath);
  if (!resolved.startsWith(root + path.sep)) throw new Error('素材路径超出项目目录');
  return resolved;
}

export async function importMedia(inputPath: string, projectDir: string, options: MediaOptions = {}): Promise<Imported> {
  checkAbort(options.signal);
  const tools = toolPaths();
  const metadata = await probe(inputPath, tools, options);
  const video = metadata.streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error('该文件不包含可用画面，请导入视频或图片');
  const image = /\.(png|jpe?g|webp|bmp|tiff?|avif)$/i.test(inputPath);
  const size = (await stat(inputPath)).size;
  const mediaDir = path.join(projectDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const temporary = path.join(mediaDir, `.${randomUUID()}.part`);
  const hash = createHash('sha256'); let transferred = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    hash.update(chunk); transferred += chunk.length;
    options.onProgress?.(5 + 25 * transferred / Math.max(size, 1), '正在复制素材'); callback(null, chunk);
  } });
  let file = '';
  try {
    await pipeline(createReadStream(inputPath), meter, createWriteStream(temporary), { signal: options.signal });
    const digest = hash.digest('hex');
    const extension = path.extname(inputPath).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin';
    file = path.join(mediaDir, digest + extension);
    const existing = (await readdir(mediaDir)).find(name => name.startsWith(digest + '.'));
    if (existing) file = path.join(mediaDir, existing);
    if (existsSync(file)) await rm(temporary); else await rename(temporary, file);
    const rotation = Math.abs(Number(video.side_data_list?.find(x => x.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0)) % 180;
    const width = rotation === 90 ? video.height || 0 : video.width || 0;
    const height = rotation === 90 ? video.width || 0 : video.height || 0;
    const durationMs = image ? 0 : Math.max(0, Math.round(Number(metadata.format?.duration || video.duration || 0) * 1000));
    if (!image && !Number.isFinite(durationMs)) throw new Error('视频时长无效');
    const hasAudio = !image && metadata.streams.some(s => s.codec_type === 'audio');
    const output: Imported = { name: path.basename(inputPath), kind: image ? 'image' : 'video', path: relative(projectDir, file), hash: digest, durationMs, hasAudio, width, height, thumbnails: [] };
    const cacheDir = path.join(projectDir, 'cache', digest); await mkdir(cacheDir, { recursive: true });
    const poster = path.join(cacheDir, 'poster.jpg');
    await renderImage(tools, ['-i', file, '-frames:v', '1', '-vf', 'scale=640:-2'], poster, options);
    output.poster = relative(projectDir, poster);
    if (!image) {
      const count = Math.min(12, Math.max(1, Math.ceil(durationMs / 15000)));
      for (let i = 0; i < count; i++) {
        checkAbort(options.signal);
        const thumb = path.join(cacheDir, `thumb-${i}.jpg`);
        await renderImage(tools, ['-ss', String(i * durationMs / count / 1000), '-i', file, '-frames:v', '1', '-vf', 'scale=240:-2'], thumb, options);
        output.thumbnails.push(relative(projectDir, thumb));
      }
      const audio = metadata.streams.find(s => s.codec_type === 'audio');
      const webVideo = ['h264', 'vp8', 'vp9', 'av1'].includes(video.codec_name || '');
      const webAudio = !audio || ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(audio.codec_name || '');
      const webContainer = /\.(mp4|m4v|mov|webm)$/i.test(inputPath);
      if (!webVideo || !webAudio || !webContainer) {
        options.onProgress?.(60, '生成兼容播放预览，保留原视频');
        const proxy = path.join(cacheDir, 'preview.mp4');
        if (!existsSync(proxy)) {
          const partial = path.join(cacheDir, `preview-${randomUUID()}.mp4`);
          try {
            await runProcess(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-movflags', '+faststart', partial], options);
            await rename(partial, proxy);
          } finally { await rm(partial, { force: true }); }
        }
        output.proxy = relative(projectDir, proxy);
      }
    }
    options.onProgress?.(100, image ? '图片导入完成' : hasAudio ? '视频导入完成' : '视频导入完成（无音轨）');
    return output;
  } finally { await rm(temporary, { force: true }); }
}

export function splitReadingSegments(rawSegments: Segment[]): Segment[] {
  return rawSegments.flatMap(segment => {
    if (!segment.words.length) return [segment];
    // Locate the original text exactly: punctuation/whitespace are preserved, not regenerated.
    const ends: number[] = []; let cursor = 0;
    for (const word of segment.words) {
      if (!word.text) return [segment];
      const at = segment.text.indexOf(word.text, cursor);
      if (at < 0) return [segment];
      cursor = at + word.text.length; ends.push(cursor);
    }
    const blocks: Segment[] = []; let firstWord = 0, firstChar = 0;
    for (let i = 0; i < segment.words.length; i++) {
      const word = segment.words[i], next = segment.words[i + 1];
      const boundary = !next || /[。！？!?；;，,][”’"']?\s*$/.test(word.text) || next.startMs - word.endMs >= 450 || word.endMs - segment.words[firstWord].startMs >= 8000;
      if (!boundary) continue;
      const lastChar = next ? ends[i] : segment.text.length;
      blocks.push({ id: `${segment.id}-r${blocks.length}`, text: segment.text.slice(firstChar, lastChar), startMs: segment.words[firstWord].startMs, endMs: word.endMs, words: segment.words.slice(firstWord, i + 1) });
      firstWord = i + 1; firstChar = lastChar;
    }
    return blocks.length > 1 ? blocks : [segment];
  });
}

export function validateTranscript(value: unknown, durationMs: number): Omit<Transcript, 'id' | 'assetId' | 'createdAt'> {
  const data = value as Omit<Transcript, 'id' | 'assetId' | 'createdAt'>;
  if (!data || !Array.isArray(data.segments) || typeof data.device !== 'string' || typeof data.engine !== 'string' || !Number.isFinite(data.elapsedSeconds)) throw new Error('转写结果结构不完整');
  const validTime = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= durationMs + 1000;
  let lastStart = -1;
  for (const segment of data.segments) {
    if (!validTime(segment.startMs, segment.endMs) || segment.startMs < lastStart || typeof segment.text !== 'string' || !Array.isArray(segment.words)) throw new Error('转写句子缺少有效起止时间');
    lastStart = segment.startMs;
    let lastWordStart = segment.startMs - 100;
    for (const word of segment.words) {
      if (!validTime(word.startMs, word.endMs) || typeof word.text !== 'string' || word.startMs < lastWordStart || word.startMs < segment.startMs - 100 || word.endMs > segment.endMs + 100) throw new Error('转写词语缺少有效起止时间');
      lastWordStart = word.startMs;
    }
  }
  return { engine: data.engine, device: data.device, elapsedSeconds: data.elapsedSeconds, rawSegments: data.rawSegments || data.segments, segments: splitReadingSegments(data.segments) };
}

export function withTranscriptRevision(transcript: Omit<Transcript, 'id' | 'assetId' | 'createdAt'>): Omit<Transcript, 'id' | 'assetId' | 'createdAt'> {
  const revision = randomUUID();
  const ids = new Map<string, string>();
  const scopedId = (id: string) => {
    if (!ids.has(id)) ids.set(id, `${revision}:${id}`);
    return ids.get(id)!;
  };
  const mapSegment = (segment: Segment): Segment => ({
    ...segment, id: scopedId(segment.id),
    words: segment.words.map(word => ({ ...word, id: scopedId(word.id) })),
  });
  // One namespace covers both representations so original word references stay identical.
  return { ...transcript, rawSegments: transcript.rawSegments?.map(mapSegment), segments: transcript.segments.map(mapSegment) };
}

export async function transcribeMedia(asset: Asset, projectDir: string, tools: ToolPaths, options: MediaOptions & { cpu?: boolean } = {}): Promise<Omit<Transcript, 'id' | 'assetId' | 'createdAt'>> {
  if (!asset.hasAudio) throw new Error('该视频没有音轨，无法转写');
  const input = safeAssetPath(projectDir, asset.path);
  const metadata = await probe(input, tools, options);
  const audio = metadata.streams.find(s => s.codec_type === 'audio');
  if (!audio) throw new Error('该视频没有音轨，无法转写');
  const offsetMs = Math.round((Number(audio.start_time || 0) - Number(metadata.format?.start_time || 0)) * 1000);
  const tmp = path.join(projectDir, 'cache', 'jobs'); await mkdir(tmp, { recursive: true });
  const wav = path.join(tmp, `${randomUUID()}.wav`);
  const worker = process.env.CANVAS_WORKER || path.join(process.env.CANVAS_WORKER_DIR || path.join(process.cwd(), 'workers'), 'transcribe.py');
  let result: unknown; let workerError = '';
  try {
    options.onProgress?.(1, '提取音频');
    await runProcess(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], options);
    const args = [worker, '--input', wav, '--model', tools.model, '--offset-ms', String(offsetMs)];
    if (options.cpu) args.push('--cpu');
    await runProcess(tools.python, args, { ...options, onLine(line) {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'progress') options.onProgress?.(Math.round(message.progress * 100), message.message);
      else if (message.type === 'result') result = message;
      else if (message.type === 'error') workerError = message.message;
    } });
    if (!result) throw new Error(workerError || '转写进程未返回完整结果');
    return withTranscriptRevision(validateTranscript(result, asset.durationMs));
  } finally { await rm(wav, { force: true }); }
}

export async function captureFrame(asset: Asset, projectDir: string, timeMs: number, options: MediaOptions = {}): Promise<Imported> {
  if (asset.kind !== 'video' || !Number.isFinite(timeMs) || timeMs < 0 || timeMs > asset.durationMs) throw new Error('截图时间超出视频范围');
  const tools = toolPaths(); const tmp = path.join(projectDir, 'cache', 'jobs'); await mkdir(tmp, { recursive: true });
  const screenshot = path.join(tmp, `${path.parse(asset.name).name}-${Math.round(timeMs)}ms-${randomUUID()}.png`);
  try {
    await runProcess(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.min(timeMs, Math.max(0, asset.durationMs - 50)) / 1000), '-i', safeAssetPath(projectDir, asset.path), '-frames:v', '1', screenshot], options);
    return await importMedia(screenshot, projectDir, options);
  } finally { await rm(screenshot, { force: true }); }
}

export function parseSource(text: string): Partial<Source> {
  const match = text.match(/https?:\/\/[^\s<>"'，。；！？）)]+/i);
  if (!match) throw new Error('没有找到分享链接');
  const url = new URL(match[0]);
  const allowed = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);
  const platform = allowed(url.hostname, 'douyin.com') ? '抖音' : allowed(url.hostname, 'xiaohongshu.com') || allowed(url.hostname, 'xhslink.com') ? '小红书' : '';
  if (!platform || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('目前支持抖音和小红书分享链接；其他素材请下载后导入');
  return { url: url.href, originalText: text, platform, title: `${platform}参考`, author: '', status: 'pending' };
}

export async function resolveLink(text: string, projectDir: string, options: MediaOptions = {}): Promise<{ source: Partial<Source>; filePath: string }> {
  const source = parseSource(text); const tools = toolPaths();
  const tmp = path.join(projectDir, 'cache', 'downloads', randomUUID()); await mkdir(tmp, { recursive: true });
  try {
    options.onProgress?.(5, '解析分享链接');
    const output = await runProcess(tools.python, ['-m', 'yt_dlp', '--no-config', '--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '25', '--retries', '1', '--max-filesize', '2G', '--ffmpeg-location', path.dirname(tools.ffmpeg), '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '-o', path.join(tmp, 'source.%(ext)s'), '--print', 'after_move:%(filepath)s', '--write-info-json', '--', source.url!], options);
    const candidates = output.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const filePath = candidates.reverse().find(file => path.resolve(file).startsWith(path.resolve(tmp) + path.sep) && existsSync(file));
    if (!filePath) throw new Error('下载器没有返回视频文件，链接可能需要登录或暂不支持');
    const metadata = await probe(filePath, tools, options);
    if (!metadata.streams.some(s => s.codec_type === 'video') || !metadata.streams.some(s => s.codec_type === 'audio')) throw new Error('链接未获得完整音视频素材，请手动下载后导入');
    const infoFile = (await readdir(tmp)).find(name => name.endsWith('.info.json'));
    if (infoFile) {
      const { readFile } = await import('node:fs/promises');
      const info = JSON.parse(await readFile(path.join(tmp, infoFile), 'utf8'));
      source.title = info.title || source.title; source.author = info.uploader || info.creator || ''; source.contentId = info.id;
    }
    source.status = 'resolved'; options.onProgress?.(95, '已获取素材，正在导入');
    return { source, filePath };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { meta: { ...source, status: 'failed', error: String(error) } });
  }
}

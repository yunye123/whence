import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import * as yazl from 'yazl';
import * as yauzl from 'yauzl';
import TurndownService from 'turndown';
import type { ProjectState, Transcript } from '../shared/types';
import { DATABASE_NAME, ProjectStore, resolveProjectPath, safeRelativePath, validateProjectState } from './store';

const FORMAT = 'yunye-reference-canvas';
const escapeMarkdown = (value: string) => value.replace(/([\\`*_{}\[\]()#+\-.!>~|])/g, '\\$1');
type FileRecord = { path: string; size: number; sha256: string };
type Manifest = { format: typeof FORMAT; version: 1; files: FileRecord[] };

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function exists(file: string): Promise<boolean> { try { await fs.access(file); return true; } catch { return false; } }
async function removeOwnedTree(directory: string, parent: string, prefix: string): Promise<void> {
  const absolute = path.resolve(directory);
  if (path.dirname(absolute) !== path.resolve(parent) || !path.basename(absolute).startsWith(prefix)) throw new Error('拒绝清理未知目录');
  await fs.rm(absolute, { recursive: true, force: true });
}
async function safeFile(root: string, relative: string): Promise<string> {
  const file = resolveProjectPath(root, relative);
  let cursor = root;
  for (const part of safeRelativePath(relative).split('/')) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error(`素材不支持符号链接：${relative}`);
  }
  if (!(await fs.stat(file)).isFile()) throw new Error(`素材不是文件：${relative}`);
  return file;
}
const srtTime = (ms: number) => {
  const n = Math.round(ms);
  return `${String(Math.floor(n / 3_600_000)).padStart(2, '0')}:${String(Math.floor(n / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')},${String(n % 1000).padStart(3, '0')}`;
};
function transcriptFor(state: ProjectState, id: string): Transcript | undefined {
  return state.transcripts.find(t => t.id === id) ?? [...state.transcripts].reverse().find(t => t.assetId === id);
}
function htmlText(html: string, markdown: boolean, state: ProjectState): string {
  const converter = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  converter.remove(['script', 'style', 'iframe']);
  if (!markdown) {
    converter.addRule('plain-inline', { filter: ['strong', 'b', 'em', 'i', 'del', 's', 'code', 'a'], replacement: content => content });
    converter.addRule('plain-heading', { filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], replacement: content => `\n\n${content}\n\n` });
    converter.addRule('plain-image', { filter: 'img', replacement: (_content, node) => node.getAttribute('alt') ?? '' });
  }
  // Exported documents must retain understandable provenance outside this app.
  converter.addRule('source-reference', {
    filter: node => node.nodeName === 'A' && Boolean(node.getAttribute('href')?.startsWith('studio-excerpt:')),
    replacement: (content, node) => {
      const excerpt = state.content.excerpts.find(e => e.id === node.getAttribute('href')?.slice('studio-excerpt:'.length));
      const asset = state.assets.find(a => a.id === excerpt?.assetId);
      const source = state.sources.find(s => s.id === asset?.sourceId);
      const label = `${content}（${asset?.name || '原素材'}）`;
      const url = source?.url && /^https?:\/\//.test(source.url) ? source.url : undefined;
      return markdown && url ? `[${escapeMarkdown(label)}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : `${label}${url ? ` ${url}` : ' · 本地项目素材'}`;
    }
  });
  const result = converter.turndown(html);
  return markdown ? result : result.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1');
}

export async function exportDocument(state: ProjectState, kind: 'txt' | 'md' | 'srt', id: string, destination: string): Promise<string> {
  validateProjectState(state);
  const target = path.resolve(destination);
  const protectedFiles = [DATABASE_NAME, 'project.previous.sqlite', ...state.assets.flatMap(a => [a.path, a.poster, a.proxy, ...a.thumbnails].filter((p): p is string => !!p))];
  if (protectedFiles.some(p => resolveProjectPath(state.directory, p).toLowerCase() === target.toLowerCase())) throw new Error('导出不能覆盖项目数据库或素材');
  let body: string;
  if (kind === 'srt') {
    const transcript = transcriptFor(state, id);
    if (!transcript || !transcript.segments.length) throw new Error('只有实际转录及其时间戳可以导出 SRT');
    if (transcript.segments.some(s => s.endMs <= s.startMs)) throw new Error('转录包含无效时间范围，不能导出 SRT');
    body = transcript.segments.map((s, i) => `${i + 1}\n${srtTime(s.startMs)} --> ${srtTime(s.endMs)}\n${(state.content.corrections[s.id] ?? s.text).replace(/\r\n?/g, '\n').replace(/\n\s*\n/g, '\n').trim()}\n`).join('\n');
  } else if (kind === 'txt' || kind === 'md') {
    const draft = state.content.drafts.find(d => d.id === id);
    const excerpt = state.content.excerpts.find(e => e.id === id);
    const transcript = transcriptFor(state, id);
    if (draft) body = `${kind === 'md' ? '# ' + escapeMarkdown(draft.title) : draft.title}\n\n${htmlText(draft.html, kind === 'md', state)}\n`;
    else if (excerpt) body = `${excerpt.quote}\n${excerpt.note ? `\n${excerpt.note}\n` : ''}`;
    else if (transcript) body = transcript.segments.map(s => state.content.corrections[s.id] ?? s.text).join('\n') + '\n';
    else throw new Error('未找到可导出的稿件、摘取或转录');
  } else throw new Error('不支持的导出格式');
  const temp = path.join(path.dirname(target), `.document-${randomUUID()}.tmp`);
  try { await fs.writeFile(temp, body, { encoding: 'utf8', flag: 'wx' }); await fs.rename(temp, target); return target; }
  finally { await fs.rm(temp, { force: true }); }
}

export async function exportProject(store: ProjectStore, destinationZip: string): Promise<string> {
  const target = path.resolve(destinationZip);
  const root = store.directory;
  if ([DATABASE_NAME, 'project.previous.sqlite'].some(p => path.join(root, p).toLowerCase() === target.toLowerCase())) throw new Error('项目包不能覆盖数据库');
  const owned = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-export-'));
  const temporary = path.join(path.dirname(target), `.export-${randomUUID()}.zip`);
  try {
    const snapshot = path.join(owned, DATABASE_NAME);
    await store.backup(snapshot);
    const db = new DatabaseSync(snapshot, { readOnly: true });
    let state: ProjectState;
    try { state = JSON.parse((db.prepare('SELECT body FROM document WHERE id=1').get() as { body: string }).body); validateProjectState(state); }
    finally { db.close(); }
    const paths = new Map<string, { path: string; file: string }>();
    paths.set(DATABASE_NAME, { path: DATABASE_NAME, file: snapshot });
    for (const asset of state.assets) {
      const original = safeRelativePath(asset.path);
      if (['project.sqlite', 'manifest.json', 'project.previous.sqlite'].includes(original.toLowerCase())) throw new Error('素材路径与项目文件冲突');
      const candidates = [{ relative: original, required: true }, ...[asset.poster, asset.proxy, ...asset.thumbnails].filter((p): p is string => !!p).map(relative => ({ relative: safeRelativePath(relative), required: false }))];
      for (const { relative, required } of candidates) {
        if (['project.sqlite', 'manifest.json', 'project.previous.sqlite'].includes(relative.toLowerCase())) throw new Error('派生素材路径与项目文件冲突');
        const key = relative.toLowerCase();
        if (paths.has(key)) { if (paths.get(key)!.path !== relative) throw new Error('素材路径大小写冲突'); continue; }
        const local = resolveProjectPath(root, relative);
        if (!await exists(local)) { if (required) throw new Error(`原始素材缺失，无法完整备份：${relative}`); continue; }
        paths.set(key, { path: relative, file: await safeFile(root, relative) });
      }
    }
    if ([...paths.values()].some(p => path.resolve(p.file).toLowerCase() === target.toLowerCase())) throw new Error('不能用项目包覆盖原始素材');
    const records: FileRecord[] = [];
    for (const p of paths.values()) records.push({ path: p.path, size: (await fs.stat(p.file)).size, sha256: await hashFile(p.file) });
    const manifest: Manifest = { format: FORMAT, version: 1, files: records };
    const zip = new yazl.ZipFile();
    const output = zip.outputStream as Readable;
    // Media is streamed directly from disk. Only the small manifest is buffered.
    const writing = pipeline(output, createWriteStream(temporary, { flags: 'wx' }));
    zip.on('error', error => output.destroy(error));
    try {
      for (const p of paths.values()) zip.addFile(p.file, p.path, { compress: p.path === DATABASE_NAME });
      zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
      zip.end();
      await writing;
    } catch (error) { output.destroy(); await writing.catch(() => {}); throw error; }
    await fs.rename(temporary, target);
    return target;
  } finally {
    await fs.rm(temporary, { force: true });
    await removeOwnedTree(owned, os.tmpdir(), 'reference-export-');
  }
}

async function extractArchive(archive: string, target: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('无法读取项目包')); return; }
      const paths: string[] = [];
      const names = new Set<string>();
      let total = 0;
      let settled = false;
      const fail = (err: unknown) => { if (!settled) { settled = true; zip.close(); reject(err); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!settled) { settled = true; resolve(paths); } });
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          const isDirectory = entry.fileName.endsWith('/');
          const relative = safeRelativePath(isDirectory ? entry.fileName.slice(0, -1) : entry.fileName);
          const fileMode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (fileMode && fileMode !== 0o100000 && fileMode !== 0o040000) throw new Error('项目包包含符号链接或特殊文件');
          if (entry.generalPurposeBitFlag & 1) throw new Error('不支持加密项目包');
          const key = relative.toLowerCase();
          if (names.has(key)) throw new Error('项目包包含重复路径');
          names.add(key);
          total += entry.uncompressedSize;
          if (names.size > 20_000 || total > 500 * 1024 ** 3) throw new Error('项目包超过恢复限制');
          if (relative === 'manifest.json' && entry.uncompressedSize > 5 * 1024 ** 2) throw new Error('项目包清单过大');
          const destination = resolveProjectPath(target, relative);
          if (isDirectory) { await fs.mkdir(destination, { recursive: true }); zip.readEntry(); return; }
          await fs.mkdir(path.dirname(destination), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(entry, (err, readable) => err || !readable ? rej(err ?? new Error('无法读取项目包条目')) : res(readable)));
          await pipeline(stream, createWriteStream(destination, { flags: 'wx' }));
          paths.push(relative);
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}

export async function restoreProject(archive: string, destination: string): Promise<ProjectStore> {
  const target = path.resolve(destination);
  if (await exists(target) && (await fs.readdir(target)).length) throw new Error('恢复目标必须为空目录，不会覆盖现有文件');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const prefix = '.reference-restore-';
  const staging = await fs.mkdtemp(path.join(path.dirname(target), prefix));
  let installed = false;
  try {
    const extracted = await extractArchive(path.resolve(archive), staging);
    if (!extracted.includes('manifest.json')) throw new Error('项目包缺少校验清单');
    const manifest = JSON.parse(await fs.readFile(path.join(staging, 'manifest.json'), 'utf8')) as Manifest;
    if (manifest.format !== FORMAT || manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('不支持的项目包版本');
    const expected = new Set<string>(['manifest.json']);
    for (const record of manifest.files) {
      const relative = safeRelativePath(record.path);
      if (expected.has(relative) || !Number.isSafeInteger(record.size) || record.size < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('项目包校验清单无效');
      expected.add(relative);
      const file = await safeFile(staging, relative);
      if ((await fs.stat(file)).size !== record.size || await hashFile(file) !== record.sha256) throw new Error(`项目包文件校验失败：${relative}`);
    }
    if (!expected.has(DATABASE_NAME) || extracted.some(p => !expected.has(p)) || expected.size !== extracted.length) throw new Error('项目包文件与清单不一致');
    // Inspect before opening: opening intentionally changes directory and interrupted jobs.
    const db = new DatabaseSync(path.join(staging, DATABASE_NAME), { readOnly: true });
    let state: ProjectState;
    try { state = JSON.parse((db.prepare('SELECT body FROM document WHERE id=1').get() as { body: string }).body); validateProjectState(state); }
    finally { db.close(); }
    for (const asset of state.assets) {
      if (!expected.has(safeRelativePath(asset.path))) throw new Error(`项目包缺少原始素材：${asset.path}`);
      await safeFile(staging, asset.path);
    }
    // Missing caches are intentionally allowed; clear their paths so the UI falls back cleanly.
    for (const asset of state.assets) {
      if (asset.poster && !expected.has(safeRelativePath(asset.poster))) asset.poster = undefined;
      if (asset.proxy && !expected.has(safeRelativePath(asset.proxy))) asset.proxy = undefined;
      asset.thumbnails = asset.thumbnails.filter(p => expected.has(safeRelativePath(p)));
    }
    const writable = new DatabaseSync(path.join(staging, DATABASE_NAME));
    try { writable.exec('PRAGMA synchronous=FULL'); writable.prepare('UPDATE document SET body=? WHERE id=1').run(JSON.stringify(state)); }
    finally { writable.close(); }
    if (await exists(target)) { if ((await fs.readdir(target)).length) throw new Error('恢复目标在操作期间被写入，已停止'); await fs.rmdir(target); }
    await fs.rename(staging, target);
    installed = true;
    return ProjectStore.open(target);
  } finally { if (!installed) await removeOwnedTree(staging, path.dirname(target), prefix); }
}

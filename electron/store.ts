import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Content, ProjectState } from '../shared/types';

export const DATABASE_NAME = 'project.sqlite';
const PREVIOUS_NAME = 'project.previous.sqlite';
const fail = (message: string): never => { throw new Error(`项目数据无效：${message}`); };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown) => typeof v === 'string';
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const list = (v: unknown): any[] => { if (!Array.isArray(v)) fail('缺少列表'); return v as any[]; };

/** Relative project paths are portable and cannot escape a project after restoration. */
export function safeRelativePath(value: string): string {
  if (!string(value) || !value || /[\x00-\x1f]/.test(value) || /^[\\/]/.test(value) || /^[a-z]:/i.test(value)) fail('素材路径必须为项目内相对路径');
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').some(p => !p || p === '.' || p === '..' || /[:<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) fail('素材路径包含不安全名称');
  return normalized;
}

export function resolveProjectPath(directory: string, relative: string): string {
  const root = path.resolve(directory);
  const target = path.resolve(root, ...safeRelativePath(relative).split('/'));
  if (!target.startsWith(root + path.sep)) fail('素材路径超出项目');
  return target;
}

export function validateProjectState(value: unknown): asserts value is ProjectState {
  if (!object(value) || value.schemaVersion !== 1) fail('不支持的 schemaVersion');
  const s = value as Record<string, any>;
  if (![s.id, s.name, s.directory, s.createdAt, s.updatedAt].every(string) || !s.id || !s.name.trim() || !Number.isSafeInteger(s.revision) || s.revision < 0) fail('项目基本字段');
  const ids = (items: any[], label: string) => {
    const seen = new Set<string>();
    for (const item of items) { if (!object(item) || !string(item.id) || !item.id || seen.has(item.id)) fail(`${label} ID 缺失或重复`); seen.add(item.id); }
  };
  for (const key of ['assets', 'sources', 'transcripts', 'jobs']) ids(list(s[key]), key);
  for (const a of s.assets) {
    if (!['video', 'image'].includes(a.kind) || ![a.name, a.hash, a.createdAt, a.path].every(string) || ![a.durationMs, a.width, a.height].every(finite) || a.durationMs < 0 || typeof a.hasAudio !== 'boolean') fail('素材字段');
    safeRelativePath(a.path);
    for (const p of [...list(a.thumbnails), a.poster, a.proxy].filter(p => p !== undefined)) safeRelativePath(p);
  }
  for (const source of s.sources) if (![source.url, source.originalText, source.platform, source.title, source.author, source.status, source.createdAt].every(string)) fail('来源字段');
  const range = (r: any) => object(r) && finite(r.startMs) && finite(r.endMs) && r.startMs >= 0 && r.endMs >= r.startMs;
  for (const t of s.transcripts) {
    if (![t.assetId, t.engine, t.createdAt, t.device].every(string) || !finite(t.elapsedSeconds)) fail('转录字段');
    ids(list(t.segments), 'segments');
    for (const segment of t.segments) {
      if (!range(segment) || !string(segment.text)) fail('转录时间');
      ids(list(segment.words), 'words');
      for (const word of segment.words) if (!range(word) || !string(word.text)) fail('字词时间');
    }
  }
  for (const j of s.jobs) if (!['import', 'transcribe', 'link', 'preview'].includes(j.kind) || !['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(j.status) || !finite(j.progress) || ![j.message, j.createdAt].every(string)) fail('任务字段');
  const c = s.content;
  if (!object(c) || !object(c.viewport) || ![c.viewport.x, c.viewport.y, c.viewport.zoom].every(finite) || c.viewport.zoom <= 0 || !object(c.corrections) || !object(c.imageNotes)) fail('画布字段');
  if (![...Object.values(c.corrections), ...Object.values(c.imageNotes)].every(string)) fail('批注字段');
  for (const key of ['nodes', 'excerpts', 'drafts']) ids(list(c[key]), key);
  for (const n of c.nodes) if (!['video', 'image', 'excerpt', 'draft', 'source'].includes(n.type) || ![n.entityId, n.group].every(string) || ![n.x, n.y, n.width, n.height].every(finite) || n.width <= 0 || n.height <= 0 || (n.createdRevision !== undefined && (!Number.isSafeInteger(n.createdRevision) || n.createdRevision < 0 || n.createdRevision > s.revision))) fail('画布节点');
  for (const e of c.excerpts) if (![e.assetId, e.quote, e.note, e.createdAt].every(string) || !list(e.segmentIds).every(string) || !list(e.wordIds).every(string) || !list(e.ranges).every(range)) fail('摘取字段');
  for (const d of c.drafts) {
    if (![d.title, d.html].every(string) || !['script', 'publication'].includes(d.kind)) fail('稿件字段');
    ids(list(d.versions), 'versions');
    for (const version of d.versions) if (![version.html, version.title, version.createdAt].every(string)) fail('稿件版本');
  }
}

export class ProjectStore {
  private db: DatabaseSync;
  private current: ProjectState;
  private closed = false;
  readonly directory: string;

  private constructor(directory: string, db: DatabaseSync, state: ProjectState) {
    this.directory = directory;
    this.db = db;
    this.current = state;
  }

  /** The picker selects a parent; reserve a fresh child without reusing existing paths. */
  static createInDirectory(parent: string, name: string): ProjectStore {
    const folder = name.trim();
    if (!folder) throw new Error('请输入项目名称');
    if (folder.length > 255 || /[<>:"/\\|?*\x00-\x1f]/.test(folder) || /[. ]$/.test(folder) || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])[ .]*(?:\.|$)/i.test(folder)) {
      throw new Error('项目名称将用作文件夹名：不能含有 \\ / : * ? " < > |，不能以句点结尾，也不能使用 CON、NUL 等系统保留名称；请缩短或修改名称');
    }
    const directory = path.join(realpathSync(path.resolve(parent)), folder);
    try { mkdirSync(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`保存位置中已存在“${folder}”，请修改项目名称或选择其他保存位置`);
      throw error;
    }
    return ProjectStore.create(directory, folder);
  }

  static create(dir: string, name: string): ProjectStore {
    if (!name.trim()) throw new Error('请输入项目名称');
    const directory = path.resolve(dir);
    if (existsSync(directory) && readdirSync(directory).length > 0) throw new Error('新项目目录必须为空，不会覆盖已有文件');
    mkdirSync(directory, { recursive: true });
    const root = realpathSync(directory);
    const db = new DatabaseSync(path.join(root, DATABASE_NAME));
    try {
      db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE document (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);');
      const now = new Date().toISOString();
      const state: ProjectState = { schemaVersion: 1, id: randomUUID(), name: name.trim(), directory: root, createdAt: now, updatedAt: now, revision: 0, assets: [], sources: [], transcripts: [], jobs: [], content: { nodes: [], excerpts: [], drafts: [], corrections: {}, imageNotes: {}, viewport: { x: 0, y: 0, zoom: 1 } } };
      db.prepare('INSERT INTO document (id,body) VALUES (1,?)').run(JSON.stringify(state));
      for (const folder of ['media', 'cache']) mkdirSync(path.join(root, folder));
      return new ProjectStore(root, db, state);
    } catch (error) { db.close(); throw error; }
  }

  static open(dir: string): ProjectStore {
    const directory = realpathSync(path.resolve(dir));
    const file = path.join(directory, DATABASE_NAME);
    if (!existsSync(file)) throw new Error('该目录没有 project.sqlite');
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      const row = db.prepare('SELECT body FROM document WHERE id=1').get() as { body: string } | undefined;
      if (!row) throw new Error('项目数据库缺少内容');
      const state: unknown = JSON.parse(row.body);
      validateProjectState(state);
      const store = new ProjectStore(directory, db, state);
      if (state.directory !== directory || state.jobs.some(j => j.status === 'queued' || j.status === 'running')) {
        store.commit(draft => { draft.directory = directory; for (const j of draft.jobs) if (j.status === 'queued' || j.status === 'running') { j.status = 'interrupted'; j.message = '上次运行已中断，可重试'; } });
      }
      return store;
    } catch (error) { db.close(); throw error; }
  }

  get state(): ProjectState { return structuredClone(this.current); }

  commit(mutator: (state: ProjectState) => void): ProjectState {
    if (this.closed) throw new Error('项目已关闭');
    const next = structuredClone(this.current);
    mutator(next);
    next.id = this.current.id;
    next.directory = this.directory;
    next.createdAt = this.current.createdAt;
    next.revision = this.current.revision + 1;
    next.updatedAt = new Date().toISOString();
    validateProjectState(next);
    // VACUUM INTO yields a complete prior committed database, never a raw WAL copy.
    const temporary = path.join(this.directory, `.previous-${randomUUID()}.sqlite`);
    try {
      this.db.prepare('VACUUM INTO ?').run(temporary);
      renameSync(temporary, path.join(this.directory, PREVIOUS_NAME));
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const persisted = this.db.prepare('SELECT body FROM document WHERE id=1').get() as { body: string };
        if (JSON.parse(persisted.body).revision !== this.current.revision) throw new Error('项目被其他窗口修改，请重新打开');
        this.db.prepare('UPDATE document SET body=? WHERE id=1').run(JSON.stringify(next));
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.current = next;
      return this.state;
    } finally { rmSync(temporary, { force: true }); }
  }

  saveContent(content: Content, baseRevision?: number): ProjectState {
    return this.commit(s => {
      const incoming = structuredClone(content);
      if (baseRevision !== undefined) {
        if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || baseRevision > s.revision) throw new Error('无效的画布保存版本');
        const submitted = new Set(incoming.nodes.map(n => n.id));
        incoming.nodes.push(...s.content.nodes.filter(n => (n.createdRevision ?? 0) > baseRevision && !submitted.has(n.id)));
      }
      // A clipboard draft can arrive while the renderer is saving an older content
      // snapshot. Retaining its node also requires retaining the backing entity.
      const draftIds = new Set(incoming.drafts.map(d => d.id));
      const excerptIds = new Set(incoming.excerpts.map(e => e.id));
      for (const node of incoming.nodes) {
        if (node.type === 'draft' && !draftIds.has(node.entityId)) {
          const draft = s.content.drafts.find(d => d.id === node.entityId);
          if (draft) { incoming.drafts.push(draft); draftIds.add(draft.id); }
        }
        if (node.type === 'excerpt' && !excerptIds.has(node.entityId)) {
          const excerpt = s.content.excerpts.find(e => e.id === node.entityId);
          if (excerpt) { incoming.excerpts.push(excerpt); excerptIds.add(excerpt.id); }
        }
      }
      incoming.imageNotes = { ...s.content.imageNotes, ...incoming.imageNotes };
      s.content = incoming;
    });
  }
  rename(name: string): ProjectState { return this.commit(s => { s.name = name.trim(); }); }
  async backup(destinationSqlite: string): Promise<void> {
    if (this.closed) throw new Error('项目已关闭');
    const target = path.resolve(destinationSqlite);
    if (target === path.join(this.directory, DATABASE_NAME) || target === path.join(this.directory, PREVIOUS_NAME)) throw new Error('不能覆盖项目数据库');
    const temporary = path.join(path.dirname(target), `.snapshot-${randomUUID()}.sqlite`);
    try { await sqliteBackup(this.db, temporary); renameSync(temporary, target); }
    finally { rmSync(temporary, { force: true }); }
  }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BoardStorage, type StoredMedia } from '../native/board-storage';
import { createBoard, loadWorkspace, mergeFolderMedia, saveWorkspace, validateBoard } from '../src/storage';
import { createNode } from '../src/board-utils';
import type { Board, Workspace } from '../src/model';

const base = path.resolve('output/quality-20261003');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'board-storage-test-'));
  const parent = path.join(directory, 'chosen-parent'); await fs.mkdir(parent);
  const registry = path.join(directory, 'locations.json');
  const storage = new BoardStorage(registry); await storage.initialize();
  return { directory, parent, registry, storage, async clean() {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('board-storage-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  } };
}
async function create(temporary: Awaited<ReturnType<typeof fixture>>, board = createBoard('blank')) {
  const choice = await temporary.storage.choose(temporary.parent);
  const location = await temporary.storage.create(choice.id, board);
  return { location, board: { ...board, storage: location } satisfies Board };
}
function addImage(board: Board) {
  const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const node = createNode('image'); node.data.mediaId = 'image-one'; board.nodes = [node];
  const media: StoredMedia = { id: 'image-one', name: '素材.png', mime: 'image/png', createdAt: board.createdAt, data };
  return { data, media };
}
const manifestFile = (directory: string) => path.join(directory, 'canvas.field.json');
async function manifest(directory: string) { return JSON.parse(await fs.readFile(manifestFile(directory), 'utf8')); }

test('selected parents create a fresh child; descriptive renderer paths and unknown IDs cannot authorize writes', async () => {
  const temporary = await fixture();
  try {
    const board = createBoard('blank'); board.title = '文稿/创意:资料';
    await assert.rejects(temporary.storage.create(temporary.parent, board), /失效/);
    const { location, board: saved } = await create(temporary, board);
    assert.equal(path.dirname(location.directory), await fs.realpath(temporary.parent));
    assert.ok(path.basename(location.directory).startsWith('文稿-创意-资料-'));
    assert.equal((await manifest(location.directory)).board.storage.id, location.id);
    await assert.rejects(temporary.storage.save('unknown', saved, []), /未授权/);
    await assert.rejects(temporary.storage.save(location.id, { ...saved, id: 'different-board' }, []), /不一致/);
    await assert.rejects(temporary.storage.save(location.id, { ...saved, storage: { ...location, directory: temporary.directory } }, []), /不一致/);
    await assert.rejects(temporary.storage.readMedia('unknown', 'image-one'), /未授权/);
  } finally { await temporary.clean(); }
});

test('real media bytes, hashes, board text and the previous manifest survive save, reopen and registry restart', async () => {
  const temporary = await fixture();
  try {
    const { location, board } = await create(temporary);
    const initial = await fs.readFile(manifestFile(location.directory), 'utf8');
    const { data, media } = addImage(board); board.title = '写作与创意';
    board.nodes[0].data.body = '实际保存的说明';
    await temporary.storage.save(location.id, board, [media]);
    const saved = await manifest(location.directory);
    assert.equal(saved.media[0].sha256, createHash('sha256').update(data).digest('hex'));
    assert.deepEqual(new Uint8Array(await fs.readFile(path.join(location.directory, saved.media[0].file))), data);
    assert.equal(await fs.readFile(path.join(location.directory, 'canvas.previous.field.json'), 'utf8'), initial);
    assert.deepEqual(await temporary.storage.readMedia(location.id, media.id), data);
    const restarted = new BoardStorage(temporary.registry); await restarted.initialize();
    assert.equal(await restarted.directory(location.id), location.directory);
    const opened = await restarted.open(location.directory);
    assert.ok(opened.kind === 'opened');
    assert.notEqual(opened.board.storage?.id, location.id);
    assert.equal(opened.board.title, board.title);
    assert.equal(opened.board.nodes[0].data.body, '实际保存的说明');
    assert.equal(opened.media[0].name, '素材.png');
    assert.deepEqual(await restarted.readMedia(opened.board.storage!.id, media.id), data);
    assert.doesNotThrow(() => validateBoard(opened.board));
  } finally { await temporary.clean(); }
});

test('missing referenced media and duplicate submitted media reject without replacing the last good manifest', async () => {
  const temporary = await fixture();
  try {
    const { location, board } = await create(temporary); const before = await fs.readFile(manifestFile(location.directory), 'utf8');
    const { media } = addImage(board);
    await assert.rejects(temporary.storage.save(location.id, board, []), /缺少/);
    await assert.rejects(temporary.storage.save(location.id, board, [media, media]), /缺少|重复/);
    assert.equal(await fs.readFile(manifestFile(location.directory), 'utf8'), before);
    await temporary.storage.save(location.id, board, [media]);
    assert.equal((await manifest(location.directory)).board.nodes.length, 1, 'a rejected save must not block later saves');
  } finally { await temporary.clean(); }
});

test('modified same-size media and unsupported manifests reject reopening before registering a new location', async () => {
  const temporary = await fixture();
  try {
    const { location, board } = await create(temporary); const { data, media } = addImage(board);
    await temporary.storage.save(location.id, board, [media]);
    const saved = await manifest(location.directory), registryBefore = await fs.readFile(temporary.registry, 'utf8');
    await fs.unlink(path.join(location.directory, 'canvas.previous.field.json'));
    await fs.writeFile(path.join(location.directory, saved.media[0].file), new Uint8Array(data.length).fill(1));
    await assert.rejects(temporary.storage.open(location.directory), /缺失或损坏/);
    assert.equal(await fs.readFile(temporary.registry, 'utf8'), registryBefore);
    saved.version = 99; await fs.writeFile(manifestFile(location.directory), JSON.stringify(saved));
    await assert.rejects(temporary.storage.open(location.directory), /不支持/);
    assert.equal(await fs.readFile(temporary.registry, 'utf8'), registryBefore);
  } finally { await temporary.clean(); }
});

test('a manifest cannot use a relative traversal to read media outside its selected canvas', async () => {
  const temporary = await fixture();
  try {
    const { location, board } = await create(temporary); const { media } = addImage(board);
    await temporary.storage.save(location.id, board, [media]);
    const saved = await manifest(location.directory); saved.media[0].file = '../../outside.png';
    await fs.unlink(path.join(location.directory, 'canvas.previous.field.json'));
    await fs.writeFile(manifestFile(location.directory), JSON.stringify(saved));
    await assert.rejects(temporary.storage.open(location.directory), /素材记录无效/);
  } finally { await temporary.clean(); }
});

test('replacing the media directory with a junction outside the canvas stops both writes and reads', async context => {
  const temporary = await fixture(); let junction: string | undefined;
  try {
    const { location, board } = await create(temporary);
    const outside = path.join(temporary.directory, 'outside'); await fs.mkdir(outside);
    junction = path.join(location.directory, 'media'); await fs.rmdir(junction);
    try { await fs.symlink(outside, junction, 'junction'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip('the execution sandbox forbids junction creation; run this test with an authorized unrestricted host'); return; }
      throw error;
    }
    await assert.rejects(temporary.storage.save(location.id, board, []), /画布以外/);
    await assert.rejects(temporary.storage.directory(location.id), /画布以外/);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    if (junction && (await fs.lstat(junction).catch(() => undefined))?.isSymbolicLink()) await fs.unlink(junction);
    await temporary.clean();
  }
});

test('native media are copied into the chosen canvas and rebound to its new location on reopen', async () => {
  const temporary = await fixture();
  try {
    const originalFile = path.join(temporary.directory, 'source.mp4'); const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await fs.writeFile(originalFile, bytes);
    const storage = new BoardStorage(temporary.registry, async () => ({ path: originalFile, name: '原片.mp4', mime: 'video/mp4' })); await storage.initialize();
    const initial = createBoard('blank'); const choice = await storage.choose(temporary.parent); const location = await storage.create(choice.id, initial);
    const video = createNode('video'); Object.assign(video.data, { url: 'media://library/clip.mp4', nativeProjectId: 'library', nativeAssetId: 'clip' });
    const board = { ...initial, storage: location, nodes: [video] };
    await storage.save(location.id, board, []);
    assert.equal(video.data.url, 'media://library/clip.mp4', 'saving must not mutate the renderer card');
    const saved = await manifest(location.directory); assert.equal(saved.media[0].name, '原片.mp4');
    assert.equal(saved.board.nodes[0].data.url, `field-media://${location.id}/${saved.media[0].id}`);
    const reopened = await storage.open(location.directory);
    assert.ok(reopened.kind === 'opened');
    assert.equal(reopened.board.nodes[0].data.url, `field-media://${reopened.board.storage!.id}/${saved.media[0].id}`);
    assert.deepEqual(await storage.readMedia(reopened.board.storage!.id, saved.media[0].id), bytes);
    await storage.save(reopened.board.storage!.id, reopened.board, []);
    assert.equal((await manifest(location.directory)).media.length, 1);
  } finally { await temporary.clean(); }
});

test('duplicate media identities in a local manifest must be rejected instead of ambiguously reopening', async () => {
  const temporary = await fixture();
  try {
    const { location, board } = await create(temporary); const { media } = addImage(board);
    await temporary.storage.save(location.id, board, [media]);
    const saved = await manifest(location.directory); saved.media.push({ ...saved.media[0], name: '另一同 ID 素材.png' });
    await fs.unlink(path.join(location.directory, 'canvas.previous.field.json'));
    await fs.writeFile(manifestFile(location.directory), JSON.stringify(saved));
    await assert.rejects(temporary.storage.open(location.directory), /重复|素材记录无效/);
  } finally { await temporary.clean(); }
});

test('a missing manifest media identity cannot reopen a canvas as if all its referenced media were available', async () => {
  const temporary = await fixture();
  try {
    const { location, board } = await create(temporary); const { media } = addImage(board);
    await temporary.storage.save(location.id, board, [media]);
    const saved = await manifest(location.directory); saved.media = [];
    await fs.unlink(path.join(location.directory, 'canvas.previous.field.json'));
    await fs.writeFile(manifestFile(location.directory), JSON.stringify(saved));
    await assert.rejects(temporary.storage.open(location.directory), /缺少|引用|素材/);
  } finally { await temporary.clean(); }
});

test('a copied canvas with a colliding board ID gets a new ID while reopening the same directory retains ownership', async () => {
  const temporary = await fixture();
  try {
    const { location, board } = await create(temporary);
    const existing = [{ id: board.id, directory: location.directory }];
    const same = await temporary.storage.open(location.directory, existing); assert.ok(same.kind === 'opened'); assert.equal(same.board.id, board.id);
    const copy = path.join(temporary.directory, 'copied-canvas'); await fs.cp(location.directory, copy, { recursive: true });
    const opened = await temporary.storage.open(copy, existing); assert.ok(opened.kind === 'opened'); assert.notEqual(opened.board.id, board.id);
    assert.equal(opened.board.storage?.directory, await fs.realpath(copy));
    await temporary.storage.save(opened.board.storage!.id, opened.board, []);
    assert.equal((await manifest(copy)).board.id, opened.board.id);
    assert.equal((await manifest(location.directory)).board.id, board.id, 'opening a copy must not overwrite its original');
  } finally { await temporary.clean(); }
});

test('a damaged location registry is explicit and a removed canvas directory does not redirect to another folder', async () => {
  const temporary = await fixture();
  try {
    const { location } = await create(temporary); await fs.rename(location.directory, `${location.directory}-moved`);
    await assert.rejects(temporary.storage.directory(location.id), /无法访问/);
    await fs.writeFile(temporary.registry, '{broken');
    await assert.rejects(new BoardStorage(temporary.registry).initialize());
  } finally { await temporary.clean(); }
});

test('two cards for one native video create one media record and receive the same independent folder URL', async () => {
  const temporary = await fixture(); let resolutions = 0;
  try {
    const source = path.join(temporary.directory, 'one-native-source.mp4'); const bytes = new Uint8Array([7, 8, 9, 10]); await fs.writeFile(source, bytes);
    const storage = new BoardStorage(temporary.registry, async () => { resolutions++; return { path: source, name: '同源视频.mp4', mime: 'video/mp4' }; }); await storage.initialize();
    const initial = createBoard('blank'), choice = await storage.choose(temporary.parent), location = await storage.create(choice.id, initial);
    const first = createNode('video'), second = createNode('video');
    for (const node of [first, second]) Object.assign(node.data, { url: 'media://one-library/source.mp4', nativeProjectId: 'one-library', nativeAssetId: 'same-asset', poster: 'media://one-library/source.png' });
    const board: Board = { ...initial, groupId: 'my-group', storage: location, nodes: [first, second] };
    const saved = await storage.save(location.id, board, []);
    assert.equal(resolutions, 1, 'duplicate cards must not resolve or hash the original video once per card');
    const disk = await manifest(location.directory); assert.equal(disk.media.length, 1); assert.equal(disk.board.groupId, undefined);
    assert.equal(saved.groupId, 'my-group'); assert.equal(saved.nodes.length, 2); assert.equal(saved.nodes[0].data.url, saved.nodes[1].data.url);
    assert.equal(saved.nodes[0].data.url, `field-media://${location.id}/${disk.media[0].id}`);
    assert.equal(saved.nodes[0].data.poster, undefined); assert.equal(saved.nodes[1].data.poster, undefined);
    assert.equal(board.nodes[0].data.url, 'media://one-library/source.mp4', 'normalization must not mutate the supplied board');
    const opened = await storage.open(location.directory); assert.ok(opened.kind === 'opened'); assert.equal(opened.media.length, 1); assert.equal(opened.board.nodes.length, 2);
    assert.deepEqual(await storage.readMedia(opened.board.storage!.id, disk.media[0].id), bytes);
  } finally { await temporary.clean(); }
});

test('a native file larger than 64 MB stays independently saveable and playable from its folder after its source disappears', async () => {
  const temporary = await fixture(); let available = true, resolutions = 0;
  try {
    const source = path.join(temporary.directory, 'large-native-source.mp4'); const size = 64 * 1024 * 1024 + 1;
    const handle = await fs.open(source, 'wx'); try { await handle.truncate(size); } finally { await handle.close(); }
    const storage = new BoardStorage(temporary.registry, async () => { resolutions++; return available ? { path: source, name: 'large-fixture.mp4', mime: 'video/mp4' } : undefined; }); await storage.initialize();
    const initial = createBoard('blank'), choice = await storage.choose(temporary.parent), location = await storage.create(choice.id, initial);
    const video = createNode('video'); Object.assign(video.data, { url: 'media://large-library/large.mp4', nativeProjectId: 'large-library', nativeAssetId: 'large-asset' });
    const original: Board = { ...initial, storage: location, nodes: [video] };
    const saved = await storage.save(location.id, original, []); assert.ok(saved.nodes[0].data.url?.startsWith(`field-media://${location.id}/`));
    available = false; await fs.unlink(source);
    const edited: Board = { ...original, title: '原库移除后的编辑', nodes: original.nodes.map(node => ({ ...node, data: { ...node.data, body: '后续编辑必须继续保存。' } })) };
    const savedAgain = await storage.save(location.id, edited, []);
    assert.equal(resolutions, 1, 'the validated folder copy must be reused before querying an unavailable original library');
    assert.equal(savedAgain.title, edited.title); assert.equal(savedAgain.nodes[0].data.body, '后续编辑必须继续保存。');
    const mediaId = new URL(savedAgain.nodes[0].data.url!).pathname.slice(1), media = await storage.mediaFile(location.id, mediaId);
    assert.equal(media.mime, 'video/mp4'); assert.equal(media.size, size); assert.equal((await fs.stat(media.file)).size, size);
    assert.equal(path.dirname(media.file), path.join(location.directory, 'media'));
    await assert.rejects(storage.readMedia(location.id, mediaId), /64 MB/, 'large media must stream through its folder reference rather than enter the renderer byte cache');
    const restarted = new BoardStorage(temporary.registry); await restarted.initialize(); const reopened = await restarted.open(location.directory);
    assert.ok(reopened.kind === 'opened');
    const normalized = await restarted.save(reopened.board.storage!.id, reopened.board, []);
    assert.equal(normalized.nodes[0].data.body, '后续编辑必须继续保存。');
    assert.ok(normalized.nodes[0].data.url?.startsWith(`field-media://${reopened.board.storage!.id}/`));
    assert.equal((await restarted.mediaFile(reopened.board.storage!.id, mediaId)).size, size);
  } finally { await temporary.clean(); }
});

function mediaMergeFixture() {
  const source = createBoard('blank'); source.storage = { id: 'folder-id', directory: 'D:\\chosen-folder' }; source.groupId = 'g';
  const node = createNode('video'); Object.assign(node.data, { url: 'media://library/source.mp4', nativeProjectId: 'library', nativeAssetId: 'asset', poster: 'media://library/poster.png' }); source.nodes = [node];
  const saved = structuredClone(source); saved.nodes[0].data.url = 'field-media://folder-id/disk-copy'; delete saved.nodes[0].data.poster;
  return { source, saved, workspace: { schema: 1, activeBoardId: source.id, boards: [source] } satisfies Workspace };
}

test('directory normalization merges only media references and preserves text, title, selection and grouping edited while saving', () => {
  const { source, saved, workspace } = mediaMergeFixture();
  const current = structuredClone(workspace); current.boards[0].title = '保存等待期间改的标题'; current.boards[0].groupId = 'new-group';
  Object.assign(current.boards[0].nodes[0].data, { title: '正在编辑的卡片标题', body: '正在编辑的正文', tags: ['新的标签'] });
  const merged = mergeFolderMedia(current, source, saved);
  assert.notEqual(merged, current); assert.equal(merged.activeBoardId, current.activeBoardId); assert.equal(merged.boards[0].groupId, 'new-group'); assert.equal(merged.boards[0].title, current.boards[0].title);
  assert.equal(merged.boards[0].nodes[0].data.title, '正在编辑的卡片标题'); assert.equal(merged.boards[0].nodes[0].data.body, '正在编辑的正文'); assert.deepEqual(merged.boards[0].nodes[0].data.tags, ['新的标签']);
  assert.equal(merged.boards[0].nodes[0].data.url, saved.nodes[0].data.url); assert.equal(merged.boards[0].nodes[0].data.poster, undefined);
  assert.equal(current.boards[0].nodes[0].data.url, source.nodes[0].data.url, 'the current state must remain immutable');
});

test('a replaced media identity, changed source URL, changed folder or deleted card cannot receive a stale directory save result', () => {
  const { source, saved, workspace } = mediaMergeFixture();
  const changes: ((value: Workspace) => void)[] = [
    value => { value.boards[0].nodes[0].data.url = 'media://library/new.mp4'; },
    value => { value.boards[0].nodes[0].data.nativeAssetId = 'new-asset'; },
    value => { value.boards[0].nodes[0].data.nativeProjectId = 'another-library'; },
    value => { value.boards[0].nodes[0].data.mediaId = 'new-byte-cache'; },
    value => { value.boards[0].storage = { id: 'another-folder', directory: 'D:\\another-folder' }; },
    value => { value.boards[0].nodes = []; },
    value => { value.boards = []; },
  ];
  for (const change of changes) { const current = structuredClone(workspace); change(current); assert.equal(mergeFolderMedia(current, source, saved), current); }
});

test('normalizing a video cannot remove a newer poster or change the active canvas', () => {
  const { source, saved, workspace } = mediaMergeFixture(); const other = createBoard('writing');
  const current = structuredClone(workspace); current.boards.push(other); current.activeBoardId = other.id; current.boards[0].nodes[0].data.poster = 'data:image/png;base64,iVBORw0KGgo=';
  const merged = mergeFolderMedia(current, source, saved);
  assert.equal(merged.activeBoardId, other.id); assert.equal(merged.boards[0].nodes[0].data.poster, current.boards[0].nodes[0].data.poster);
  assert.equal(merged.boards[0].nodes[0].data.url, saved.nodes[0].data.url); assert.equal(merged.boards[1], other);
});

function mockBrowserStorage() {
  const values = new Map<string, unknown>();
  const database: { onversionchange?: () => void; close(): void; transaction(name: string): unknown } = {
    close() {},
    transaction(name) {
      const transaction: { oncomplete?: () => void; objectStore(): unknown } = {
        objectStore() { return {
          put(value: unknown, key: string) { values.set(`${name}:${key}`, structuredClone(value)); },
          get(key: string) { const request: { result: unknown; onsuccess?: () => void } = { result: structuredClone(values.get(`${name}:${key}`)) }; queueMicrotask(() => request.onsuccess?.()); return request; },
        }; },
      }; queueMicrotask(() => transaction.oncomplete?.()); return transaction;
    },
  };
  const previousDatabase = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { const request: { result: unknown; onsuccess?: () => void } = { result: database }; queueMicrotask(() => request.onsuccess?.()); return request; } } });
  return { values, setBridge(save: (id: string, board: Board, media: StoredMedia[]) => Promise<Board>) { Object.defineProperty(globalThis, 'window', { configurable: true, value: { fieldBoardStorage: { save } } }); }, restore() {
    database.onversionchange?.();
    if (previousDatabase) Object.defineProperty(globalThis, 'indexedDB', previousDatabase); else Reflect.deleteProperty(globalThis, 'indexedDB');
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
  } };
}

test('one inaccessible folder does not prevent other folders from saving; errors include every failed board and repaired folders can retry', async () => {
  const temporary = await fixture(), browser = mockBrowserStorage(); const calls: string[] = [];
  try {
    const first = await create(temporary), middle = await create(temporary), last = await create(temporary);
    first.board.title = '失联目录一'; middle.board.title = '健康目录'; last.board.title = '失联目录二';
    await fs.rename(first.location.directory, `${first.location.directory}-moved`); await fs.rename(last.location.directory, `${last.location.directory}-moved`);
    browser.setBridge(async (id, board, media) => { calls.push(id); return temporary.storage.save(id, board, media); });
    const workspace: Workspace = { schema: 1, activeBoardId: first.board.id, boards: [first.board, middle.board, last.board] };
    await assert.rejects(saveWorkspace(workspace), error => { assert.ok(error instanceof Error); assert.match(error.message, /失联目录一/); assert.match(error.message, /失联目录二/); return true; });
    assert.deepEqual(calls, [first.location.id, middle.location.id, last.location.id]);
    assert.equal((await manifest(middle.location.directory)).board.title, '健康目录');
    assert.deepEqual(await loadWorkspace(), workspace, 'the browser workspace remains durable even while external folders are unavailable');
    await fs.rename(`${first.location.directory}-moved`, first.location.directory); await fs.rename(`${last.location.directory}-moved`, last.location.directory);
    calls.length = 0; await saveWorkspace(workspace);
    assert.deepEqual(calls, [first.location.id, last.location.id], 'an already saved unchanged folder should not be written again on retry');
    assert.equal((await manifest(first.location.directory)).board.title, '失联目录一'); assert.equal((await manifest(last.location.directory)).board.title, '失联目录二');
  } finally { browser.restore(); await temporary.clean(); }
});

test('the full directory-normalized media board is written back to browser storage after a real native copy', async () => {
  const temporary = await fixture(), browser = mockBrowserStorage();
  try {
    const source = path.join(temporary.directory, 'normalize-source.mp4'); await fs.writeFile(source, new Uint8Array([20, 21, 22]));
    const storage = new BoardStorage(temporary.registry, async () => ({ path: source, name: '源.mp4', mime: 'video/mp4' })); await storage.initialize();
    const initial = createBoard('blank'), choice = await storage.choose(temporary.parent), location = await storage.create(choice.id, initial);
    const video = createNode('video'); Object.assign(video.data, { url: 'media://normalize-library/source.mp4', nativeProjectId: 'normalize-library', nativeAssetId: 'normalize-asset' });
    const board: Board = { ...initial, storage: location, nodes: [video] }, workspace: Workspace = { schema: 1, activeBoardId: board.id, boards: [board] };
    browser.setBridge((id, board, media) => storage.save(id, board, media)); const normalized: Board[] = [];
    await saveWorkspace(workspace, { onNormalized: (_before, saved) => { normalized.push(saved); } });
    const persisted = await loadWorkspace(); assert.ok(persisted?.boards[0].nodes[0].data.url?.startsWith(`field-media://${location.id}/`));
    assert.equal(normalized.length, 1); assert.equal(normalized[0].nodes[0].data.url, persisted?.boards[0].nodes[0].data.url);
    assert.equal(workspace.boards[0].nodes[0].data.url, 'media://normalize-library/source.mp4');
    assert.equal((await manifest(location.directory)).board.nodes[0].data.url, persisted?.boards[0].nodes[0].data.url);
  } finally { browser.restore(); await temporary.clean(); }
});

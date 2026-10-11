import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BoardStorage, type StoredMedia } from '../native/board-storage';
import { createBoard } from '../src/storage';
import { createNode } from '../src/board-utils';
import type { Board } from '../src/model';

const base = path.resolve('output/quality-20261003');
const mainFile = (directory: string) => path.join(directory, 'canvas.field.json');
const previousFile = (directory: string) => path.join(directory, 'canvas.previous.field.json');
const readManifest = async (directory: string) => JSON.parse(await fs.readFile(mainFile(directory), 'utf8'));
async function fixture(nativeFile?: ConstructorParameters<typeof BoardStorage>[1]) {
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'directory-copy-test-'));
  const parent = path.join(directory, 'chosen-parent'); await fs.mkdir(parent);
  const registry = path.join(directory, 'locations.json'), storage = new BoardStorage(registry, nativeFile); await storage.initialize();
  return { directory, parent, registry, storage, async clean() {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('directory-copy-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  } };
}
function imageFixture(board: Board) {
  const node = createNode('image'); node.data.mediaId = 'image-one'; node.data.title = '图像原文'; board.nodes.push(node);
  return { id: 'image-one', name: '素材.png', mime: 'image/png', createdAt: board.createdAt, data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) } satisfies StoredMedia;
}
async function savedFixture() {
  const temporary = await fixture(); const board = createBoard('blank'), choice = await temporary.storage.choose(temporary.parent);
  const location = await temporary.storage.create(choice.id, board); board.storage = location;
  const media = imageFixture(board); board.title = '上一版标题'; await temporary.storage.save(location.id, board, [media]);
  board.title = '当前标题'; await temporary.storage.save(location.id, board, [media]);
  return { ...temporary, board, media, location };
}

test('create accepts referenced browser media and only registers a verified complete folder', async () => {
  const temporary = await fixture();
  try {
    const board = createBoard('design'), media = imageFixture(board), before = structuredClone(board);
    const choice = await temporary.storage.choose(temporary.parent), location = await temporary.storage.create(choice.id, board, [media]);
    assert.deepEqual(board, before, 'creating storage must not mutate the current renderer board');
    const disk = await readManifest(location.directory);
    assert.equal(disk.board.id, board.id); assert.equal(disk.board.storage.id, location.id); assert.equal(disk.media.length, 1);
    assert.deepEqual(await temporary.storage.readMedia(location.id, media.id), media.data);
    assert.equal(JSON.parse(await fs.readFile(temporary.registry, 'utf8')).length, 1);
  } finally { await temporary.clean(); }
});

test('a damaged main with an intact previous version offers recovery without registering or overwriting; recovery creates an independent copy', async () => {
  const temporary = await savedFixture();
  try {
    const primary = '{损坏的主文件', registry = await fs.readFile(temporary.registry, 'utf8');
    const prior = JSON.parse(await fs.readFile(previousFile(temporary.location.directory), 'utf8'));
    const video = createNode('video'); Object.assign(video.data, { nativeImportJobId: 'old-job', videoImport: { attemptId: 'old-attempt', url: 'https://example.com/video', originalText: '分享原文', status: 'downloading', progress: 40, message: '后台下载', mediaReady: false, createdAt: prior.board.createdAt, updatedAt: prior.board.updatedAt } });
    prior.board.nodes.push(video); await fs.writeFile(previousFile(temporary.location.directory), JSON.stringify(prior));
    await fs.writeFile(mainFile(temporary.location.directory), primary);
    const offered = await temporary.storage.open(temporary.location.directory);
    assert.ok(offered.kind === 'recovery-available'); assert.equal(offered.title, '上一版标题'); assert.equal(offered.savedAt, prior.savedAt); assert.match(offered.reason, /损坏/);
    assert.equal(await fs.readFile(temporary.registry, 'utf8'), registry);
    assert.equal(await fs.readFile(mainFile(temporary.location.directory), 'utf8'), primary);
    const choice = await temporary.storage.choose(temporary.parent), recovered = await temporary.storage.recoverPrevious(offered.recoveryId, choice.id);
    assert.equal(recovered.kind, 'opened'); assert.notEqual(recovered.board.id, temporary.board.id); assert.notEqual(recovered.board.storage!.id, temporary.location.id);
    assert.equal(recovered.board.title, '上一版标题'); assert.equal(path.dirname(recovered.board.storage!.directory), temporary.parent);
    assert.equal(recovered.board.nodes.at(-1)!.data.nativeImportJobId, undefined); assert.equal(recovered.board.nodes.at(-1)!.data.videoImport, undefined);
    assert.equal(recovered.board.nodes.at(-1)!.data.sourceUrl, 'https://example.com/video', 'detaching task ownership must preserve its original public source');
    const recoveredMediaId = recovered.board.nodes.find(node => node.data.kind === 'image')!.data.mediaId!;
    assert.notEqual(recoveredMediaId, temporary.media.id, 'recovering older media must not overwrite the current board byte-cache identity');
    assert.deepEqual(await temporary.storage.readMedia(recovered.board.storage!.id, recoveredMediaId), temporary.media.data);
    assert.equal(await fs.readFile(mainFile(temporary.location.directory), 'utf8'), primary);
    await assert.rejects(temporary.storage.recoverPrevious(offered.recoveryId, choice.id), /失效/);
  } finally { await temporary.clean(); }
});

test('two damaged manifests and a previous version with missing or hash-damaged media never offer a false recovery', async () => {
  const temporary = await savedFixture();
  try {
    const prior = await fs.readFile(previousFile(temporary.location.directory), 'utf8'), disk = JSON.parse(prior), registry = await fs.readFile(temporary.registry, 'utf8');
    await fs.writeFile(mainFile(temporary.location.directory), '{bad-main'); await fs.writeFile(previousFile(temporary.location.directory), '{bad-previous');
    await assert.rejects(temporary.storage.open(temporary.location.directory), /描述文件损坏/);
    await fs.writeFile(previousFile(temporary.location.directory), prior);
    const mediaFile = path.join(temporary.location.directory, disk.media[0].file);
    await fs.writeFile(mediaFile, new Uint8Array(temporary.media.data.length).fill(1));
    await assert.rejects(temporary.storage.open(temporary.location.directory), /描述文件损坏/);
    await fs.unlink(mediaFile); await assert.rejects(temporary.storage.open(temporary.location.directory), /描述文件损坏/);
    assert.equal(await fs.readFile(temporary.registry, 'utf8'), registry);
  } finally { await temporary.clean(); }
});

test('a recovery credential rechecks its snapshot and bytes before creating any destination', async () => {
  const temporary = await savedFixture();
  try {
    await fs.writeFile(mainFile(temporary.location.directory), '{bad-main');
    const offered = await temporary.storage.open(temporary.location.directory); assert.ok(offered.kind === 'recovery-available');
    const choice = await temporary.storage.choose(temporary.parent), children = await fs.readdir(temporary.parent), registry = await fs.readFile(temporary.registry, 'utf8');
    const prior = JSON.parse(await fs.readFile(previousFile(temporary.location.directory), 'utf8')); prior.board.title = '发生变化';
    await fs.writeFile(previousFile(temporary.location.directory), JSON.stringify(prior));
    await assert.rejects(temporary.storage.recoverPrevious(offered.recoveryId, choice.id), /发生变化/);
    assert.deepEqual(await fs.readdir(temporary.parent), children); assert.equal(await fs.readFile(temporary.registry, 'utf8'), registry);
    const again = await temporary.storage.open(temporary.location.directory); assert.ok(again.kind === 'recovery-available');
    await fs.unlink(path.join(temporary.location.directory, prior.media[0].file));
    await assert.rejects(temporary.storage.recoverPrevious(again.recoveryId, choice.id), /缺失或损坏/);
    assert.deepEqual(await fs.readdir(temporary.parent), children);
  } finally { await temporary.clean(); }
});

test('a complete mixed directory copies a native video over 64 MB, browser images and text, then remains copyable after its library and original folder disappear', async () => {
  const temporary = await fixture(); let available = true, resolutions = 0;
  try {
    const source = path.join(temporary.directory, 'large-source.mp4'), size = 64 * 1024 * 1024 + 1;
    const handle = await fs.open(source, 'wx'); try { await handle.truncate(size); } finally { await handle.close(); }
    const storage = new BoardStorage(temporary.registry, async () => { resolutions++; return available ? { path: source, name: '完整原片.mp4', mime: 'video/mp4' } : undefined; }); await storage.initialize();
    const board = createBoard('video'), media = imageFixture(board), note = createNode('note'), video = createNode('video');
    note.data.body = '完整备份必须保留这段原文。'; Object.assign(video.data, { url: 'media://library/source.mp4', nativeProjectId: 'library', nativeAssetId: 'large', nativeImportJobId: 'old-job' }); board.nodes.push(note, video);
    const choice = await storage.choose(temporary.parent), location = await storage.create(choice.id, board, [media]); board.storage = location;
    const before = structuredClone(board), originalBytes = await fs.readFile(mainFile(location.directory));
    available = false; await fs.unlink(source);
    const exported = await storage.exportDirectory(board, [media], choice.id);
    assert.equal(exported.status, 'saved'); assert.deepEqual(board, before); assert.deepEqual(await fs.readFile(mainFile(location.directory)), originalBytes);
    assert.equal(resolutions, 1, 'the original native library must not be queried after a valid folder copy exists');
    const disk = await readManifest(exported.directory); assert.equal(disk.media.length, 2); assert.notEqual(disk.board.id, board.id); assert.equal(disk.board.nodes.at(-1).data.nativeImportJobId, undefined);
    assert.equal(disk.board.nodes.find((node: { id: string }) => node.id === note.id).data.body, note.data.body);
    const originalMoved = `${location.directory}-moved`; await fs.rename(location.directory, originalMoved);
    const restarted = new BoardStorage(temporary.registry); await restarted.initialize();
    const opened = await restarted.open(exported.directory); assert.ok(opened.kind === 'opened');
    const videoCard = opened.board.nodes.find(node => node.id === video.id)!, mediaId = new URL(videoCard.data.url!).pathname.slice(1);
    const imageMediaId = opened.board.nodes.find(node => node.data.mediaId)!.data.mediaId!; assert.notEqual(imageMediaId, media.id);
    assert.ok(videoCard.data.url!.startsWith(`field-media://${opened.board.storage!.id}/`));
    assert.equal((await restarted.mediaFile(opened.board.storage!.id, mediaId)).size, size);
    await assert.rejects(restarted.readMedia(opened.board.storage!.id, mediaId), /64 MB/);
    const secondChoice = await restarted.choose(temporary.parent), second = await restarted.exportDirectory(opened.board, [], secondChoice.id);
    const secondOpen = await restarted.open(second.directory); assert.ok(secondOpen.kind === 'opened');
    const secondVideoId = new URL(secondOpen.board.nodes.find(node => node.id === video.id)!.data.url!).pathname.slice(1);
    const secondImageId = secondOpen.board.nodes.find(node => node.data.mediaId)!.data.mediaId!;
    assert.notEqual(secondVideoId, mediaId); assert.notEqual(secondImageId, imageMediaId);
    assert.equal((await restarted.mediaFile(secondOpen.board.storage!.id, secondVideoId)).size, size);
    assert.deepEqual(await restarted.readMedia(secondOpen.board.storage!.id, secondImageId), media.data);
    await restarted.save(secondOpen.board.storage!.id, secondOpen.board, []);
    assert.equal((await readManifest(second.directory)).media.length, 2);
  } finally { await temporary.clean(); }
});

test('invalid picker credentials, missing sources and failed registry persistence cannot create a success or leave a destination or dangling registration', async () => {
  const temporary = await fixture();
  try {
    const board = createBoard('design'), media = imageFixture(board), choice = await temporary.storage.choose(temporary.parent);
    await assert.rejects(temporary.storage.exportDirectory(board, [media], 'cancelled-or-ungranted'), /失效/);
    await assert.rejects(temporary.storage.exportDirectory(board, [], choice.id), /缺少/);
    assert.deepEqual(await fs.readdir(temporary.parent), []);
    assert.equal(await fs.stat(temporary.registry).catch(() => null), null);
    await fs.mkdir(temporary.registry);
    await assert.rejects(temporary.storage.exportDirectory(board, [media], choice.id));
    assert.deepEqual(await fs.readdir(temporary.parent), [], 'the newly-created incomplete destination must be removed');
    await fs.rmdir(temporary.registry);
    const success = await temporary.storage.exportDirectory(board, [media], choice.id);
    assert.equal(success.status, 'saved'); assert.equal(JSON.parse(await fs.readFile(temporary.registry, 'utf8')).length, 1);
    const opened = await temporary.storage.open(success.directory); assert.ok(opened.kind === 'opened'); assert.deepEqual(await temporary.storage.readMedia(opened.board.storage!.id, opened.board.nodes.find(node => node.data.mediaId)!.data.mediaId!), media.data);
  } finally { await temporary.clean(); }
});

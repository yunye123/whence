import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, exportBoard, importBoard, validateBoard } from '../src/storage';
import { createNode, duplicateNode, exportMarkdown } from '../src/board-utils';
import type { VideoImportState } from '../src/model';

function fixture() {
  const board = createBoard('blank'), node = createNode('video');
  node.data.nativeImportJobId = 'desktop-job';
  node.data.sourceUrl = 'https://www.bilibili.com/video/BV1fixture';
  node.data.videoImport = {
    attemptId: 'attempt-one', url: node.data.sourceUrl, originalText: '分享视频 https://www.bilibili.com/video/BV1fixture',
    status: 'downloading', progress: 27.5, message: '正在下载', mediaReady: false,
    createdAt: board.createdAt, updatedAt: board.createdAt,
  };
  board.nodes = [node];
  return { board, node };
}

test('video jobs survive validated storage without dropping original links and task identity', () => {
  for (const status of ['queued', 'downloading', 'transcribing', 'completed', 'failed', 'cancelled', 'interrupted'] as const) {
    const { board, node } = fixture();
    node.data.videoImport!.status = status;
    const data = validateBoard(board).nodes[0].data;
    assert.deepEqual(data.videoImport, node.data.videoImport);
    assert.equal(data.nativeImportJobId, 'desktop-job');
    assert.equal(data.sourceUrl, node.data.sourceUrl);
  }
});

test('invalid video tasks fail validation before overwriting the saved workspace', () => {
  const cases: Partial<VideoImportState>[] = [
    { progress: NaN }, { progress: 101 }, { progress: -1 }, { url: 'file:///private.mp4' },
    { url: 'https://user:secret@example.com/v.mp4' }, { message: 'x'.repeat(4097) },
    { status: 'unknown' as never }, { mediaReady: 'true' as never }, { createdAt: 'yesterday' },
  ];
  for (const change of cases) {
    const { board, node } = fixture(); Object.assign(node.data.videoImport!, change);
    assert.throws(() => validateBoard(board));
  }
  const { board, node } = fixture(); node.data.kind = 'note';
  assert.throws(() => validateBoard(board), /只能属于视频/);
});

test('portable export detaches running tasks, keeps source and does not mutate original state', async () => {
  const { board, node } = fixture();
  const blob = await exportBoard(board), pkg = JSON.parse(await blob.text());
  assert.equal(pkg.board.nodes[0].data.nativeImportJobId, undefined);
  assert.equal(pkg.board.nodes[0].data.videoImport.status, 'interrupted');
  assert.equal(node.data.videoImport!.status, 'downloading');
  const restored = await importBoard(new File([blob], 'portable.field.json'));
  const data = restored.nodes[0].data;
  assert.equal(data.videoImport?.status, 'interrupted');
  assert.notEqual(data.videoImport?.attemptId, 'attempt-one');
  assert.equal(data.sourceUrl, node.data.sourceUrl);
  assert.equal(data.nativeImportJobId, undefined);
});

test('imported running task cannot silently start a new network request or claim an old task', async () => {
  const { board } = fixture();
  const pkg = JSON.parse(await (await exportBoard(board)).text());
  pkg.board.nodes[0].data.videoImport.status = 'queued';
  const restored = await importBoard(new File([JSON.stringify(pkg)], 'pending.field.json'));
  assert.equal(restored.nodes[0].data.videoImport?.status, 'interrupted');
  assert.notEqual(restored.nodes[0].data.videoImport?.attemptId, 'attempt-one');
});

test('duplicated card owns no original desktop task and Markdown keeps the public source', () => {
  const { board, node } = fixture();
  const copy = duplicateNode(node);
  assert.equal(copy.data.nativeImportJobId, undefined);
  assert.equal(copy.data.videoImport?.status, 'interrupted');
  assert.notEqual(copy.data.videoImport?.attemptId, node.data.videoImport?.attemptId);
  assert.equal(node.data.nativeImportJobId, 'desktop-job');
  node.data.url = 'media://library/source.mp4';
  assert.ok(exportMarkdown(board).includes(`来源：<${node.data.sourceUrl}>`));
  assert.ok(!exportMarkdown(board).includes('media://'));
});

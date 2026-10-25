import assert from 'node:assert/strict';
import test from 'node:test';
import { foldNotePictures, placeImageNote } from '../src/app/import-merge';
import { createNode } from '../src/board-utils';
import { createBoard } from '../src/templates';
import { validateBoard } from '../src/storage';

const url = 'https://www.xiaohongshu.com/explore/6a9286630000000025026294';

function waitingBoard() {
  const board = createBoard('blank');
  const node = createNode('video');
  const now = new Date().toISOString();
  node.position = { x: 40, y: 80 };
  node.style = { width: 320 };
  node.data = {
    ...node.data, title: '正在导入 · 小红书', body: '', sourceUrl: url, tags: ['小红书'],
    videoImport: { attemptId: 'attempt-1', url, originalText: '分享文案', status: 'downloading', message: '正在下载', mediaReady: false, createdAt: now, updatedAt: now },
  };
  board.nodes = [node];
  return { board, node, now };
}

test('an image note replaces the waiting card and keeps every picture on that card', () => {
  const { board, node, now } = waitingBoard();
  const note = {
    kind: 'note' as const, title: '李白的人生轨迹', body: '瀚文\n\n图片上的文字\n\n【1】\n出蜀',
    sourceUrl: url, sourceAuthor: '瀚文', sourceTitle: '李白的人生轨迹', sourceOriginalText: '分享文案',
    nativeProjectId: 'library-1', nativeDirectory: 'D:\\library', nativeImportJobId: 'job-1', collectedAt: now,
  };
  const images = [{ id: '11111111-1111-4111-8111-111111111111', data: { kind: 'image' as const, title: '1 李白的人生轨迹', body: '出蜀', url: 'media://library-1/media/a.webp', sourceUrl: url, nativeAssetId: 'asset-1', nativeProjectId: 'library-1', nativeDirectory: 'D:\\library', collectedAt: now } }];
  const placed = placeImageNote(board, node.id, note, images);
  assert.equal(placed.valid, true);
  assert.ok(placed.board);
  assert.equal(placed.board.nodes[0].data.kind, 'note');
  assert.equal(placed.board.nodes[0].data.title, '李白的人生轨迹');
  assert.match(placed.board.nodes[0].data.body, /出蜀/);
  assert.equal(placed.board.nodes[0].data.videoImport, undefined);
  assert.equal(placed.board.nodes.length, 1);
  assert.deepEqual(placed.board.nodes[0].data.pictures, ['media://library-1/media/a.webp']);
  assert.doesNotThrow(() => validateBoard(placed.board));
  const again = placeImageNote(placed.board, node.id, note, images);
  assert.equal(again.valid, true);
  assert.equal(again.board, undefined);
});

test('words the user already wrote stay ahead of the recognized text', () => {
  const { board, node, now } = waitingBoard();
  node.data.title = '我改过的标题';
  node.data.body = '我先记下的一句';
  const placed = placeImageNote(board, node.id, { kind: 'note', title: '李白的人生轨迹', body: '图片上的文字\n\n【1】\n出蜀', sourceUrl: url, collectedAt: now }, []);
  assert.equal(placed.board?.nodes[0].data.title, '我改过的标题');
  assert.match(placed.board?.nodes[0].data.body ?? '', /^我先记下的一句\n\n图片上的文字/);
});

test('every picture from one note stays on that note', () => {
  const { board, node, now } = waitingBoard();
  const images = Array.from({ length: 19 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    data: { kind: 'image' as const, title: `${index + 1}`, body: '', url: `media://library-1/media/${index}.webp`, sourceUrl: url, collectedAt: now },
  }));
  const placed = placeImageNote(board, node.id, { kind: 'note', title: '多图', body: '正文', sourceUrl: url, collectedAt: now }, images);
  assert.equal(placed.board?.nodes.length, 1);
  assert.equal(placed.board?.nodes[0].data.pictures?.length, 19);
  assert.equal(placed.board?.nodes[0].data.pictures?.[0], 'media://library-1/media/0.webp');
  assert.equal(placed.board?.nodes[0].data.pictures?.[18], 'media://library-1/media/18.webp');
});

test('pictures already laid out beside a note fold back onto it, left to right', () => {
  const board = createBoard('blank');
  const note = createNode('note');
  note.id = '33333333-3333-4333-8333-333333333333';
  note.position = { x: 40, y: 80 };
  note.data = { ...note.data, title: '李白的人生轨迹', body: '正文', sourceUrl: url };
  const right = createNode('image');
  right.position = { x: 800, y: 80 };
  right.data = { ...right.data, title: '2', url: 'media://library-1/media/b.webp', sourceUrl: url };
  const left = createNode('image');
  left.position = { x: 400, y: 80 };
  left.data = { ...left.data, title: '1', url: 'media://library-1/media/a.webp', sourceUrl: url };
  const other = createNode('image');
  other.position = { x: 400, y: 400 };
  other.data = { ...other.data, title: '别的', url: 'media://library-1/media/c.webp', sourceUrl: 'https://www.xiaohongshu.com/explore/other' };
  board.nodes = [note, right, left, other];
  const folded = foldNotePictures(validateBoard(board));
  assert.ok(folded);
  assert.equal(folded.nodes.length, 2);
  assert.deepEqual(folded.nodes.find(item => item.id === note.id)?.data.pictures, ['media://library-1/media/a.webp', 'media://library-1/media/b.webp']);
  assert.equal(folded.nodes.some(item => item.data.title === '别的'), true);
  assert.equal(foldNotePictures(folded), undefined);
});

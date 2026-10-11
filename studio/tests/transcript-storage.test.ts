import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode, duplicateNode } from '../src/board-utils';
import { createBoard, exportBoard, importBoard, saveWorkspace, validateBoard } from '../src/storage';
import { editTranscriptLine, transcriptRevision } from '../src/transcript-tools';

function fixture() {
  const board = createBoard('blank'), video = createNode('video'), quote = createNode('quote');
  video.data.transcript = [{ id: 'sentence-one', start: .125, end: 2.5, text: '原始识别文字' }];
  quote.data.body = '我的理解';
  quote.data.citation = { nodeId: video.id, title: video.data.title, start: .125, end: 2.5, text: '原始识别文字' };
  board.nodes = [video, quote];
  return { board, video, quote };
}

test('legacy schema 1 stays readable without adding or discarding optional correction metadata', async () => {
  const { board } = fixture();
  assert.deepEqual(validateBoard(board), board);
  const restored = await importBoard(new File([await exportBoard(board)], 'legacy.json'));
  assert.deepEqual(restored.nodes[0].data.transcript?.map(({ id, ...line }) => line), board.nodes[0].data.transcript?.map(({ id, ...line }) => line));
  assert.equal(restored.nodes[0].data.transcriptRevision, undefined);
  assert.equal(restored.nodes[1].data.citation?.transcriptRevision, undefined);
  assert.equal(transcriptRevision(restored.nodes[1].data.citation), 'initial');
  // Reaching the IndexedDB error verifies schema 1 validation succeeds in Node.
  await assert.rejects(saveWorkspace({ schema: 1, activeBoardId: board.id, boards: [board] }), /IndexedDB/);
});

test('validated and portable storage retain corrected text, original baseline and citation version snapshots', async () => {
  const { board, video, quote } = fixture();
  quote.data.citation!.transcriptRevision = 'initial';
  Object.assign(video.data, editTranscriptLine(video.data, 'sentence-one', '校对之后文字'));
  assert.deepEqual(validateBoard(board).nodes[0].data, video.data);
  const restored = await importBoard(new File([await exportBoard(board)], 'corrected.json'));
  assert.equal(restored.nodes[0].data.transcript?.[0].text, '校对之后文字');
  assert.equal(restored.nodes[0].data.transcript?.[0].originalText, '原始识别文字');
  assert.notEqual(restored.nodes[0].data.transcript?.[0].id, 'sentence-one');
  assert.equal(restored.nodes[0].data.transcriptRevision, video.data.transcriptRevision);
  assert.deepEqual(restored.nodes[1].data.citation, { ...quote.data.citation, nodeId: restored.nodes[0].id });
  assert.equal(restored.nodes[1].data.body, '我的理解');
  assert.notEqual(transcriptRevision(restored.nodes[1].data.citation), transcriptRevision(restored.nodes[0].data));
  await assert.rejects(saveWorkspace({ schema: 1, activeBoardId: board.id, boards: [board] }), /IndexedDB/);
});

test('duplication copies baseline and revision by value, while allocating new sentence identity', () => {
  const { video, quote } = fixture();
  Object.assign(video.data, editTranscriptLine(video.data, 'sentence-one', '校对后'));
  quote.data.citation!.transcriptRevision = video.data.transcriptRevision;
  const copy = duplicateNode(video), quoteCopy = duplicateNode(quote);
  assert.equal(copy.data.transcript?.[0].originalText, '原始识别文字');
  assert.equal(copy.data.transcriptRevision, video.data.transcriptRevision);
  assert.notEqual(copy.data.transcript?.[0].id, video.data.transcript?.[0].id);
  assert.deepEqual(quoteCopy.data.citation, quote.data.citation);
  copy.data.transcript![0].originalText = '副本的基线';
  quoteCopy.data.citation!.transcriptRevision = 'other';
  assert.equal(video.data.transcript?.[0].originalText, '原始识别文字');
  assert.equal(quote.data.citation?.transcriptRevision, video.data.transcriptRevision);
});

test('new fields keep literal writing but reject dangerous values, oversized strings and foreign keys', () => {
  const { board, video, quote } = fixture();
  video.data.transcript![0].originalText = '<script>字面文字</script>';
  assert.equal(validateBoard(board).nodes[0].data.transcript?.[0].originalText, '<script>字面文字</script>');
  for (const value of [null, 3, {}, ['a'], 'x'.repeat(20_001), 'a\u0000b']) {
    video.data.transcript![0].originalText = value as string;
    assert.throws(() => validateBoard(board));
  }
  video.data.transcript![0].originalText = 'x'.repeat(20_000);
  assert.doesNotThrow(() => validateBoard(board));
  for (const value of [null, 3, {}, ['a'], '', ' \n ', 'x'.repeat(161), 'a\u0000b']) {
    video.data.transcriptRevision = value as string;
    assert.throws(() => validateBoard(board));
    delete video.data.transcriptRevision;
    quote.data.citation!.transcriptRevision = value as string;
    assert.throws(() => validateBoard(board));
    delete quote.data.citation!.transcriptRevision;
  }
  Object.assign(video.data.transcript![0], { revisionHistory: [] });
  assert.throws(() => validateBoard(board), /不支持的字段/);
});

test('new metadata cannot bypass prototype-key checks during portable import', async () => {
  const { board } = fixture();
  const packed = JSON.parse(await (await exportBoard(board)).text());
  for (const property of ['__proto__', 'prototype', 'constructor']) {
    const poisoned = structuredClone(packed);
    Object.defineProperty(poisoned.board.nodes[0].data.transcript[0], property, { value: { polluted: true }, enumerable: true });
    await assert.rejects(importBoard(new File([JSON.stringify(poisoned)], 'unsafe.json')), /不安全/);
  }
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('transcript count and current text limits still apply with correction metadata', () => {
  const { board, video } = fixture();
  const line = { ...video.data.transcript![0], originalText: '旧文字' };
  video.data.transcript = Array.from({ length: 10_001 }, (_, index) => ({ ...line, id: `line-${index}` }));
  assert.throws(() => validateBoard(board), /数量/);
  video.data.transcript = [{ ...line, text: 'x'.repeat(20_001) }];
  assert.throws(() => validateBoard(board), /过长/);
});

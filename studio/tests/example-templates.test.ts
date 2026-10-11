import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBoard, validateBoard } from '../src/storage';
import { BREAKFAST_FILM, EXAMPLES, SAMPLE_ASSET_PATTERN, createExampleBoard, isSampleAsset, type ExampleId } from '../src/templates';
import { parseDraftReferences } from '../src/draft-references';
import { resolveTextAnchor } from '../src/text-anchor';
import type { Board, BoardNode } from '../src/model';

const IDS: ExampleId[] = ['writing', 'video', 'creative'];
const samplesDir = path.resolve(import.meta.dirname, '../public/assets/samples');
const byKind = (board: Board, kind: BoardNode['data']['kind']) => board.nodes.filter(node => node.data.kind === kind);
const mediaRefs = (board: Board) => [board.cover, ...board.nodes.flatMap(node => [node.data.poster, node.data.url])].filter((value): value is string => !!value && value.startsWith('/'));

test('example boards satisfy the persisted and portable data contract, sample media paths included', () => {
  for (const id of IDS) {
    const board = createExampleBoard(id);
    assert.deepEqual(validateBoard(board), board, id);
    assert.ok(validateBoard(board, true), `${id} portable`);
    assert.ok(board.nodes.every(node => node.data.demo === true), `${id} marks every card as example content`);
    assert.ok(mediaRefs(board).every(isSampleAsset), `${id} references only shipped samples`);
  }
  assert.deepEqual(EXAMPLES.map(example => example.id), IDS);
  assert.ok(EXAMPLES.every(example => (example.cover === undefined || isSampleAsset(example.cover)) && createExampleBoard(example.id).title === example.title));
});

test('every referenced sample file is shipped within its size budget', () => {
  const refs = new Set([...IDS.flatMap(id => mediaRefs(createExampleBoard(id))), ...EXAMPLES.flatMap(example => example.cover ? [example.cover] : [])]);
  for (const ref of refs) {
    assert.match(ref, SAMPLE_ASSET_PATTERN);
    const file = path.join(samplesDir, path.basename(ref));
    assert.ok(fs.existsSync(file), `missing ${ref}`);
    const limit = ref.endsWith('.mp4') ? 3 * 1024 * 1024 : 300 * 1024;
    assert.ok(fs.statSync(file).size <= limit, `${ref} exceeds ${limit} bytes`);
  }
});

test('each call returns fresh ids and every citation resolves to its exact source position', () => {
  for (const id of IDS) {
    const first = createExampleBoard(id), second = createExampleBoard(id);
    assert.notEqual(first.id, second.id);
    assert.ok(first.nodes.every(node => !second.nodes.some(other => other.id === node.id)));
    for (const quote of byKind(first, 'quote')) {
      const citation = quote.data.citation!;
      const source = first.nodes.find(node => node.id === citation.nodeId)!;
      assert.ok(source, `${quote.data.title} source exists`);
      assert.ok(quote.data.body.trim(), `${quote.data.title} carries a reading note (我的理解)`);
      assert.ok(first.edges.some(edge => edge.source === source.id && edge.target === quote.id), 'source → excerpt edge');
      if (citation.textAnchor) assert.equal(resolveTextAnchor(source.data.body, citation).status, 'matched');
      else {
        const lines = source.data.transcript!.filter(line => line.start >= citation.start! && line.end <= citation.end!);
        assert.equal(citation.text, lines.map(line => line.text).join('\n'));
      }
    }
    for (const draft of byKind(first, 'draft')) {
      const references = parseDraftReferences(draft.data.body);
      assert.equal(references.length, 2, `${id} draft cites two sources`);
      for (const reference of references) {
        const quote = first.nodes.find(node => node.id === reference.quoteNodeId)!;
        assert.equal(quote?.data.citation?.nodeId, reference.sourceNodeId);
        assert.equal(reference.time, quote.data.citation?.start);
      }
      assert.ok(draft.data.draftVersions?.length, 'draft shows an earlier version (第二稿)');
    }
  }
});

test('writing example: imported Markdown article, excerpts, link and a second draft', () => {
  const board = createExampleBoard('writing');
  const article = byKind(board, 'note').find(node => node.data.tags?.includes('文字资料'))!;
  const visible = article.data.body.replace(/^#+\s/gm, '').replace(/\s/g, '');
  assert.ok(visible.length >= 1500 && visible.length <= 2500, `article length ${visible.length}`);
  assert.match(article.data.body, /^# .+\n[\s\S]*\n## /);
  assert.ok(byKind(board, 'quote').length >= 2 && byKind(board, 'quote').length <= 3);
  assert.equal(byKind(board, 'link')[0].data.url, 'https://example.org/walking-survey-notes');
  assert.equal(board.category, 'writing');
});

test('video example keeps contract K1: subtitles start at 0, 6 and 13 seconds', () => {
  const board = createExampleBoard('video');
  const video = byKind(board, 'video')[0];
  const transcript = video.data.transcript!;
  assert.deepEqual(transcript.slice(0, 2).map(({ start, end }) => [start, end]), [[0, 6], [6, 13]]);
  assert.equal(transcript[2].start, 13);
  assert.ok(transcript.length >= 20);
  transcript.forEach((line, index) => { assert.ok(line.end > line.start); if (index) assert.equal(line.start, transcript[index - 1].end); });
  assert.equal(video.data.duration, transcript.at(-1)!.end);
  assert.equal(video.data.url, BREAKFAST_FILM.file);
  assert.ok(byKind(board, 'quote').every(quote => quote.data.citation?.start !== undefined));
  // Shape that lets the integration stage reuse it as the first-run demo (tests/storage-model.test.ts).
  assert.equal(board.nodes.length, 7);
  assert.ok(board.nodes.every(node => node.position.x >= 0 && node.position.x <= 1400 && node.position.y <= 700));
  assert.equal(board.edges[0].source, video.id);
  assert.equal(board.edges[0].target, byKind(board, 'quote')[0].id);
  // targeted-smoke finds the video in the card list by a substring match on its title.
  assert.ok(board.nodes.every(node => node === video || !node.data.title.includes(video.data.title)));
});

test('creative example: 10–12 images at their own ratio in two group trays', () => {
  const board = createExampleBoard('creative');
  const frames = byKind(board, 'frame'), images = byKind(board, 'image');
  assert.equal(frames.length, 2);
  assert.ok(images.length >= 10 && images.length <= 12);
  assert.ok(byKind(board, 'note').length >= 1);
  assert.equal(new Set(images.map(image => Math.round(image.style!.width! / image.style!.height! * 100))).size >= 5, true, 'mixed aspect ratios');
  for (const image of images) {
    const box = { x: image.position.x, y: image.position.y, w: image.style!.width!, h: image.style!.height! };
    const owner = frames.filter(frame => box.x >= frame.position.x && box.y >= frame.position.y
      && box.x + box.w <= frame.position.x + frame.style!.width! && box.y + box.h <= frame.position.y + frame.style!.height!);
    assert.equal(owner.length, 1, `${image.data.title} lies inside exactly one tray`);
    for (const other of images) {
      if (other === image) continue;
      const overlap = box.x < other.position.x + other.style!.width! && other.position.x < box.x + box.w
        && box.y < other.position.y + other.style!.height! && other.position.y < box.y + box.h;
      assert.ok(!overlap, `${image.data.title} × ${other.data.title}`);
    }
  }
});

test('edge labels get a channel of at least 40px and the starting row fits 1366×768 at 100%', () => {
  // Visible canvas at 1366×768: 1366 − 240 sidebar − 24 safe gap wide (DESIGN_SYSTEM §5.1–5.2).
  const visibleRight = 1366 - 240 - 24;
  for (const id of IDS) {
    const board = createExampleBoard(id);
    assert.equal(board.viewport.zoom, 1);
    for (const edge of board.edges) {
      const source = board.nodes.find(node => node.id === edge.source)!, target = board.nodes.find(node => node.id === edge.target)!;
      const horizontalGap = target.position.x - (source.position.x + (source.style?.width ?? 0));
      const vertical = source.position.x === target.position.x;
      assert.ok(vertical || horizontalGap >= 40, `${id}: ${edge.label} channel ${horizontalGap}`);
    }
    for (const node of board.nodes.filter(node => node.position.y <= 0 || node.data.kind === 'frame' && node.position.y < 100)) {
      assert.ok(board.viewport.x + node.position.x + (node.style?.width ?? 0) <= visibleRight, `${id}: ${node.data.title} is cut off at 1366 wide`);
    }
  }
});

/** Card heights estimated from the DESIGN_SYSTEM §6.9–6.14 type specs; the layout must not overlap at these sizes. */
function estimatedHeight(node: BoardNode): number {
  if (node.style?.height) return node.style.height;
  const lines = (text: string, perLine: number) => text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / perLine)), 0);
  const width = node.style?.width ?? 290;
  switch (node.data.kind) {
    case 'video': return Math.round(width * 9 / 16) + 90;
    case 'quote': return 40 + 25 * lines(node.data.citation?.text ?? '', 16) + (node.data.body ? 23 + 25 * lines(node.data.body, 15) : 0) + 14;
    case 'draft': return 420;
    case 'link': return 120;
    case 'note': return node.data.tags?.includes('文字资料') ? 170 : 28 + 27 * lines(node.data.body, Math.floor((width - 32) / 16));
    default: return 200;
  }
}

test('cards do not overlap at the redesigned card heights (24px air)', () => {
  for (const id of IDS) {
    const cards = createExampleBoard(id).nodes.filter(node => node.data.kind !== 'frame' && node.data.kind !== 'image');
    for (const [index, a] of cards.entries()) for (const b of cards.slice(index + 1)) {
      const ax = a.position.x, ay = a.position.y, aw = a.style!.width!, ah = estimatedHeight(a);
      const bx = b.position.x, by = b.position.y, bw = b.style!.width!, bh = estimatedHeight(b);
      const clash = ax < bx + bw + 24 && bx < ax + aw + 24 && ay < by + bh + 24 && by < ay + ah + 24;
      assert.ok(!clash, `${id}: ${a.data.title} × ${b.data.title}`);
    }
  }
});

test('new-board templates no longer store instructions as card content (F-M2, CD-M3)', () => {
  for (const template of ['video', 'writing', 'design'] as const) {
    const board = createBoard(template);
    assert.ok(!board.nodes.some(node => node.data.kind === 'link' && !node.data.url), `${template}: no link card without a URL`);
    assert.ok(!board.nodes.some(node => node.data.kind === 'image' && !node.data.mediaId && !node.data.poster), `${template}: no empty image card`);
    assert.ok(!board.nodes.some(node => /粘贴|拖入|贴进/.test(node.data.body)), `${template}: no instructions in body`);
  }
});

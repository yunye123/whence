import assert from 'node:assert/strict';
import test from 'node:test';
import type { XImportResult, XMedia } from '../shared/x-import';
import { createNode } from '../src/board-utils';
import { getCardBounds } from '../src/card-placement';
import { formatDraftQuote, parseDraftReferences } from '../src/draft-references';
import type { Board, MediaRecord } from '../src/model';
import { createBoard, exportBoard, getMedia, importBoard, saveMedia, STORAGE_LIMITS, validateBoard } from '../src/storage';
import { createTextQuoteBatch } from '../src/text-sources';
import { getXImportDuplicate, prepareXImport } from '../src/x-import';
import { getStoredXPostText } from '../src/x-post-source';

const url = 'https://x.com/creator/status/2104200939095904322';
const imageA: XMedia = { kind: 'image', url: 'https://pbs.twimg.com/media/first.jpg', altText: '准确的图像说明🙂' };
const imageB: XMedia = { kind: 'image', url: 'https://pbs.twimg.com/media/second.png' };
const videoA: XMedia = { kind: 'video', url: 'https://video.twimg.com/clip.mp4', duration: 37.25, thumbnailUrl: 'https://pbs.twimg.com/media/poster.jpg' };
const gif: XMedia = { kind: 'gif', url: 'https://video.twimg.com/motion.mp4' };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const position = { x: 100, y: 80 };
function result(media: XMedia[] = [imageA, videoA, imageB, gif]): XImportResult {
  return {
    post: { id: '2104200939095904322', url: `${url}?s=20`, title: '原作者的原帖标题', author: { name: '作者名字', handle: 'creator', url: 'https://x.com/creator' }, text: '  正文 <字面标签> **Markdown**\r\n第二段🙂 \n', publishedAt: '2026-10-03T12:00:00.000Z', provider: 'fxtwitter', contentKind: 'post', completeness: 'complete', warnings: [], media },
    images: media.filter(item => item.kind === 'image').map((source, i) => ({ source, name: `图片${i + 1}.png`, mime: 'image/png', data: png.slice() })),
  };
}
function mediaStore() {
  const records = new Map<string, MediaRecord>(), removed: string[] = [];
  let serial = 0;
  return {
    records, removed,
    async saveMedia(blob: Blob, name = '') { const record = { id: `new-media-${++serial}`, name, mime: blob.type, blob, createdAt: '2026-10-04T00:00:00.000Z' }; records.set(record.id, record); return record; },
    async removeMedia(id: string) { removed.push(id); records.delete(id); },
  };
}
function overlaps(a: Board['nodes'][number], b: Board['nodes'][number]) {
  const x = getCardBounds(a), y = getCardBounds(b);
  return x.x < y.x + y.width && x.x + x.width > y.x && x.y < y.y + y.height && x.y + x.height > y.y;
}

test('X batch preserves literal text, authorship, media order and precise video task ownership', async () => {
  const original = createBoard('writing'), before = structuredClone(original), input = result(), media = mediaStore();
  const prepared = await prepareXImport(input, original, { position, ...media, originalText: `分享文案\r\n${url}?s=20` });
  assert.deepEqual(original, before);
  assert.equal(prepared.nodes.length, 3);
  assert.deepEqual(prepared.nodes.map(node => node.data.kind), ['link', 'video', 'video']);
  const source = prepared.nodes[0];
  assert.equal(source.data.body, input.post.text);
  assert.equal(source.data.sourceOriginalText, input.post.text);
  assert.equal(source.data.url, url); assert.equal(source.data.sourceUrl, url);
  assert.equal(source.data.sourceTitle, input.post.title);
  assert.equal(source.data.sourceAuthor, '作者名字 (@creator)');
  assert.match(String(source.data.sourceStatus), /第三方 FxTwitter.*正文完整.*图片已保存 2\/2.*原帖发布时间.*获取时间/);
  assert.equal(prepared.board.edges.length, 2);
  assert.ok(prepared.board.edges.every(edge => edge.source === source.id));
  assert.deepEqual(prepared.board.edges.map(edge => edge.target), prepared.nodes.slice(1).map(node => node.id));
  assert.deepEqual(prepared.mediaIds, ['new-media-1', 'new-media-2']);
  assert.deepEqual(source.data.pictures, ['field-picture:new-media-1:1', 'field-picture:new-media-2:2']);
  for (const id of prepared.mediaIds) {
    assert.ok(media.records.has(id));
    assert.deepEqual(new Uint8Array(await media.records.get(id)!.blob.arrayBuffer()), png);
  }
  const videos = prepared.nodes.filter(node => node.data.kind === 'video');
  assert.deepEqual(videos.map(node => node.data.sourceUrl), [`${url}/video/1`, `${url}/video/2`]);
  assert.deepEqual(prepared.videoNodeIds, videos.map(node => node.id));
  for (const node of videos) {
    assert.equal(node.data.videoImport!.status, 'queued'); assert.equal(node.data.videoImport!.mediaReady, false);
    assert.equal(node.data.videoImport!.originalText, `分享文案\r\n${url}?s=20`);
    assert.equal(node.data.videoImport!.url, node.data.sourceUrl); assert.equal(node.data.sourceOriginalText, input.post.text);
    assert.equal(node.data.nativeImportJobId, undefined); assert.equal(node.data.mediaId, undefined);
  }
  assert.notEqual(videos[0].data.videoImport!.attemptId, videos[1].data.videoImport!.attemptId);
  assert.equal(videos[0].data.duration, 37.25);
  for (const [index, node] of prepared.nodes.entries()) for (const other of prepared.nodes.slice(index + 1)) assert.equal(overlaps(node, other), false);
  assert.doesNotThrow(() => validateBoard(prepared.board));
});

test('same status aliases identify one source and complete repeated imports create no card or media', async () => {
  const media = mediaStore(), input = result();
  const first = await prepareXImport(input, createBoard('blank'), { position, ...media });
  first.board.nodes[0].data.body = '我已编辑过的正文'; first.board.nodes[0].data.title = '我改过的标题';
  const before = structuredClone(first.board);
  const duplicate = getXImportDuplicate(first.board, 'https://twitter.com/another/status/2104200939095904322/video/2?s=20');
  assert.equal(duplicate.sourceNodeId, first.sourceNodeId); assert.equal(duplicate.nodeIds.length, 3);
  assert.deepEqual(duplicate.imageNumbers, [1, 2]); assert.deepEqual(duplicate.videoNumbers, [1, 2]);
  const repeated = await prepareXImport(input, first.board, { position, ...media });
  assert.equal(repeated.board, first.board); assert.equal(repeated.duplicate, true);
  assert.deepEqual(repeated.nodes, []); assert.deepEqual(repeated.mediaIds, []); assert.deepEqual(repeated.videoNodeIds, []);
  assert.equal(media.records.size, 2); assert.deepEqual(first.board, before);
  assert.throws(() => getXImportDuplicate(first.board, 'https://example.com/status/2104200939095904322'), /X 推文链接/);
});

test('legacy bare-status video counts as clip 1 without replacing its material or task', async () => {
  const board = createBoard('blank'), existing = createNode('video'), media = mediaStore();
  existing.data = {
    ...existing.data, title: '我已编辑的旧视频', body: '我的视频笔记', mediaId: 'old-cached-file', sourceUrl: 'https://twitter.com/creator/status/2104200939095904322?s=20',
    videoImport: { attemptId: 'old-attempt', url, originalText: '旧分享文案', status: 'completed', message: '完成', mediaReady: true, createdAt: board.createdAt, updatedAt: board.updatedAt },
  };
  board.nodes = [existing]; const snapshot = structuredClone(existing);
  assert.deepEqual(getXImportDuplicate(board, url).videoNumbers, [1]);
  const prepared = await prepareXImport(result([videoA, gif]), board, { position, ...media });
  const preserved = prepared.board.nodes.find(node => node.id === existing.id)!;
  for (const key of Object.keys(snapshot.data)) assert.deepEqual(preserved.data[key], snapshot.data[key], key);
  assert.equal(preserved.data.sourceOriginalText, result().post.text);
  assert.equal(preserved.data.sourceAuthor, '作者名字 (@creator)');
  assert.ok(prepared.board.edges.some(edge => edge.source === prepared.sourceNodeId && edge.target === existing.id));
  assert.deepEqual(prepared.nodes.map(node => node.data.kind), ['link', 'video']);
  assert.equal(prepared.nodes[1].data.sourceUrl, `${url}/video/2`);
  assert.deepEqual(prepared.videoNodeIds, [prepared.nodes[1].id]);
  const another = createNode('video'); another.data.sourceUrl = 'https://x.com/creator/status/123';
  assert.deepEqual(getXImportDuplicate({ ...board, nodes: [another] }, url).videoNumbers, []);
});

test('partial image failures are explicit and a repeated import fills only missing slots while preserving edits', async () => {
  const media = mediaStore(), input = result([imageA, imageB, videoA]);
  input.images[1] = { source: imageB, name: '不可用.png', error: '图片服务器连接超时' };
  const first = await prepareXImport(input, createBoard('blank'), { position, ...media });
  assert.equal(first.nodes.length, 2); assert.equal(media.records.size, 1);
  assert.match(first.warnings.join('\n'), /图片 2 未保存.*连接超时.*补齐/);
  assert.match(String(first.nodes[0].data.sourceStatus), /图片已保存 1\/2.*缺失图片/);
  first.board.nodes[0].data.body = '已修改正文';
  const second = await prepareXImport(result([imageA, imageB, videoA]), first.board, { position, ...media });
  assert.equal(second.nodes.length, 0);
  assert.deepEqual(second.board.nodes[0].data.pictures?.map(item => item.split(':').at(-1)), ['1', '2']);
  assert.equal(second.board.nodes[0].data.body, '已修改正文');
  assert.equal(second.board.nodes[0].data.sourceOriginalText, input.post.text);
  assert.match(String(second.board.nodes[0].data.sourceStatus), /图片已保存 2\/2/);
  assert.equal(second.videoNodeIds.length, 0); assert.equal(media.records.size, 2);
  assert.equal(second.board.edges.length, 1);
});

test('a recovered complete body creates one linked version while preserving preview edits and existing quotes', async () => {
  const input = result([imageA, imageB]); input.post.completeness = 'partial'; input.post.text = '预览正文'; input.images[1].data = undefined;
  const media = mediaStore(), first = await prepareXImport(input, createBoard('blank'), { position, ...media });
  const oldStatus = first.board.nodes[0].data.sourceStatus;
  const quoted = createTextQuoteBatch(first.board, first.sourceNodeId, { from: 0, to: 4 });
  quoted.board.nodes[0].data.body = '我的后续编辑';
  const oldQuote = structuredClone(quoted.quotes[0]);
  const complete = result([imageA, imageB]);
  const second = await prepareXImport(complete, quoted.board, { position, ...media });
  assert.equal(second.board.nodes[0].data.body, '我的后续编辑');
  assert.equal(second.board.nodes[0].data.sourceOriginalText, '预览正文');
  assert.equal(second.board.nodes[0].data.sourceStatus, oldStatus);
  assert.deepEqual(second.board.nodes.find(node => node.id === oldQuote.id), oldQuote);
  assert.notEqual(second.sourceNodeId, first.sourceNodeId);
  assert.deepEqual(second.nodes.map(node => node.data.kind), ['link']);
  const fullSource = second.nodes[0];
  assert.equal(fullSource.data.body, complete.post.text); assert.equal(fullSource.data.sourceOriginalText, complete.post.text);
  assert.match(String(fullSource.data.sourceStatus), /正文完整/);
  assert.ok(second.board.edges.some(edge => edge.source === first.sourceNodeId && edge.target === fullSource.id && edge.label === '完整正文版本'));
  assert.equal(second.mediaIds.length, 1); assert.equal(media.records.size, 2);
  assert.match(second.warnings.join('\n'), /新增完整正文版本.*已有摘录均已保留/);
  const repeated = await prepareXImport(complete, second.board, { position, ...media });
  assert.equal(repeated.sourceNodeId, fullSource.id); assert.equal(repeated.board, second.board);
  assert.deepEqual(repeated.nodes, []); assert.deepEqual(repeated.mediaIds, []);
  assert.equal(getXImportDuplicate(second.board, url).sourceNodeId, fullSource.id);
  assert.doesNotThrow(() => validateBoard(second.board));
});

test('different captured complete text is preserved and generic user notes no longer suppress newly fetched body', async () => {
  const media = mediaStore(), first = await prepareXImport(result([imageA]), createBoard('blank'), { position, ...media });
  const changed = result([imageA, imageB]); changed.post.text = '后来变更的完整正文';
  const second = await prepareXImport(changed, first.board, { position, ...media });
  assert.equal(second.sourceNodeId, first.sourceNodeId); assert.equal(second.nodes.length, 0);
  assert.equal(second.mediaIds.length, 1);
  assert.equal(second.board.nodes[0].data.sourceOriginalText, first.board.nodes[0].data.sourceOriginalText);
  assert.match(second.warnings.join('\n'), /现有原帖卡不同.*保留.*仅补充/);
  const generic = createNode('link'); generic.data.url = url; generic.data.body = '我的网页阅读笔记';
  const board = createBoard('blank'); board.nodes = [generic];
  const genericPrepared = await prepareXImport(result([]), board, { position, ...media });
  assert.notEqual(genericPrepared.sourceNodeId, generic.id); assert.equal(genericPrepared.nodes.length, 1);
  assert.equal(genericPrepared.nodes[0].data.body, result([]).post.text);
  assert.equal(genericPrepared.nodes[0].data.sourceOriginalText, result([]).post.text);
  assert.equal(genericPrepared.board.nodes[0].data.body, '我的网页阅读笔记');
  assert.deepEqual(genericPrepared.board.nodes[0], generic);
  assert.ok(genericPrepared.board.edges.some(edge => edge.source === generic.id && edge.target === genericPrepared.sourceNodeId));
  assert.equal(genericPrepared.duplicate, false);
  const repeated = await prepareXImport(result([]), genericPrepared.board, { position, ...media });
  assert.equal(repeated.sourceNodeId, genericPrepared.sourceNodeId); assert.equal(repeated.duplicate, true);
  assert.equal(repeated.board, genericPrepared.board);
});

test('already downloaded video and image gain body provenance and edges without new files or video tasks', async () => {
  const board = createBoard('blank'), video = createNode('video'), image = createNode('image'), unrelated = createNode('video');
  video.data = { ...video.data, title: '我改过的视频名', body: '保留我的观看笔记', mediaId: 'downloaded-video', sourceUrl: url, sourceOriginalText: url,
    nativeAssetId: 'existing-native-asset', nativeProjectId: 'existing-library', nativeImportJobId: 'completed-job',
    transcript: [{ id: 'manual-line', start: 0, end: 5, text: '我的校对字幕', originalText: '原字幕' }], transcriptRevision: 'manual-revision',
    videoImport: { attemptId: 'kept-attempt', url, originalText: url, status: 'completed', message: '完成', mediaReady: true, createdAt: board.createdAt, updatedAt: board.updatedAt } };
  image.data = { ...image.data, title: '我的图片标题', body: '我的画面笔记', mediaId: 'downloaded-image', sourceUrl: `${url}/photo/1` };
  unrelated.data.sourceUrl = 'https://x.com/creator/status/123'; unrelated.data.mediaId = 'unrelated';
  board.nodes = [video, image, unrelated]; const before = structuredClone(board); let stores = 0;
  const input = result([imageA, videoA]);
  const prepared = await prepareXImport(input, board, { position, saveMedia: async () => { stores++; throw new Error('must not download'); } });
  assert.equal(stores, 0); assert.deepEqual(prepared.videoNodeIds, []); assert.deepEqual(prepared.mediaIds, []);
  assert.deepEqual(prepared.nodes.map(node => node.data.kind), ['link']); assert.equal(prepared.duplicate, false);
  assert.equal(prepared.nodes[0].data.body, input.post.text);
  const keptVideo = prepared.board.nodes.find(node => node.id === video.id)!, keptImage = prepared.board.nodes.find(node => node.id === image.id)!;
  for (const key of ['title', 'body', 'mediaId', 'nativeAssetId', 'nativeProjectId', 'nativeImportJobId', 'transcript', 'transcriptRevision', 'videoImport']) assert.deepEqual(keptVideo.data[key], video.data[key], key);
  assert.equal(keptVideo.data.sourceOriginalText, input.post.text); assert.equal(keptVideo.data.sourceTitle, input.post.title);
  assert.equal(keptVideo.data.sourceAuthor, '作者名字 (@creator)'); assert.match(String(keptVideo.data.sourceStatus), /正文完整/);
  assert.equal(keptImage.data.sourceOriginalText, input.post.text); assert.equal(keptImage.data.body, image.data.body); assert.equal(keptImage.data.title, image.data.title);
  assert.deepEqual(prepared.board.nodes.find(node => node.id === unrelated.id), unrelated);
  assert.deepEqual(prepared.board.edges.filter(edge => edge.source === prepared.sourceNodeId).map(edge => edge.target), [video.id, image.id]);
  assert.deepEqual(board, before);
  const repeated = await prepareXImport(input, prepared.board, { position, saveMedia: async () => { throw new Error('must not download'); } });
  assert.equal(repeated.duplicate, true); assert.equal(repeated.board, prepared.board);
});

test('sourceOnly repairs a multi-media post without creating or saving any new video or image', async () => {
  const input = result([imageA, videoA, imageB, gif]), board = createBoard('blank'), generic = createNode('link'), video = createNode('video');
  generic.data.url = url; generic.data.body = '我的原有链接笔记';
  video.data.sourceUrl = url; video.data.mediaId = 'existing-downloaded-video'; video.data.body = '我的观看笔记';
  board.nodes = [generic, video]; const before = structuredClone(board); let stores = 0;
  const sourceOnly = await prepareXImport(input, board, { position, sourceOnly: true, saveMedia: async () => { stores++; throw new Error('must not save images'); } });
  assert.equal(stores, 0); assert.deepEqual(sourceOnly.nodes.map(node => node.data.kind), ['link']);
  assert.deepEqual(sourceOnly.videoNodeIds, []); assert.deepEqual(sourceOnly.mediaIds, []);
  assert.equal(sourceOnly.nodes[0].data.body, input.post.text); assert.equal(sourceOnly.duplicate, false);
  assert.equal(sourceOnly.board.nodes.find(node => node.id === video.id)!.data.sourceOriginalText, input.post.text);
  assert.equal(sourceOnly.board.nodes.find(node => node.id === video.id)!.data.body, '我的观看笔记');
  assert.ok(sourceOnly.board.edges.some(edge => edge.source === sourceOnly.sourceNodeId && edge.target === video.id));
  assert.deepEqual(sourceOnly.board.nodes.find(node => node.id === generic.id), generic);
  assert.deepEqual(board, before);
  const repeated = await prepareXImport(input, sourceOnly.board, { position, sourceOnly: true, saveMedia: async () => { throw new Error('must not save'); } });
  assert.equal(repeated.duplicate, true); assert.equal(repeated.board, sourceOnly.board);
  const media = mediaStore();
  const normal = await prepareXImport(input, sourceOnly.board, { position, ...media });
  assert.deepEqual(normal.nodes.map(node => node.data.kind), ['video']);
  assert.equal(normal.videoNodeIds.length, 1); assert.equal(normal.mediaIds.length, 2);
});

test('sourceOnly replaces stale unavailable status together with text and preserves Article media identity', async () => {
  for (const article of [false, true]) {
    const input = result([videoA]), board = createBoard('blank'), video = createNode('video');
    if (article) input.post.contentKind = 'article';
    video.data.sourceUrl = url; video.data.mediaId = 'downloaded-clip'; video.data.sourceOriginalText = url;
    video.data.body = '用户的观看笔记';
    video.data.sourceStatus = article ? `文章视频 1；视频源：${videoA.url}；原帖正文尚未取得，视频已保留。` : '原帖正文尚未取得，视频已保留。';
    board.nodes = [video]; const before = structuredClone(board);
    assert.equal(getStoredXPostText(video), undefined);
    const prepared = await prepareXImport(input, board, { position, sourceOnly: true });
    const repaired = prepared.board.nodes.find(node => node.id === video.id)!;
    assert.equal(getStoredXPostText(repaired), input.post.text);
    assert.doesNotMatch(String(repaired.data.sourceStatus), /正文尚未取得/);
    assert.match(String(repaired.data.sourceStatus), /由第三方 FxTwitter 取得；正文完整/);
    if (article) {
      assert.ok(String(repaired.data.sourceStatus).startsWith(`文章视频 1；视频源：${videoA.url}；`));
      assert.deepEqual(getXImportDuplicate(prepared.board, url).videoNumbers, [1]);
    }
    assert.equal(repaired.data.body, video.data.body); assert.equal(repaired.data.mediaId, video.data.mediaId);
    assert.deepEqual(prepared.videoNodeIds, []); assert.deepEqual(prepared.mediaIds, []); assert.deepEqual(board, before);
  }
});

test('confirmed empty native snapshots remain complete while unverified empty snapshots can be repaired', async () => {
  const input = result([videoA]), board = createBoard('blank'), video = createNode('video'), source = createNode('link');
  video.data.sourceUrl = url; video.data.mediaId = 'existing-clip'; video.data.sourceOriginalText = '';
  video.data.sourceStatus = '原帖没有文字正文；已通过公开内容服务核对。'; video.data.body = '我的观看笔记';
  source.data.url = url; source.data.sourceOriginalText = ''; source.data.body = '我的后续阅读笔记';
  source.data.sourceStatus = '原帖没有文字正文；已通过公开内容服务核对。';
  board.nodes = [source, video]; const sourceSnapshot = structuredClone(source);
  assert.equal(getXImportDuplicate(board, url).sourceNodeId, source.id);
  const prepared = await prepareXImport(input, board, { position, sourceOnly: true });
  assert.deepEqual(prepared.nodes, []); assert.equal(prepared.sourceNodeId, source.id);
  const kept = prepared.board.nodes.find(node => node.id === video.id)!;
  assert.equal(kept.data.sourceOriginalText, ''); assert.equal(kept.data.sourceStatus, video.data.sourceStatus);
  assert.equal(getStoredXPostText(kept), ''); assert.deepEqual(prepared.board.nodes.find(node => node.id === source.id), sourceSnapshot);
  const uncertain = createNode('video'); uncertain.data.sourceUrl = url; uncertain.data.mediaId = 'unconfirmed-clip'; uncertain.data.sourceOriginalText = '';
  uncertain.data.sourceStatus = '原帖正文尚未取得，视频已保留。';
  const unverifiedBoard = { ...board, nodes: [uncertain] };
  const repaired = await prepareXImport(input, unverifiedBoard, { position, sourceOnly: true });
  assert.equal(getStoredXPostText(repaired.board.nodes.find(node => node.id === uncertain.id)!), input.post.text);
});

test('native complete collected source links are reused with snapshots or legacy body-only records', async () => {
  for (const snapshotPresent of [true, false]) {
    const input = result([]), board = createBoard('blank'), source = createNode('link');
    source.data.url = url; source.data.sourceStatus = '已保存完整原帖正文；由公开内容服务获取。';
    source.data.body = snapshotPresent ? '用户已编辑显示正文' : input.post.text;
    if (snapshotPresent) source.data.sourceOriginalText = input.post.text;
    source.data.sourceTitle = input.post.title; source.data.sourceAuthor = '作者名字 (@creator)';
    board.nodes = [source]; const before = structuredClone(source);
    assert.equal(getXImportDuplicate(board, url).sourceNodeId, source.id);
    const prepared = await prepareXImport(input, board, { position, sourceOnly: true });
    assert.equal(prepared.sourceNodeId, source.id); assert.deepEqual(prepared.nodes, []);
    assert.equal(prepared.duplicate, true); assert.deepEqual(prepared.board.nodes[0], before);
    assert.equal(getStoredXPostText(prepared.board.nodes[0]), input.post.text);
  }
});

test('missing edges or metadata make a source-only reuse a real update and fully captured edits remain intact', async () => {
  const input = result([videoA]), media = mediaStore(), first = await prepareXImport(input, createBoard('blank'), { position, ...media });
  const source = first.board.nodes.find(node => node.id === first.sourceNodeId)!, video = first.board.nodes.find(node => node.data.kind === 'video')!;
  source.data.body = '用户编辑了全文显示正文'; video.data.body = '用户观看笔记'; video.data.sourceOriginalText = '原先已经完整取得的正文';
  video.data.sourceTitle = '保留原来的来源标题'; video.data.sourceAuthor = '保留原来的作者';
  video.data.sourceStatus = '正文完整；用户保留的来源状态'; video.data.videoImport!.originalText = video.data.sourceOriginalText;
  const edited = { ...first.board, edges: [] }, before = structuredClone(edited);
  const connected = await prepareXImport(input, edited, { position, ...media });
  assert.deepEqual(connected.nodes, []); assert.equal(connected.duplicate, false); assert.equal(connected.board.edges.length, 1);
  assert.equal(connected.sourceNodeId, source.id); assert.equal(connected.board.nodes[0].data.body, source.data.body);
  assert.deepEqual(connected.board.nodes.find(node => node.id === video.id), video); assert.deepEqual(edited, before);
  const withoutMeta = structuredClone(connected.board); delete withoutMeta.nodes.find(node => node.id === video.id)!.data.sourceAuthor;
  const metadataOnly = await prepareXImport(input, withoutMeta, { position, ...media });
  assert.deepEqual(metadataOnly.nodes, []); assert.equal(metadataOnly.duplicate, false);
  assert.equal(metadataOnly.board.edges.length, 1); assert.equal(metadataOnly.board.nodes.find(node => node.id === video.id)!.data.sourceAuthor, '作者名字 (@creator)');
  assert.deepEqual(metadataOnly.videoNodeIds, []); assert.deepEqual(metadataOnly.mediaIds, []);
  const repeated = await prepareXImport(input, metadataOnly.board, { position, ...media }); assert.equal(repeated.duplicate, true);
  const sourceMissingStatus = structuredClone(metadataOnly.board); delete sourceMissingStatus.nodes.find(node => node.id === source.id)!.data.sourceStatus;
  const restoredSourceStatus = await prepareXImport(input, sourceMissingStatus, { position, ...media });
  assert.equal(restoredSourceStatus.sourceNodeId, source.id); assert.deepEqual(restoredSourceStatus.nodes, []);
  assert.equal(restoredSourceStatus.duplicate, false); assert.equal(restoredSourceStatus.board.nodes.find(node => node.id === source.id)!.data.body, source.data.body);
  assert.match(String(restoredSourceStatus.board.nodes.find(node => node.id === source.id)!.data.sourceStatus), /正文完整/);
});

test('repair association capacity and cancelled or failed new-image saves preserve all prior notes and assets', async () => {
  const board = createBoard('blank'), generic = createNode('link'), oldVideo = createNode('video'), media = mediaStore();
  generic.data.url = url; generic.data.body = '旧的阅读笔记'; generic.data.sourceOriginalText = '旧的个人笔记快照';
  oldVideo.data.sourceUrl = url; oldVideo.data.mediaId = 'existing-video'; oldVideo.data.body = '旧的观看笔记';
  board.nodes = [generic, oldVideo]; const before = structuredClone(board); let writes = 0;
  const countSave = async (blob: Blob, name?: string) => { writes++; return media.saveMedia(blob, name); };
  const full = { ...board, edges: Array.from({ length: STORAGE_LIMITS.edges - 1 }, (_, i) => ({ id: `repair-edge-${i}`, source: generic.id, target: oldVideo.id })) };
  await assert.rejects(prepareXImport(result([videoA]), full, { position, ...media, saveMedia: countSave }), /1500 条连线/);
  assert.equal(writes, 0);
  const failed = async (blob: Blob, name?: string) => { if (++writes === 2) throw new Error('修复导入存储失败'); return media.saveMedia(blob, name); };
  await assert.rejects(prepareXImport(result([videoA, imageA, imageB]), board, { position, ...media, saveMedia: failed }), /修复导入存储失败/);
  assert.deepEqual(board, before); assert.equal(media.records.size, 0); assert.deepEqual(media.removed, ['new-media-1']);
  const cancel = new AbortController();
  await assert.rejects(prepareXImport(result([videoA, imageA]), board, { position, ...media, signal: cancel.signal, saveMedia: async (blob, name) => { const record = await media.saveMedia(blob, name); cancel.abort(); return record; } }), { name: 'AbortError' });
  assert.deepEqual(board, before); assert.equal(media.records.size, 0); assert.deepEqual(media.removed, ['new-media-1', 'new-media-2']);
});

test('article media reference the actual publishing post and keep local ordinals plus CDN provenance', async () => {
  const media = mediaStore(), article = result(); article.post.contentKind = 'article';
  const prepared = await prepareXImport(article, createBoard('blank'), { position, ...media });
  const videos = prepared.nodes.filter(node => node.data.kind === 'video');
  const source = prepared.board.nodes.find(node => node.id === prepared.sourceNodeId)!;
  assert.equal(prepared.nodes.some(node => node.data.kind === 'image'), false);
  assert.deepEqual(source.data.pictures, [`field-picture:${prepared.mediaIds[0]}:1`, `field-picture:${prepared.mediaIds[1]}:2`]);
  assert.ok(videos.every(node => node.data.sourceUrl === url));
  assert.equal(videos[0].data.sourceStatus, `文章视频 1；视频源：${videoA.url}`);
  assert.equal(videos[1].data.sourceStatus, `文章视频 2；视频源：${gif.url}`);
  assert.deepEqual(videos.map(node => node.data.videoImport!.url), [`${url}/video/1`, `${url}/video/2`]);
  assert.deepEqual(getXImportDuplicate(prepared.board, url).imageNumbers, [1, 2]);
  assert.deepEqual(getXImportDuplicate(prepared.board, url).videoNumbers, [1, 2]);
  const repeated = await prepareXImport(article, prepared.board, { position, ...media });
  assert.deepEqual(repeated.nodes, []); assert.deepEqual(repeated.mediaIds, []);
  const retagged = structuredClone(prepared.board);
  for (const node of retagged.nodes) node.data.tags = ['我的资料'];
  const retaggedRepeat = await prepareXImport(article, retagged, { position, ...media });
  assert.deepEqual(retaggedRepeat.nodes, []); assert.deepEqual(retaggedRepeat.mediaIds, []);
  const invalid = structuredClone(prepared.board);
  invalid.nodes.find(node => node.data.kind === 'link')!.data.pictures = [`field-picture:${prepared.mediaIds[0]}:1`, '不是图片引用'];
  invalid.nodes.find(node => node.id === videos[0].id)!.data.tags = ['视频'];
  invalid.nodes.find(node => node.id === videos[1].id)!.data.sourceUrl = 'https://twitter.com/creator/status/2104200939095904322';
  assert.deepEqual(getXImportDuplicate(invalid, url).imageNumbers, [1]);
  assert.deepEqual(getXImportDuplicate(invalid, url).videoNumbers, [1]);
});

test('post-only import works without media storage and distinguishes previews, absent dates and third-party provenance', async () => {
  const input = result([]); input.post.provider = 'x-syndication'; input.post.completeness = 'partial'; delete input.post.publishedAt;
  const prepared = await prepareXImport(input, createBoard('blank'), { position, saveMedia: async () => { throw new Error('must not store'); } });
  assert.equal(prepared.nodes.length, 1); assert.equal(prepared.board.edges.length, 0);
  assert.match(String(prepared.nodes[0].data.sourceStatus), /第三方 X Syndication.*仅取得正文预览.*原帖发布时间未提供.*获取时间/);
  assert.match(prepared.warnings.join('\n'), /仅取得正文预览/);
  assert.equal(prepared.nodes[0].data.body, input.post.text);
});

test('media labels respect the title boundary without losing the complete source title or splitting emoji', async () => {
  const input = result([imageA, videoA]), media = mediaStore(); input.post.title = '字'.repeat(492) + '🙂'.repeat(4);
  const prepared = await prepareXImport(input, createBoard('blank'), { position, ...media });
  assert.equal(prepared.nodes[0].data.title, input.post.title);
  for (const node of prepared.nodes.slice(1)) {
    assert.ok(node.data.title.length <= 500); assert.equal(node.data.sourceTitle, input.post.title);
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(node.data.title), false);
  }
});

test('capacity, invalid positions and invalid source fields reject before the first media write', async () => {
  let writes = 0;
  const options = { position, saveMedia: async (blob: Blob) => { writes++; return { id: 'new', name: 'image', mime: blob.type, blob, createdAt: '2026-10-04T00:00:00.000Z' }; } };
  const full = createBoard('blank'); full.nodes = Array.from({ length: STORAGE_LIMITS.nodes }, () => createNode('note'));
  await assert.rejects(prepareXImport(result(), full, options), /500 张卡片/);
  const edgeFull = createBoard('blank'); edgeFull.nodes = [createNode('note'), createNode('note')];
  edgeFull.edges = Array.from({ length: STORAGE_LIMITS.edges }, (_, i) => ({ id: `edge-${i}`, source: edgeFull.nodes[0].id, target: edgeFull.nodes[1].id }));
  await assert.rejects(prepareXImport(result(), edgeFull, options), /1500 条连线/);
  await assert.rejects(prepareXImport(result(), createBoard('blank'), { ...options, position: { x: NaN, y: 0 } }), /位置无效/);
  await assert.rejects(prepareXImport(result(), createBoard('blank'), { ...options, position: { x: 20_000_000, y: 0 } }), /范围/);
  const invalid = result(); invalid.post.text = 'a'.repeat(300001);
  await assert.rejects(prepareXImport(invalid, createBoard('blank'), options), /正文/);
  await assert.rejects(prepareXImport(result(), createBoard('blank'), { ...options, originalText: 'a'.repeat(20001) }), /分享内容/);
  const mismatch = result(); mismatch.post.id = '123';
  await assert.rejects(prepareXImport(mismatch, createBoard('blank'), options), /ID.*不一致/);
  assert.equal(writes, 0);
});

test('complete-version capacity includes its version edge and failed saves preserve preview state', async () => {
  const media = mediaStore(), preview = result([imageA, imageB]); preview.post.completeness = 'partial'; preview.post.text = '预览正文'; preview.images[1].data = undefined;
  const first = await prepareXImport(preview, createBoard('blank'), { position, ...media });
  const before = structuredClone(first.board), complete = result([imageA, imageB]); let writes = 0;
  const save = async (blob: Blob, name?: string) => { writes++; return media.saveMedia(blob, name); };
  const nodeFull = { ...first.board, nodes: [...first.board.nodes, ...Array.from({ length: STORAGE_LIMITS.nodes - first.board.nodes.length }, () => createNode('note'))] };
  await assert.rejects(prepareXImport(complete, nodeFull, { position, ...media, saveMedia: save }), /500 张卡片/);
  const edgeFull = { ...first.board, edges: Array.from({ length: STORAGE_LIMITS.edges }, (_, i) => ({ id: `edge-version-${i}`, source: first.sourceNodeId, target: first.nodes[0].id })) };
  await assert.rejects(prepareXImport(complete, edgeFull, { position, ...media, saveMedia: save }), /1500 条连线/);
  assert.equal(writes, 0);
  await assert.rejects(prepareXImport(complete, first.board, { position, ...media, saveMedia: async () => { throw new Error('新版本图片保存失败'); } }), /新版本图片保存失败/);
  assert.deepEqual(first.board, before); assert.equal(media.records.size, 1);
});

test('invalid image bytes, unsafe formats and empty names fail before writing any media', async () => {
  let writes = 0;
  const store = async () => { writes++; throw new Error('unexpected'); };
  for (const change of [
    (input: XImportResult) => { input.images[0].mime = 'image/svg+xml'; },
    (input: XImportResult) => { input.images[0].name = ' '; },
    (input: XImportResult) => { input.images[0].data = new Uint8Array(STORAGE_LIMITS.mediaBytes + 1); },
  ]) { const input = result(); change(input); await assert.rejects(prepareXImport(input, createBoard('blank'), { position, saveMedia: store })); }
  assert.equal(writes, 0);
});

test('a failed second media save removes only this attempt assets and leaves the original board untouched', async () => {
  const media = mediaStore(), board = createBoard('blank'), old = createNode('image'); old.data.mediaId = 'existing'; board.nodes = [old];
  const before = structuredClone(board); let writes = 0;
  await assert.rejects(prepareXImport(result([imageA, imageB]), board, { position, ...media, saveMedia: async (blob, name) => { if (++writes === 2) throw new Error('存储空间不足'); return media.saveMedia(blob, name); } }), /存储空间不足/);
  assert.deepEqual(media.removed, ['new-media-1']); assert.equal(media.records.size, 0);
  assert.deepEqual(board, before);
});

test('aborts before or after an image write roll back without leaving cards or media', async () => {
  const aborted = new AbortController(); aborted.abort(); const media = mediaStore(), board = createBoard('blank');
  await assert.rejects(prepareXImport(result(), board, { position, ...media, signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(media.records.size, 0); assert.deepEqual(media.removed, []);
  const during = new AbortController(), before = structuredClone(board);
  await assert.rejects(prepareXImport(result([imageA, imageB]), board, { position, ...media, signal: during.signal, saveMedia: async (blob, name) => { const record = await media.saveMedia(blob, name); during.abort(); return record; } }), { name: 'AbortError' });
  assert.deepEqual(media.removed, ['new-media-1']); assert.equal(media.records.size, 0); assert.deepEqual(board, before);
});

test('failed final board validation rolls back new assets and never deletes colliding existing IDs', async () => {
  const media = mediaStore(), board = createBoard('blank');
  await assert.rejects(prepareXImport(result([imageA]), board, { position, ...media, saveMedia: async (blob, name) => { const record = await media.saveMedia(blob, name); media.records.delete(record.id); record.id = 'invalid\0id'; media.records.set(record.id, record); return record; } }), /笔记图片|媒体 ID/);
  assert.deepEqual(media.removed, ['invalid\0id']); assert.equal(media.records.size, 0);
  const old = createNode('image'); old.data.mediaId = 'existing'; board.nodes = [old];
  await assert.rejects(prepareXImport(result([imageA]), board, { position, ...media, saveMedia: async (blob, name) => ({ id: 'existing', name: name!, mime: blob.type, blob, createdAt: '2026-10-04T00:00:00.000Z' }) }), /重复媒体 ID/);
  const kept = createNode('link'); kept.data.url = url; kept.data.pictures = ['field-picture:kept-picture:2']; board.nodes = [kept];
  await assert.rejects(prepareXImport(result([imageA]), board, { position, ...media, saveMedia: async (blob, name) => ({ id: 'kept-picture', name: name!, mime: blob.type, blob, createdAt: '2026-10-04T00:00:00.000Z' }) }), /重复媒体 ID/);
  assert.deepEqual(media.removed, ['invalid\0id']);
});

test('cleanup failure is reported explicitly rather than pretending rollback succeeded', async () => {
  const media = mediaStore(); let count = 0;
  await assert.rejects(prepareXImport(result([imageA, imageB]), createBoard('blank'), {
    position, saveMedia: async (blob, name) => { if (++count === 2) throw new Error('保存失败'); return media.saveMedia(blob, name); },
    removeMedia: async () => { throw new Error('数据库暂不可用'); },
  }), /保存失败.*临时图片清理失败.*数据库暂不可用.*原有媒体未删除/);
});

/** Small transaction double for the real portable encoder/decoder, no canvas state injection. */
function installStorage() {
  const values = new Map<string, unknown>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const database = {
    onversionchange: undefined as (() => void) | undefined, close() {},
    transaction(name: string) {
      const transaction = { oncomplete: undefined as (() => void) | undefined, objectStore() { return {
        put(value: { id?: string }, key?: string) { values.set(`${name}:${key ?? value.id}`, structuredClone(value)); },
        delete(key: string) { values.delete(`${name}:${key}`); },
        get(key: string) { const request = { result: structuredClone(values.get(`${name}:${key}`)), onsuccess: undefined as (() => void) | undefined }; queueMicrotask(() => request.onsuccess?.()); return request; },
      }; } };
      queueMicrotask(() => transaction.oncomplete?.()); return transaction;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { const request = { result: database, onsuccess: undefined as (() => void) | undefined }; queueMicrotask(() => request.onsuccess?.()); return request; } } });
  return { values, restore() { database.onversionchange?.(); if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else Reflect.deleteProperty(globalThis, 'indexedDB'); } };
}

test('the default IndexedDB removal path cleans a real stored media record after cancellation', async () => {
  const db = installStorage(), cancel = new AbortController(), ids: string[] = [];
  try {
    await assert.rejects(prepareXImport(result([imageA]), createBoard('blank'), {
      position, signal: cancel.signal,
      saveMedia: async (blob, name) => { const record = await saveMedia(blob, name); ids.push(record.id); cancel.abort(); return record; },
    }), { name: 'AbortError' });
    assert.equal(ids.length, 1); assert.equal(await getMedia(ids[0]), undefined);
  } finally { db.restore(); }
});

test('long article excerpts keep exact anchors and the real portable package restores images, provenance, tasks and citations', async () => {
  const db = installStorage();
  try {
    const input = result([imageA, videoA]); input.post.contentKind = 'article';
    input.post.text = `${'完整段落\r\n'.repeat(18000)}末段🙂 <原样>`;
    const writing = createBoard('blank'); writing.category = 'writing';
    const prepared = await prepareXImport(input, writing, { position });
    const body = input.post.text.replace(/\r\n?/g, '\n'), from = body.indexOf('末段');
    const quotes = createTextQuoteBatch(prepared.board, prepared.sourceNodeId, { from, to: body.length });
    const quote = quotes.quotes[0], draft = createNode('draft'); draft.data.body = formatDraftQuote(quote);
    const board = { ...quotes.board, nodes: [...quotes.board.nodes, draft] };
    const packed = await exportBoard(board), packageData = JSON.parse(await packed.text());
    assert.equal(packageData.media.length, 1); assert.equal(packageData.board.nodes[0].data.body, input.post.text);
    const restored = await importBoard(new File([packed], 'X长文.field.json'));
    const restoredSource = restored.nodes.find(node => node.data.kind === 'link')!;
    const restoredVideo = restored.nodes.find(node => node.data.kind === 'video')!;
    const restoredQuote = restored.nodes.find(node => node.data.kind === 'quote')!;
    const restoredPicture = restoredSource.data.pictures?.[0]?.match(/^field-picture:([^:]+):1$/)?.[1];
    assert.notEqual(restoredSource.id, prepared.sourceNodeId); assert.notEqual(restoredPicture, prepared.mediaIds[0]);
    assert.equal(restoredSource.data.body, input.post.text); assert.equal(restoredSource.data.sourceOriginalText, input.post.text);
    assert.equal(restoredSource.data.sourceUrl, url); assert.equal(restoredSource.data.sourceAuthor, '作者名字 (@creator)');
    assert.match(String(restoredSource.data.sourceStatus), /正文完整/);
    assert.deepEqual(new Uint8Array(await (await getMedia(restoredPicture!))!.blob.arrayBuffer()), png);
    assert.equal(restoredQuote.data.citation!.nodeId, restoredSource.id);
    assert.equal(restoredQuote.data.citation!.text, '末段🙂 <原样>'); assert.equal(restoredQuote.data.citation!.textAnchor!.from, from);
    assert.equal(restoredVideo.data.videoImport!.status, 'interrupted'); assert.equal(restoredVideo.data.sourceUrl, url);
    assert.equal(restoredVideo.data.sourceStatus, `文章视频 1；视频源：${videoA.url}`);
    assert.notEqual(restoredVideo.data.videoImport!.attemptId, prepared.nodes.find(node => node.data.kind === 'video')!.data.videoImport!.attemptId);
    assert.equal(parseDraftReferences(restored.nodes.find(node => node.data.kind === 'draft')!.data.body)[0].sourceNodeId, restoredSource.id);
    assert.equal(restored.edges.filter(edge => edge.source === restoredSource.id).length, 2);
    assert.doesNotThrow(() => validateBoard(restored));
  } finally { db.restore(); }
});

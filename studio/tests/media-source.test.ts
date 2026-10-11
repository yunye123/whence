import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode, exportMarkdown } from '../src/board-utils';
import { createBoard, mergeFolderMedia, validateBoard, validateWorkspace } from '../src/storage';
import { getSourceUrl, mergePastedVideoMedia, usesSeparateSourceUrl } from '../src/media-source';
import { BoardStorage, type StoredMedia } from '../native/board-storage';
import { prepareTranscriptReplacement } from '../src/App';
import { transcriptRevision } from '../src/transcript-tools';
import type { Board, CardData, TranscriptLine, Workspace } from '../src/model';

const originalUrl = 'https://example.com/original-video';
const editedUrl = 'https://example.com/latest-reference';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
const currentTranscript: TranscriptLine[] = [{ id: 'user-line', start: 0, end: 2, text: '用户校对后的文字', originalText: '识别原句' }];
function localVideo(): CardData {
  return { ...createNode('video').data, title: '我编辑的标题', body: '我的后续笔记', mediaId: 'pasted-byte-cache', sourceOriginalText: '用户保留的来源原文', tags: ['我的标签'], tone: 'mint', transcript: structuredClone(currentTranscript), transcriptRevision: 'manual-revision' };
}
function material(): Partial<CardData> {
  return { url: 'media://import-library/assets/video.mp4', poster: png, duration: 12, nativeAssetId: 'imported-asset', nativeProjectId: 'import-library', nativeDirectory: 'D:\\test-library', nativeHasAudio: true,
    title: '自动素材标题', body: '自动素材正文', mediaId: 'replacement-cache', sourceUrl: 'https://example.com/recognizer-source', sourceOriginalText: '自动来源原文', tags: ['自动标签'], tone: 'blue',
    transcript: [{ id: 'auto-line', start: 0, end: 1, text: '自动文字' }], transcriptRevision: 'auto-revision',
  };
}

test('cached video/image, native assets, media protocols and import tasks separate their public source from playback', () => {
  const cases: CardData[] = [
    localVideo(), { ...createNode('image').data, mediaId: 'image-cache' },
    { ...createNode('video').data, nativeAssetId: 'native-asset' },
    { ...createNode('video').data, url: 'media://library/a.mp4' },
    { ...createNode('image').data, url: 'field-media://folder/image-copy' },
    { ...createNode('video').data, videoImport: { attemptId: 'attempt', url: originalUrl, originalText: '分享原文', status: 'transcribing', message: '正在转写', mediaReady: true, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' } },
  ];
  for (const data of cases) assert.equal(usesSeparateSourceUrl(data), true);
  assert.equal(usesSeparateSourceUrl({ ...createNode('link').data, url: originalUrl }), false);
  assert.equal(usesSeparateSourceUrl({ ...createNode('video').data, url: originalUrl }), false);
});

test('public source fallback respects explicit edits and excludes internal playback addresses', () => {
  const current = localVideo(); current.url = 'media://import-library/assets/video.mp4';
  assert.equal(getSourceUrl(current), '');
  current.sourceUrl = editedUrl; assert.equal(getSourceUrl(current), editedUrl);
  current.sourceUrl = ''; assert.equal(getSourceUrl(current), '');
  delete current.sourceUrl; current.url = 'field-media://folder/video-copy'; assert.equal(getSourceUrl(current), '');
  current.url = originalUrl; assert.equal(getSourceUrl(current), originalUrl, 'legacy public URLs remain discoverable until migrated');
});

test('an import task retains the original share URL only when the user has not edited or explicitly cleared it', () => {
  const data: CardData = { ...localVideo(), url: 'media://library/video.mp4', videoImport: { attemptId: 'attempt', url: originalUrl, originalText: '完整分享原文', status: 'transcribing', message: '正在转写', mediaReady: true, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' } };
  assert.equal(getSourceUrl(data), originalUrl);
  assert.equal(getSourceUrl({ ...data, sourceUrl: editedUrl }), editedUrl);
  assert.equal(getSourceUrl({ ...data, sourceUrl: '' }), '');
});

test('merging a pasted video migrates a legacy public URL while assigning independent playback media', () => {
  const current = { ...localVideo(), url: originalUrl }; const before = structuredClone(current), patch = material(), patchBefore = structuredClone(patch);
  const merged = mergePastedVideoMedia(current, patch);
  assert.equal(merged.sourceUrl, originalUrl); assert.equal(merged.url, patch.url); assert.equal(getSourceUrl(merged), originalUrl);
  assert.equal(merged.nativeAssetId, 'imported-asset'); assert.equal(merged.nativeProjectId, 'import-library'); assert.equal(merged.poster, png); assert.equal(merged.duration, 12);
  assert.equal(merged.mediaId, current.mediaId, 'the original clipboard byte cache remains its playback source until resolved separately');
  assert.deepEqual(current, before); assert.deepEqual(patch, patchBefore);
});

test('a source edited while transcription was pending survives the incoming media result and its stale source metadata', () => {
  const current = { ...localVideo(), sourceUrl: editedUrl, url: originalUrl };
  const merged = mergePastedVideoMedia(current, material());
  assert.equal(merged.sourceUrl, editedUrl); assert.equal(getSourceUrl(merged), editedUrl); assert.equal(merged.sourceOriginalText, current.sourceOriginalText);
  assert.equal(merged.url, 'media://import-library/assets/video.mp4');
});

test('an explicitly cleared source never revives from a legacy URL, a task URL or a late media patch', () => {
  const current = { ...localVideo(), sourceUrl: '', url: originalUrl, videoImport: { attemptId: 'attempt', url: originalUrl, originalText: '完整分享原文', status: 'completed' as const, message: '已完成', mediaReady: true, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' } };
  const merged = mergePastedVideoMedia(current, material());
  assert.equal(merged.sourceUrl, ''); assert.equal(getSourceUrl(merged), '');
  assert.deepEqual(merged.videoImport, current.videoImport);
});

test('media merging preserves the latest title, body, tags, tone, clipboard cache and manually corrected transcript', () => {
  const current = { ...localVideo(), sourceUrl: editedUrl }, merged = mergePastedVideoMedia(current, material());
  for (const key of ['title', 'body', 'mediaId', 'sourceUrl', 'sourceOriginalText', 'tags', 'tone', 'transcript', 'transcriptRevision'] as const) assert.deepEqual(merged[key], current[key], key);
  assert.equal(merged.url, 'media://import-library/assets/video.mp4'); assert.equal(merged.poster, png);
});

test('a local video with no public source cannot invent one from native playback addresses', () => {
  const current = localVideo(); const merged = mergePastedVideoMedia(current, { ...material(), sourceUrl: undefined });
  assert.equal(getSourceUrl(merged), ''); assert.ok(!merged.sourceUrl || !/^(?:media|field-media):/.test(merged.sourceUrl));
  const folder = mergePastedVideoMedia({ ...current, url: 'field-media://folder/video-copy' }, { ...material(), url: 'field-media://folder/new-copy' });
  assert.equal(getSourceUrl(folder), '');
});

test('a delayed pasted-video result cannot downgrade an independent folder URL or replace an already saved poster', () => {
  const current = { ...localVideo(), sourceUrl: editedUrl, url: 'field-media://folder/video-copy', poster: png, nativeProjectId: 'import-library', nativeAssetId: 'imported-asset' };
  const merged = mergePastedVideoMedia(current, { ...material(), poster: 'media://import-library/assets/recognizer-poster.png' });
  assert.equal(merged.url, current.url); assert.equal(merged.poster, current.poster); assert.equal(merged.sourceUrl, editedUrl);
});

test('an explicitly empty sourceUrl survives board and workspace validation and JSON persistence without becoming missing', () => {
  const board = createBoard('blank'), video = createNode('video'); video.data = { ...localVideo(), url: originalUrl, sourceUrl: '' }; board.nodes = [video];
  const validated = validateBoard(JSON.parse(JSON.stringify(board)));
  assert.equal(validated.nodes[0].data.sourceUrl, ''); assert.ok(Object.hasOwn(validated.nodes[0].data, 'sourceUrl')); assert.equal(getSourceUrl(validated.nodes[0].data), '');
  const deleted = { ...board, id: 'deleted-with-cleared-source' };
  const workspace: Workspace = { schema: 1, activeBoardId: board.id, boards: [board], trash: [{ board: deleted, deletedAt: board.createdAt }] };
  const restored = validateWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.equal(restored.boards[0].nodes[0].data.sourceUrl, ''); assert.equal(restored.trash?.[0].board.nodes[0].data.sourceUrl, '');
  assert.equal(getSourceUrl(restored.boards[0].nodes[0].data), '');
  const absent = structuredClone(board); delete absent.nodes[0].data.sourceUrl;
  assert.equal(validateBoard(absent).nodes[0].data.sourceUrl, undefined); assert.equal(getSourceUrl(validateBoard(absent).nodes[0].data), originalUrl);
});

test('Markdown export respects an explicitly cleared source instead of reviving the old public playback URL', () => {
  const board = createBoard('blank'), video = createNode('video'); video.data = { ...localVideo(), url: originalUrl, sourceUrl: '' }; board.nodes = [video];
  const markdown = exportMarkdown(board); assert.ok(!markdown.includes(originalUrl)); assert.ok(!markdown.includes('来源：<'));
  delete video.data.sourceUrl;
  assert.ok(exportMarkdown(board).includes(`来源：<${originalUrl}>`), 'an unset source continues to export the discoverable legacy reference');
});

function replacementFixture() {
  const board = createBoard('blank'), video = createNode('video'); video.data = { ...localVideo(), sourceUrl: editedUrl }; board.nodes = [video];
  const target = { boardId: board.id, nodeId: video.id, asset: video.data.mediaId!, revision: transcriptRevision(video.data) };
  const lines: TranscriptLine[] = [{ id: 'replacement-line', start: 1, end: 3, text: '用户主动生成的新逐字稿' }];
  return { board, video, target, lines };
}

test('manual transcript replacement accepts an optional media patch while preserving current edits and replacing only the requested transcript', () => {
  const { board, video, target, lines } = replacementFixture(); const before = structuredClone(board), patch = material();
  const next = prepareTranscriptReplacement(board, target, lines, patch);
  assert.deepEqual(next.nodes[0].data.transcript, lines); assert.notEqual(next.nodes[0].data.transcriptRevision, video.data.transcriptRevision);
  assert.equal(next.nodes[0].data.url, patch.url); assert.equal(next.nodes[0].data.nativeAssetId, patch.nativeAssetId);
  for (const key of ['title', 'body', 'mediaId', 'sourceUrl', 'sourceOriginalText', 'tags', 'tone'] as const) assert.deepEqual(next.nodes[0].data[key], video.data[key], key);
  assert.deepEqual(board, before); assert.doesNotThrow(() => validateBoard(next));
});

test('the existing three-argument manual transcript replacement remains valid and never changes playback or source', () => {
  const { board, video, target, lines } = replacementFixture(); video.data.url = originalUrl;
  const next = prepareTranscriptReplacement(board, target, lines);
  assert.deepEqual(next.nodes[0].data.transcript, lines); assert.equal(next.nodes[0].data.url, originalUrl); assert.equal(next.nodes[0].data.sourceUrl, editedUrl);
});

test('a late transcript/media response rejects wrong board, replaced asset or edited revision without mutating any current object', () => {
  const { board, target, lines } = replacementFixture();
  const wrongBoard: Board = { ...structuredClone(board), id: 'another-board' }, changedAsset = structuredClone(board), editedTranscript = structuredClone(board), removed = structuredClone(board);
  changedAsset.nodes[0].data.mediaId = 'new-pasted-video'; editedTranscript.nodes[0].data.transcriptRevision = 'new-user-revision'; removed.nodes = [];
  for (const [current, message] of [[wrongBoard, /画布或视频/], [changedAsset, /素材已更换/], [editedTranscript, /期间修改/], [removed, /画布或视频/]] as const) {
    const before = structuredClone(current); assert.throws(() => prepareTranscriptReplacement(current, target, lines, material()), message); assert.deepEqual(current, before);
  }
});

function directoryMergeFixture() {
  const source = createBoard('blank'), video = createNode('video'); video.data = { ...localVideo(), url: originalUrl };
  source.storage = { id: 'source-folder', directory: 'D:\\source-folder' }; source.nodes = [video];
  const saved = structuredClone(source); saved.nodes[0].data.url = 'field-media://source-folder/pasted-byte-cache'; saved.nodes[0].data.sourceUrl = originalUrl;
  const workspace: Workspace = { schema: 1, activeBoardId: source.id, boards: [source] };
  return { source, saved, workspace };
}

test('directory normalization migrates the legacy public URL of a cached video before replacing its playback URL', () => {
  const { source, saved, workspace } = directoryMergeFixture(), before = structuredClone(workspace);
  const merged = mergeFolderMedia(workspace, source, saved);
  assert.equal(merged.boards[0].nodes[0].data.url, saved.nodes[0].data.url);
  assert.equal(merged.boards[0].nodes[0].data.sourceUrl, originalUrl); assert.equal(getSourceUrl(merged.boards[0].nodes[0].data), originalUrl);
  assert.deepEqual(workspace, before);
});

test('a source edited or explicitly cleared during a directory write survives the stale normalized source', () => {
  const { source, saved, workspace } = directoryMergeFixture();
  for (const sourceUrl of [editedUrl, '']) {
    const current = structuredClone(workspace); current.boards[0].nodes[0].data.sourceUrl = sourceUrl;
    const merged = mergeFolderMedia(current, source, saved);
    assert.equal(merged.boards[0].nodes[0].data.sourceUrl, sourceUrl); assert.equal(getSourceUrl(merged.boards[0].nodes[0].data), sourceUrl);
    assert.equal(merged.boards[0].nodes[0].data.url, saved.nodes[0].data.url);
    assert.equal(current.boards[0].nodes[0].data.url, originalUrl);
  }
});

test('directory source migration rejects stale writes when the user replaced media, playback URL or storage identity', () => {
  const { source, saved, workspace } = directoryMergeFixture();
  const changes: ((value: Workspace) => void)[] = [
    value => { value.boards[0].nodes[0].data.mediaId = 'new-clipboard-video'; },
    value => { value.boards[0].nodes[0].data.url = 'https://example.com/new-playback'; },
    value => { value.boards[0].nodes[0].data.nativeAssetId = 'new-native-video'; },
    value => { value.boards[0].nodes[0].data.nativeProjectId = 'new-native-library'; },
    value => { value.boards[0].storage = { id: 'different-folder', directory: 'D:\\different-folder' }; },
  ];
  for (const change of changes) {
    const current = structuredClone(workspace); change(current); const before = structuredClone(current);
    assert.equal(mergeFolderMedia(current, source, saved), current); assert.deepEqual(current, before);
    assert.equal(current.boards[0].nodes[0].data.sourceUrl, undefined);
  }
});

test('real folder save, manifest and reopen preserve the readable legacy HTTP source and an explicitly empty source', async () => {
  const base = path.resolve('output/quality-20261003'); await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'media-source-test-'));
  try {
    const parent = path.join(directory, 'chosen-parent'); await fs.mkdir(parent);
    const storage = new BoardStorage(path.join(directory, 'locations.json')); await storage.initialize();
    const initial = createBoard('blank'), choice = await storage.choose(parent), location = await storage.create(choice.id, initial);
    const first = createNode('video'), cleared = createNode('video');
    first.data = { ...localVideo(), mediaId: 'legacy-cache', url: originalUrl };
    cleared.data = { ...localVideo(), mediaId: 'cleared-cache', url: originalUrl, sourceUrl: '' };
    const board: Board = { ...initial, storage: location, nodes: [first, cleared] };
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const media: StoredMedia[] = ['legacy-cache', 'cleared-cache'].map(id => ({ id, name: `${id}.mp4`, mime: 'video/mp4', createdAt: board.createdAt, data: bytes }));
    const before = structuredClone(board), saved = await storage.save(location.id, board, media);
    assert.equal(saved.nodes[0].data.url, originalUrl); assert.equal(saved.nodes[1].data.url, originalUrl); assert.equal(saved.nodes[1].data.sourceUrl, '');
    assert.equal(getSourceUrl(saved.nodes[0].data), originalUrl); assert.equal(getSourceUrl(saved.nodes[1].data), '');
    const manifest = JSON.parse(await fs.readFile(path.join(location.directory, 'canvas.field.json'), 'utf8'));
    assert.equal(manifest.board.nodes[0].data.url, originalUrl); assert.equal(manifest.board.nodes[1].data.url, originalUrl); assert.equal(manifest.board.nodes[1].data.sourceUrl, '');
    assert.equal(getSourceUrl(manifest.board.nodes[0].data), originalUrl); assert.equal(getSourceUrl(manifest.board.nodes[1].data), '');
    const reopened = await storage.open(location.directory);
    assert.ok(reopened.kind === 'opened');
    assert.equal(reopened.board.nodes[0].data.url, originalUrl); assert.equal(reopened.board.nodes[1].data.url, originalUrl); assert.equal(reopened.board.nodes[1].data.sourceUrl, '');
    assert.equal(getSourceUrl(reopened.board.nodes[0].data), originalUrl); assert.equal(getSourceUrl(reopened.board.nodes[1].data), '');
    assert.deepEqual(board, before, 'the caller snapshot is never changed by native normalization');
    assert.deepEqual(await storage.readMedia(reopened.board.storage!.id, 'legacy-cache'), bytes);
  } finally {
    const resolved = path.resolve(directory); assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('media-source-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('a shipped example film is playable media, never shown as the original source link', () => {
  const data = { kind: 'video', title: '凌晨四点的早餐摊', body: '', url: '/assets/samples/breakfast-stall.mp4', demo: true } as const;
  assert.equal(usesSeparateSourceUrl(data), true);
  assert.equal(getSourceUrl(data), '');
  assert.equal(getSourceUrl({ ...data, sourceUrl: 'https://example.com/film' }), 'https://example.com/film');
});

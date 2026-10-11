import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Inspector, { insertDraftText } from '../src/Inspector';
import { formatDraftQuote, parseDraftReferences } from '../src/draft-references';
import { BoardContext } from '../src/board-context';
import type { BoardActions } from '../src/board-context';
import type { BoardNode } from '../src/model';
import { assertNone, attr, descendants, fieldValue, getAllBy, getBy, getByLabel, getByRole, getByTestId, getByText, isButton, isDisabled, isReadOnly, mentions, queryAll, textContent } from './helpers/markup';

// Render assertions check behaviour contracts: accessible names, roles, test ids, disabled/readOnly/pressed/
// expanded/busy state, media sources, absence of autoplay and of internal `field:` URIs, and the meaning of
// the visible copy. They no longer depend on complete class strings, JSX attribute order or presentational
// wrappers (EN-M2, map-tests §3.4). Dropped or loosened style-only assertions:
// - `inspector--writing-expanded` (class, S): expansion is asserted through `收起写作` aria-pressed="true".
// - `inspector-version-list` (class, S): the restored version panel is asserted through aria-expanded on
//   the "N 个历史版本" toggle.
// - `is-corrected` (class, S): the corrected line must still be announced (title/aria/text mention 已校对).
// - `inspector-x-post-text` / `inspector-x-post-actions` (classes used as slice markers): the prose is found
//   as the innermost element holding the post text inside the 推文正文 region.
// - Element types are kept only where they carry semantics: <video>, <blockquote> for captured quotations,
//   <mark>/role=mark for the located quotation, img role with alt text.
// Negative checks first locate the element they talk about, or pair the absence with a positive control.
// C11 (DESIGN_SYSTEM §10.2): the draft body is a CodeMirror 6 editor, not a <textarea>. Server rendering shows its
// read-only stand-in, a role=textbox named 文稿正文 with the readable text. Draft assertions therefore check the
// role, the name, aria-readonly and what a reader sees (no field:// link, no UUID, superscript numbers), never the
// element type or a value attribute. Editor offsets stay UTF-16 positions in LF text (tests/draft-editor.test.ts).

const noop = () => {};
const source: BoardNode = {
  id: 'video-source', type: 'card', position: { x: 0, y: 0 },
  data: { kind: 'video', title: '校对样本', body: '', mediaId: 'local-media', sourceUrl: 'https://example.com/reference', nativeAssetId: 'asset-1',
    transcript: [{ id: 'line-one', start: 0, end: 2, text: '第一句原文。' }, { id: 'line-two', start: 2, end: 5, text: '第二句校对后。', originalText: '第二句原文。' }] },
};

function render(node: BoardNode, others: BoardNode[] = [], actionPending = false, overrides: Partial<BoardActions> = {}) {
  const actions: BoardActions = {
    updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, addQuote: () => true, addTextQuote: () => true, focusSource: noop,
    openDraftSource: () => true, draftReturn: null, returnToDraft: () => true, draftRestore: null, completeDraftRestore: noop,
    getMediaUrl: id => id ? 'blob:isolated-test-video' : undefined, activeVideo: node.id, inspectedId: node.id, playVideo: noop,
    videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 2, paused: true }), bindVideoPlayer: noop, captureVideoPlayback: noop, restoreVideoPlayback: noop,
    setPendingTranscriptEdit: noop,
    cancelVideoImport: noop, retryVideoImport: noop, videoImportAvailable: true, videoImportActionPending: () => actionPending, nodes: [node, ...others], ...overrides,
  };
  return renderToStaticMarkup(createElement(BoardContext.Provider, { value: actions }, createElement(Inspector, {
    node, onClose: noop, onImportSubtitles: noop, onNativeTranscribe: async () => {}, onNotify: noop,
  })));
}

test('paused video surface has no automatic playback and keeps accessible correction controls', () => {
  const html = render(source);
  assert.equal(attr(getBy(html, { tag: 'video' }), 'src'), 'blob:isolated-test-video');
  assertNone(html, { attrs: { autoplay: true } });
  assert.ok(isButton(getByLabel(html, '校对 00:00 的字幕')));
  const corrected = getByTestId(html, 'edit-transcript-line-two');
  assert.ok(mentions(corrected, '已校对'), 'a corrected line announces that it was corrected');
  assert.equal(mentions(getByTestId(html, 'edit-transcript-line-one'), '已校对'), false, 'an untouched line is not announced as corrected');
  getBy(html, { role: 'link', attrs: { href: 'https://example.com/reference' } });
});

test('whole and selected transcript output are explicit separate controls', () => {
  const html = render(source);
  for (const label of ['复制所选', '导出全文 TXT', '导出全文 SRT', '导出所选 TXT', '导出所选 SRT']) assert.ok(isButton(getByLabel(html, label)), label);
  assert.equal(isDisabled(getByRole(html, 'button', '复制全文')), false);
  assert.ok(mentions(html, '全文包含全部 2 句'));
  assert.ok(mentions(html, '搜索不会缩小全文范围'));
  assert.ok(isDisabled(getByLabel(html, '复制所选')), 'nothing is selected yet');
});

test('automatic transcription leaves media playable while correction and replacement are disabled', () => {
  const node: BoardNode = { ...source, data: { ...source.data, videoImport: { attemptId: 'attempt-1', url: 'https://example.com/reference', originalText: '', status: 'transcribing', progress: 36, message: '正在转写', mediaReady: true, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' } } };
  const html = render(node);
  assert.equal(attr(getBy(html, { tag: 'video' }), 'src'), 'blob:isolated-test-video');
  const correction = /^校对 \d\d:\d\d 的字幕$/;
  for (const button of getAllBy(html, { label: correction })) assert.ok(isDisabled(button), `${attr(button, 'aria-label')} is disabled while transcribing`);
  assert.ok(isDisabled(getByRole(html, 'button', '更新字幕')));
  const idle = render(source);
  assert.ok(getAllBy(idle, { label: correction }).every(button => !isDisabled(button)), 'positive control: correction is available when idle');
  assert.equal(isDisabled(getByRole(idle, 'button', '更新字幕')), false, 'positive control: replacement is available when idle');
});

test('citation revision warning preserves the captured quotation and handles legacy initial versions', () => {
  const quote: BoardNode = { id: 'quote-1', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '原文摘录', body: '我的理解', citation: { nodeId: source.id, title: source.data.title, text: '当时的原文', start: 0, end: 2 } } };
  assert.doesNotMatch(render(quote, [source]), /来源逐字稿后来有更新/);
  const html = render(quote, [{ ...source, data: { ...source.data, transcriptRevision: 'new-revision' } }]);
  assert.match(html, /来源逐字稿后来有更新/);
  assert.equal(textContent(getBy(html, { tag: 'blockquote', text: '当时的原文' })).trim(), '当时的原文');
  assert.equal(fieldValue(getByLabel(html, '我的理解', { role: 'textbox' })), '我的理解');
});

const draft: BoardNode = { id: 'draft-one', type: 'card', position: { x: 100, y: 100 }, data: { kind: 'draft', title: '我的文稿', body: '' } };

test('draft sources show an explicit empty state even when the canvas contains an unused quotation', () => {
  const unused: BoardNode = { id: 'unused-quote', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '未引用的摘录', body: '只有素材库里有的句子' } };
  const html = render(draft, [source, unused]);
  const region = getByLabel(html, '本稿已引用来源');
  assert.match(textContent(region), /这篇文稿还没有引用来源。/);
  assertNone(html, { testId: /^draft-used-reference-/ }, 'positive control: the occurrence-order test below');
  assert.equal(mentions(html, '只有素材库里有的句子'), false);
  assert.ok(mentions(html, '导出正文'));
});

test('draft source controls follow body occurrence order including repeats and have no external URI anchors', () => {
  const body = '[来源：第一处](field://node/video-source?t=2)\n\n[来源：另一份](field://node/other-source?t=3)\n\n[来源：重复来源](field://node/video-source?t=4)\n\n`[代码示例](field://node/not-a-source)`';
  const other: BoardNode = { ...source, id: 'other-source', data: { ...source.data, title: '另一份来源' } };
  const html = render({ ...draft, data: { ...draft.data, body } }, [source, other]);
  const region = getByLabel(html, '本稿已引用来源');
  assert.equal(queryAll(region, { testId: /^draft-used-reference-/ }).length, 3);
  const listed = textContent(region);
  assert.ok(listed.indexOf('第一处') >= 0 && listed.indexOf('第一处') < listed.indexOf('另一份'));
  assert.ok(listed.indexOf('另一份') < listed.indexOf('重复来源'));
  for (let index = 1; index <= 3; index++) {
    assert.ok(isButton(getByLabel(region, `查看第${index}处引用来源`)));
    assert.ok(isButton(getByLabel(region, `定位第${index}处引用到正文`)));
  }
  const internal = descendants(html).filter(element => Object.values(element.attrs).some(value => /^\s*field:/i.test(value)));
  assert.deepEqual(internal.map(element => element.raw), [], 'no attribute (href, src, …) exposes the internal field: protocol');
  assert.equal(mentions(region, 'not-a-source'), false);
});

test('a removed source leaves the draft occurrence visible and locatable', () => {
  const html = render({ ...draft, data: { ...draft.data, body: '[来源：已移除来源](field://node/deleted-source?t=6)' } });
  assert.ok(isDisabled(getByLabel(html, '查看第1处引用来源')), 'a missing source cannot be opened');
  assert.ok(mentions(html, '来源卡片已不在当前画布，正文中的引用仍保留。'));
  assert.equal(isDisabled(getByLabel(html, '定位第1处引用到正文')), false, 'the occurrence in the body stays locatable');
});

test('return context is explicit and expanded draft panels render from its editor snapshot', () => {
  const draftReturn = { draftId: draft.id, title: draft.data.title };
  assertNone(render(source), { label: '返回文稿' });
  assert.ok(isButton(getByLabel(render(source, [draft], false, { draftReturn }), '返回文稿')));
  assertNone(render(draft, [source], false, { draftReturn }), { label: '返回文稿' });
  assert.ok(isButton(getByLabel(render({ ...draft, id: 'another-draft' }, [], false, { draftReturn }), '返回文稿')));
  const quote: BoardNode = { id: 'available', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '备选素材', body: '可插入的原文' } };
  const html = render(draft, [quote], false, { draftRestore: {
    draftId: draft.id, token: 1, editor: { selectionStart: 0, selectionEnd: 0, selectionDirection: 'none', editorScrollTop: 0, editorScrollLeft: 0, inspectorScrollTop: 0, referencesOpen: true, versionsOpen: true, writingExpanded: true },
  } });
  assert.ok(mentions(html, '画布里的摘录'));
  assert.match(textContent(getByTestId(html, 'draft-available-quote-available')), /可插入的原文/);
  const versionToggle = /\d+ 个历史版本/;
  assert.equal(attr(getByRole(html, 'button', versionToggle), 'aria-expanded'), 'true', 'the version panel is restored open');
  assert.equal(attr(getByRole(render(draft), 'button', versionToggle), 'aria-expanded'), 'false', 'positive control: closed by default');
  assert.match(textContent(getByLabel(html, '本稿已引用来源')), /这篇文稿还没有引用来源。/);
  assert.equal(attr(getByLabel(html, '收起写作'), 'aria-pressed'), 'true', 'writing expansion is restored');
});

test('text materials keep editable body and expose a disabled excerpt action until real text is selected', () => {
  for (const kind of ['note', 'link'] as const) {
    const material: BoardNode = { ...draft, id: `material-${kind}`, data: { kind, title: '阅读材料', body: '第一段。\r\n第二段，含有 🌿 原文。' } };
    const html = render(material);
    assert.equal(isReadOnly(getByLabel(html, '资料正文', { role: 'textbox' })), false, 'the material body stays editable');
    getByLabel(html, '文字摘录');
    assert.ok(isDisabled(getByLabel(html, '摘录选中文字到画布')), 'nothing is selected yet');
    assert.match(html, /第二段，含有 🌿 原文。/);
    assert.equal(mentions(html, /口播|预计阅读/), false, 'positive control for 预计阅读: the draft writing test');
    assertNone(html, { label: /写作/, attrs: { 'aria-pressed': 'true' } }, 'materials never open in expanded writing mode');
  }
});

test('draft writing has an explicit expansion action and a neutral reading estimate', () => {
  const html = render({ ...draft, data: { ...draft.data, body: '这是一篇文字工作者的文章。' } });
  assert.equal(attr(getByLabel(html, '展开写作'), 'aria-pressed'), 'false');
  assert.ok(mentions(html, '预计阅读'));
  assert.equal(mentions(html, '口播'), false);
  assert.equal(isReadOnly(getByLabel(html, '文稿正文', { role: 'textbox' })), false, 'the writer can edit the body');
});

test('the draft body shows readable prose: references are superscripts and the count leaves links out (PW-B1, PW-B2)', () => {
  const quote: BoardNode = { id: 'q-0b9e6c1e-7d3f-4a21-9c55-2f1d4f0a8e11', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 00:02', body: '我的理解', citation: { nodeId: source.id, title: source.data.title, text: '第二句原文。', start: 2, end: 5 } } };
  const body = `开头一句。${formatDraftQuote(quote)}后面接着写。`;
  const html = render({ ...draft, data: { ...draft.data, body } }, [source, quote]);
  const editor = getByLabel(html, '文稿正文', { role: 'textbox' });
  const visible = textContent(editor);
  assert.ok(visible.includes('开头一句。') && visible.includes('第二句原文。') && visible.includes('后面接着写。'), 'prose and the quoted sentence are shown');
  for (const hidden of ['field://', quote.id, source.id, '[来源', '](', '> ']) assert.equal(visible.includes(hidden), false, `the body never shows ${hidden}`);
  assert.equal(getAllBy(editor, { tag: 'sup' }).map(element => textContent(element)).join(','), '1', 'the reference is superscript 1');
  const footer = textContent(getBy(html, { tag: 'footer' }));
  const words = Array.from('开头一句。第二句原文。后面接着写。').length;
  const own = Array.from('开头一句。后面接着写。').length;
  // §8.3 #25 (INSP-19): “正文” is the writer's own words, “含引文” adds the quotation; links never count.
  assert.match(footer, new RegExp(`正文 ${own} 字`), 'only readable characters of the writer are counted');
  assert.match(footer, new RegExp(`含引文 ${words} 字`), 'the whole readable text, quotation included');
  assert.match(footer, /预计阅读/);
});

test('text citation snapshots never display a video transcript revision warning', () => {
  const material: BoardNode = { ...source, data: { ...source.data, kind: 'note', title: '文字资料', body: '原文后来改动', transcriptRevision: 'unused-legacy-value' } };
  const quote: BoardNode = { ...draft, id: 'text-quote', data: { kind: 'quote', title: '文字摘录', body: '', citation: { nodeId: material.id, title: '文字资料', text: '保留创建时原文', transcriptRevision: 'initial' } } };
  const html = render(quote, [material]);
  assert.equal(textContent(getBy(html, { tag: 'blockquote', text: '保留创建时原文' })).trim(), '保留创建时原文');
  assert.equal(mentions(html, '来源逐字稿后来有更新'), false, 'positive control: the citation revision test');
});

test('image inspector exposes a visible original-image action without changing its media source', () => {
  const picture: BoardNode = { ...draft, id: 'picture', data: { kind: 'image', title: '竖幅参考', body: '构图笔记', mediaId: 'local-picture' } };
  const html = render(picture);
  assert.ok(isButton(getByLabel(html, '查看原图')));
  assert.equal(attr(getByRole(html, 'img', '竖幅参考'), 'src'), 'blob:isolated-test-video');
  assert.match(html, /构图笔记/);
  assertNone(html, { label: '文字摘录' }, 'positive control: the text material test');
});

test('draft insertion uses editor offsets (UTF-16, LF) after mixed raw CRLF/CR and keeps emoji boundaries', () => {
  const raw = '甲\r\n乙\r丙🌿丁';
  const result = insertDraftText(raw, 4, 7, '新增\r\n一行\r尾');
  assert.deepEqual(result, { body: '甲\n乙\n新增\n一行\n尾丁', cursor: 11 });
  assert.equal(raw, '甲\r\n乙\r丙🌿丁');
});

test('repeated multiline quote insertion preserves complete links and the raw citation snapshot', () => {
  const quote: BoardNode = { id: 'quote-mixed', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录', body: '', citation: { nodeId: 'text-origin', title: '跨行资料', text: '原文一\r\n原文二🌿\r原文三' } } };
  const expectedQuote = '\n\n> 原文一\n> 原文二🌿\n> 原文三\n\n[来源：跨行资料](field://node/text-origin?quote=quote-mixed)\n\n';
  const first = insertDraftText('开头\r\n结尾', 3, 3, formatDraftQuote(quote));
  assert.equal(first.body, '开头\n' + expectedQuote + '结尾');
  assert.equal(first.cursor, ('开头\n' + expectedQuote).length);
  const second = insertDraftText(first.body, first.cursor, first.cursor, formatDraftQuote(quote));
  assert.equal(second.body, '开头\n' + expectedQuote + expectedQuote + '结尾');
  const references = parseDraftReferences(second.body);
  assert.equal(references.length, 2);
  for (const reference of references) assert.equal(second.body.slice(reference.from, reference.to), '[来源：跨行资料](field://node/text-origin?quote=quote-mixed)');
  assert.equal(quote.data.citation?.text, '原文一\r\n原文二🌿\r原文三');
});

test('format wrapping and locating a source use the same LF view of a restored raw version', () => {
  const raw = '引言\r\n🌿保留词\r\n[来源：文章](field://node/note-1)\r后记';
  const editorBody = raw.replace(/\r\n?/g, '\n');
  const before = parseDraftReferences(editorBody)[0];
  assert.equal(before.from, '引言\n🌿保留词\n'.length);
  assert.equal(editorBody.slice(before.from, before.to), '[来源：文章](field://node/note-1)');
  const result = insertDraftText(raw, 3, 8, '未使用\r\n默认文字', ['\r\n## ', '\r']);
  assert.deepEqual(result, { body: '引言\n\n## 🌿保留词\n\n[来源：文章](field://node/note-1)\n后记', cursor: '引言\n\n## 🌿保留词\n'.length });
  const after = parseDraftReferences(result.body)[0];
  assert.equal(after.from, '引言\n\n## 🌿保留词\n\n'.length);
  assert.equal(result.body.slice(after.from, after.to), '[来源：文章](field://node/note-1)');
  assert.equal(raw, '引言\r\n🌿保留词\r\n[来源：文章](field://node/note-1)\r后记');
});

const textMaterial: BoardNode = { id: 'long-text-source', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'note', title: '资料中的线索', body: '开头。\r\n值得保留的原文🌿。\r\n结束。' } };
const textQuote: BoardNode = { id: 'located-quote', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录', body: '', citation: { nodeId: textMaterial.id, title: textMaterial.data.title, text: '值得保留的原文🌿。' } } };

test('text source replay enters natural reading and highlights the exact quotation', () => {
  const html = render(textMaterial, [textQuote], false, { sourceTextReveal: { nodeId: textMaterial.id, quoteNodeId: textQuote.id, token: 11 } });
  const reading = getByLabel(html, '资料阅读正文');
  assert.ok(mentions(html, '已定位到摘录原文'));
  const highlight = getByLabel(reading, '摘录原文', { role: 'mark' });
  assert.equal(textContent(highlight), '值得保留的原文🌿。');
  assert.equal(attr(getByLabel(html, '展开阅读'), 'aria-pressed'), 'false');
  assertNone(html, { label: '资料正文' }, 'reading mode replaces the editor (positive control: the text material test)');
});

test('repeated text exposes every candidate without silently selecting the first occurrence', () => {
  const material = { ...textMaterial, data: { ...textMaterial.data, body: '甲。值得保留的原文🌿。\n乙。值得保留的原文🌿。' } };
  const html = render(material, [textQuote], false, { sourceTextReveal: { nodeId: textMaterial.id, quoteNodeId: textQuote.id, token: 12 } });
  assert.ok(mentions(html, '找到 2 处相同原文'));
  for (const occurrence of ['第 1 处', '第 2 处']) {
    const candidate = getBy(html, { role: 'button', text: occurrence });
    assert.equal(attr(candidate, 'aria-pressed'), 'false', `${occurrence} is offered, not preselected`);
  }
  assertNone(html, { role: 'mark' }, 'positive control: the exact quotation test');
});

test('changed and missing source text preserves the quote snapshot with a clear reading fallback', () => {
  const material = { ...textMaterial, data: { ...textMaterial.data, body: '这份资料已经重写。' } };
  const html = render(material, [textQuote], false, { sourceTextReveal: { nodeId: textMaterial.id, quoteNodeId: textQuote.id, token: 13 } });
  assert.ok(mentions(html, '当前资料中未找到这段原文'));
  assert.equal(textContent(getBy(html, { tag: 'blockquote', text: '值得保留的原文🌿。' })).trim(), '值得保留的原文🌿。');
  assert.match(html, /这份资料已经重写。/);
  assertNone(html, { role: 'mark' });
});

test('a quote belonging to another source cannot highlight this material', () => {
  const unrelated = { ...textQuote, data: { ...textQuote.data, citation: { ...textQuote.data.citation!, nodeId: 'another-material' } } };
  const html = render(textMaterial, [unrelated], false, { sourceTextReveal: { nodeId: textMaterial.id, quoteNodeId: unrelated.id, token: 14 } });
  assert.ok(mentions(html, '对应摘录已不在当前画布'));
  assertNone(html, { role: 'mark' });
});

test('draft export offers a clean draft and a source annotated draft', () => {
  const html = render(draft);
  assert.ok(isButton(getByLabel(html, '导出纯稿 Markdown')));
  assert.ok(isButton(getByLabel(html, '导出带来源 Markdown')));
  assert.equal(mentions(html, '纯文本与来源一同保留'), false);
});

test('missing stored media is distinguished from an empty material and includes retry', () => {
  const html = render(source, [], false, { getMediaUrl: () => undefined, getMediaStatus: () => 'missing', retryMedia: noop });
  assert.match(html, /视频文件未找到/);
  assert.match(html, /重新读取/);
  assert.doesNotMatch(html, /这份参考还没有本地视频/);
  assert.match(html, /第一句原文。/);
});

test('read only drafts expose readable text and disable version mutation', () => {
  const html = render(draft, [], false, { readOnly: true });
  assert.ok(isReadOnly(getByLabel(html, '资料标题', { role: 'textbox' })));
  assert.ok(isReadOnly(getByLabel(html, '文稿正文', { role: 'textbox' })));
  assert.ok(isDisabled(getByRole(html, 'button', '保存版本')));
  assert.equal(isDisabled(getByRole(render(draft), 'button', '保存版本')), false, 'positive control: the writer can save versions');
  assert.equal(isDisabled(getByLabel(html, '导出纯稿 Markdown')), false, 'reading and exporting stay available');
});

const xPostUrl = 'https://x.com/akokoi1/status/2104200939095904322';
const xVideo: BoardNode = { ...source, id: 'x-video', data: { ...source.data, title: 'X 视频', sourceUrl: `${xPostUrl}/video/1?s=20`, body: '我自己的观看笔记。', sourceOriginalText: '第一句推文。\n第二句推文🌿。\n最后一句推文完整保留。', sourceStatus: '已保存完整原帖正文；由公开内容服务获取。', tags: [] } };

test('X video separates its full short post text from viewing notes and video transcript without relying on tags', () => {
  const html = render(xVideo, [], false, { readXPost: noop });
  assert.ok(textContent(getByLabel(html, '推文正文')).includes('第一句推文。\n第二句推文🌿。\n最后一句推文完整保留。'), 'line breaks of the post are preserved');
  assert.match(html, /阅读全文并摘录/);
  assert.match(html, /观看笔记/);
  assert.match(html, /我自己的观看笔记。/);
  assert.match(html, /第一句原文。/);
  assert.equal(attr(getBy(html, { tag: 'video' }), 'src'), 'blob:isolated-test-video');
});

test('X video prefers complete immutable linked source over previews and does not replace user-edited prose', () => {
  const complete: BoardNode = { id: 'x-complete', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'link', title: '原帖', url: xPostUrl, body: '用户改写的阅读正文。', sourceOriginalText: '完整不可变推文原文。', sourceStatus: '由第三方 FxTwitter 取得；正文完整；原帖无图片' } };
  const partial: BoardNode = { ...complete, id: 'x-partial', data: { ...complete.data, sourceOriginalText: '只取得这一句预览。', sourceStatus: '由第三方 FxTwitter 取得；仅取得正文预览，原帖可能还有内容' } };
  const html = render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: undefined, sourceStatus: '原帖正文尚未取得，视频已保留。' } }, [complete, partial], false, { readXPost: noop });
  assert.match(html, /完整不可变推文原文。/);
  assert.match(html, /原帖卡的正文已有编辑。这里显示导入时保留的原文。/);
  assert.doesNotMatch(html, /只取得这一句预览。|用户改写的阅读正文。/);
  assert.doesNotMatch(html, /原帖正文尚未取得/);
  const sourceHtml = render(complete);
  assert.match(sourceHtml, /用户改写的阅读正文。/);
  assert.match(sourceHtml, /查看导入时的推文原文/);
  assert.match(sourceHtml, /完整不可变推文原文。/);
});

test('missing X prose offers independent completion and its error never removes the playable video', () => {
  const node = { ...xVideo, data: { ...xVideo.data, sourceOriginalText: undefined, sourceStatus: undefined } };
  const html = render(node, [], false, { readXPost: noop, xPostError: () => '正文服务暂时无法连接，请重试。' });
  assert.match(html, /这份视频尚未保存推文正文。/);
  assert.match(html, /补全推文正文/);
  getBy(html, { role: 'alert', text: '正文服务暂时无法连接，请重试。' }, 'the completion error is announced as an alert');
  assert.equal(attr(getBy(html, { tag: 'video' }), 'src'), 'blob:isolated-test-video');
  assert.match(html, /我自己的观看笔记。/);
});

test('X prose completion loading is explicit and prevents duplicate completion controls', () => {
  const html = render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: undefined } }, [], false, { readXPost: noop, xPostLoading: () => true });
  assert.equal(attr(getByLabel(html, '推文正文'), 'aria-busy'), 'true');
  assert.ok(mentions(html, '正在补全推文正文…'));
  assert.ok(isDisabled(getBy(html, { role: 'button', text: '正在补全正文' })), 'completion cannot be requested twice');
});

test('read only X video exposes cached post text and prevents filling a missing cache', () => {
  assert.match(render(xVideo, [], false, { readOnly: true, readXPost: noop }), /最后一句推文完整保留。/);
  const missing = render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: undefined } }, [], false, { readOnly: true, readXPost: noop });
  assert.match(missing, /请在编辑窗口补全。/);
  assert.ok(isDisabled(getBy(missing, { role: 'button', text: '补全推文正文' })));
});

test('long X prose has a readable preview and an explicit route to full reading and excerpting', () => {
  const body = '长文段落🌿。\n'.repeat(150) + '文章结尾。';
  const html = render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: body } }, [], false, { readXPost: noop });
  const prose = textContent(getByText(getByLabel(html, '推文正文'), '长文段落🌿。'));
  assert.match(prose, /…/);
  assert.doesNotMatch(prose, /文章结尾。/);
  assert.match(html, /阅读全文并摘录/);
  assert.match(render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: body } }, [], false, { readOnly: true }), /阅读全文/);
});

test('old X video share input is not presented as collected post text and generic videos have no post panel', () => {
  const share = `${xPostUrl}?s=20`;
  const task = { attemptId: 'legacy', url: xPostUrl, originalText: share, status: 'completed' as const, message: '视频已下载', mediaReady: true, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' };
  const html = render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: share, videoImport: task } }, [], false, { readXPost: noop });
  const region = getByLabel(html, '推文正文');
  assert.match(textContent(region), /这份视频尚未保存推文正文。/);
  assert.equal(textContent(region).includes(share), false, 'the old share input is not shown as post prose');
  assertNone(render(source), { label: '推文正文' }, 'positive control: the X video renders above');
});

test('a post confirmed to have no prose does not keep asking for completion', () => {
  const html = render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: '', sourceStatus: '原帖没有文字正文；已通过公开内容服务核对。' } }, [], false, { readXPost: noop });
  assert.match(html, /原帖没有文字正文，已通过公开内容服务核对。/);
  assert.doesNotMatch(html, /补全推文正文|这份视频尚未保存推文正文/);
});

test('partial X prose is labelled honestly and completion stays separate from reading the cache', () => {
  const partial: BoardNode = { id: 'x-partial', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'link', title: '原帖预览', url: xPostUrl, body: '只保存了这一段。', sourceOriginalText: '只保存了这一段。', sourceStatus: '由第三方 FxTwitter 取得；仅取得正文预览，原帖可能还有内容' } };
  const html = render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: undefined } }, [partial], false, { readXPost: noop });
  getByText(getByLabel(html, '推文正文'), /^\s*正文预览\s*$/);
  assert.match(html, /目前只取得正文预览，原帖可能还有内容。/);
  assert.match(html, /阅读已缓存正文并摘录/);
  assert.match(html, /补全推文正文/);
  const readOnly = render({ ...xVideo, data: { ...xVideo.data, sourceOriginalText: undefined } }, [partial], false, { readOnly: true, readXPost: noop });
  assert.match(readOnly, /此窗口只读，可阅读已缓存内容。/);
  assert.match(readOnly, /阅读已缓存正文/);
});

test('a complete video snapshot outranks a linked preview even when its cache is newer', () => {
  const partial: BoardNode = { id: 'x-partial-new', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'link', title: '原帖预览', url: xPostUrl, body: '较新的不完整预览。', sourceOriginalText: '较新的不完整预览。', sourceStatus: '由第三方 FxTwitter 取得；仅取得正文预览，原帖可能还有内容' } };
  const html = render(xVideo, [partial], false, { readXPost: noop });
  assert.match(html, /最后一句推文完整保留。/);
  assert.doesNotMatch(html, /较新的不完整预览。|目前只取得正文预览/);
});

test('FD-02: the watching workbench names a failed save with its next step, and shows nothing once saved', () => {
  const failed = render(source, [], false, { saveStatus: 'error', retrySave: noop });
  assert.ok(mentions(getByRole(failed, 'alert'), '保存失败'), 'the failure is announced inside the workbench, not only on the covered top bar');
  assert.equal(isDisabled(getByRole(failed, 'button', '重试保存')), false);
  const saved = render(source, [], false, { saveStatus: 'saved', retrySave: noop });
  assert.equal(queryAll(saved, { role: 'button', name: '重试保存' }).length, 0, 'no recovery strip while the board is saved');
  assert.equal(mentions(saved, '保存失败'), false);
});

test('FV-M5: an empty video slot is filled from the workbench itself, next to importing subtitles', () => {
  const slot: BoardNode = { id: 'video-slot', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'video', title: '参考视频', body: '' } };
  const html = render(slot);
  assert.ok(isButton(getByRole(html, 'button', '选择本机视频')));
  assert.ok(isButton(getByRole(html, 'button', '粘贴视频链接')));
  getByLabel(html, '选择本机视频文件');
  assert.ok(getAllBy(html, { role: 'button', name: '导入字幕' }).length > 0);
  const readOnly = render(slot, [], false, { readOnly: true });
  assert.equal(queryAll(readOnly, { role: 'button', name: '选择本机视频' }).length, 0, 'a read-only window cannot fill the card');
});

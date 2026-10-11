import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtitles } from '../src/board-utils';
import type { CardData } from '../src/model';
import { editTranscriptLine, INITIAL_TRANSCRIPT_REVISION, mergeAutomaticTranscript, replaceTranscript, restoreTranscriptLine, transcriptRevision, transcriptToSrt, transcriptToText } from '../src/transcript-tools';

function fixture(): CardData {
  return { kind: 'video', title: '参考视频', body: '', transcript: [
    { id: 'first', start: .125, end: 2.5, text: '原识别文字' },
    { id: 'second', start: 3.25, end: 5, text: '第二句' },
  ], citation: { nodeId: 'source', title: '旧摘录', text: '已摘录文字', transcriptRevision: 'initial' } };
}

test('manual editing preserves timing, identity, the first original text and citation snapshots', () => {
  const data = fixture(), before = structuredClone(data);
  const patch = editTranscriptLine(data, 'first', '第一次校对');
  assert.deepEqual(data, before);
  assert.deepEqual(patch.transcript?.[0], { id: 'first', start: .125, end: 2.5, text: '第一次校对', originalText: '原识别文字' });
  assert.equal(patch.transcript?.[1], data.transcript?.[1]);
  assert.ok(patch.transcriptRevision && patch.transcriptRevision !== INITIAL_TRANSCRIPT_REVISION);
  assert.equal(patch.citation, undefined);
  const next = { ...data, ...patch }, secondPatch = editTranscriptLine(next, 'first', '第二次校对');
  assert.equal(secondPatch.transcript?.[0].originalText, '原识别文字');
  assert.notEqual(secondPatch.transcriptRevision, patch.transcriptRevision);
  assert.deepEqual(next.citation, before.citation);
});

test('unchanged or missing sentences do not create revisions', () => {
  const data = fixture();
  assert.deepEqual(editTranscriptLine(data, 'first', '原识别文字'), {});
  assert.deepEqual(editTranscriptLine(data, 'missing', '未找到'), {});
  assert.deepEqual(restoreTranscriptLine(data, 'first'), {});
  assert.deepEqual(restoreTranscriptLine(data, 'missing'), {});
  assert.equal(transcriptRevision(data), 'initial');
  assert.equal(transcriptRevision(undefined), 'initial');
  assert.equal(transcriptRevision({ transcriptRevision: 'revision-one' }), 'revision-one');
});

test('restore removes the baseline marker and changes revision without editing other data', () => {
  const data = fixture(), first = { ...data, ...editTranscriptLine(data, 'first', '校对后') };
  const patch = restoreTranscriptLine(first, 'first');
  assert.deepEqual(patch.transcript, data.transcript);
  assert.ok(!Object.hasOwn(patch.transcript![0], 'originalText'));
  assert.notEqual(patch.transcriptRevision, first.transcriptRevision);
  assert.deepEqual(restoreTranscriptLine({ ...first, ...patch }, 'first'), {});
  assert.equal(first.transcript?.[0].text, '校对后');
});

test('editing back to the original text restores it and the next edit establishes the same baseline', () => {
  const data = fixture(), first = { ...data, ...editTranscriptLine(data, 'first', '校对后') };
  const patch = editTranscriptLine(first, 'first', '原识别文字');
  assert.deepEqual(patch.transcript, data.transcript);
  assert.notEqual(patch.transcriptRevision, first.transcriptRevision);
  const third = editTranscriptLine({ ...first, ...patch }, 'first', '再校对');
  assert.equal(third.transcript?.[0].originalText, '原识别文字');
});

test('editor rejects blank, non-string, NUL and oversized text without trimming literal writing', () => {
  const data = fixture();
  for (const invalid of ['', ' \n\t ', 'x'.repeat(20_001), 'a\u0000b', null, 17, {}]) {
    assert.throws(() => editTranscriptLine(data, 'first', invalid as string), /逐字稿文字/);
  }
  const literal = '  <script>这是文字</script> & 引号\n第二行  ';
  assert.equal(editTranscriptLine(data, 'first', literal).transcript?.[0].text, literal);
  assert.equal(editTranscriptLine(data, 'first', 'x'.repeat(20_000)).transcript?.[0].text.length, 20_000);
});

test('plain text export uses exactly the supplied current sentences and preserves literal HTML as text', () => {
  const data = fixture();
  const updated = { ...data, ...editTranscriptLine(data, 'first', '<b>校对后</b>\n仍是文字') };
  assert.equal(transcriptToText(updated.transcript!), '<b>校对后</b>\n仍是文字\n第二句');
  assert.equal(transcriptToText(updated.transcript!.slice(1)), '第二句');
  assert.equal(transcriptToText([]), '');
  assert.equal(transcriptToText(data.transcript!, { timestamps: true }), '[00:00:00.125 – 00:00:02.500] 原识别文字\n[00:00:03.250 – 00:00:05.000] 第二句');
});

test('SRT export rounds with second, minute and hour carry and reimports the current text', () => {
  const lines = [
    { id: 'last', start: 3599.9996, end: 3601.1254, text: '满一小时' },
    { id: 'first', start: 59.9996, end: 62.0004, text: '校对后\n新一行', originalText: '旧识别' },
  ];
  const output = transcriptToSrt(lines);
  assert.equal(output, '1\n00:01:00,000 --> 00:01:02,000\n校对后\n新一行\n\n2\n01:00:00,000 --> 01:00:01,125\n满一小时\n');
  assert.deepEqual(parseSubtitles(output).map(({ start, end, text }) => ({ start, end, text })), [
    { start: 60, end: 62, text: '校对后\n新一行' }, { start: 3600, end: 3601.125, text: '满一小时' },
  ]);
  assert.equal(lines[0].id, 'last', 'export does not reorder the original array');
  assert.equal(transcriptToSrt([]), '');
});

test('SRT round trip preserves ordinary ampersands, arrows, multiline Chinese and milliseconds', () => {
  const text = '光 & 影：A --> B\n继续下一句';
  const output = transcriptToSrt([{ id: 'text', start: 1.125, end: 3.875, text }]);
  assert.equal(output, `1\n00:00:01,125 --> 00:00:03,875\n${text}\n`);
  assert.deepEqual(parseSubtitles(output).map(({ start, end, text }) => ({ start, end, text })), [{ start: 1.125, end: 3.875, text }]);
});

test('TXT and the SRT file retain literal markup and entities without adding an escape protocol', () => {
  const text = '<i>这是字面标签</i> & A --> B &amp; &#39; &quot;';
  const lines = [{ id: 'text', start: 0, end: 1, text }];
  assert.equal(transcriptToText(lines), text);
  assert.equal(transcriptToSrt(lines), `1\n00:00:00,000 --> 00:00:01,000\n${text}\n`);
  // This checks file contents only: SRT players may interpret tags and entities.
});

test('SRT keeps valid positive intervals after millisecond rounding and rejects invalid timings', () => {
  for (const [start, end] of [[0, .0001], [1.0001, 1.0002], [604799.9998, 604800]]) {
    const [parsed] = parseSubtitles(transcriptToSrt([{ id: 'tiny', start, end, text: '很短的一句' }]));
    assert.ok(parsed.end > parsed.start);
    assert.ok(Math.abs(parsed.start - start) <= .0011);
    assert.ok(Math.abs(parsed.end - end) <= .0011);
  }
  for (const [start, end] of [[1, 1], [2, 1], [-1, 1], [NaN, 1], [0, Infinity], [0, 604801]]) {
    assert.throws(() => transcriptToSrt([{ id: 'invalid', start, end, text: '无效' }]));
  }
});

test('SRT normalizes paragraph separators while plain text retains them', () => {
  const lines = [{ id: 'paragraphs', start: 0, end: 5, text: '第一段\r\n\r\n第二段\n \n\n第三段' }];
  assert.equal(parseSubtitles(transcriptToSrt(lines))[0].text, '第一段\n第二段\n第三段');
  assert.equal(transcriptToText(lines), lines[0].text);
});

test('explicit replacement copies validated new text, resets correction baselines and advances revision', () => {
  const data = { ...fixture(), ...editTranscriptLine(fixture(), 'first', '旧校对') };
  const incoming = [{ id: 'new-line', start: 1, end: 3, text: '新字幕', originalText: '不沿用的基线' }];
  const patch = replaceTranscript(data, incoming);
  assert.deepEqual(patch.transcript, [{ id: 'new-line', start: 1, end: 3, text: '新字幕' }]);
  assert.notEqual(patch.transcriptRevision, data.transcriptRevision);
  assert.notEqual(patch.transcript![0], incoming[0]);
  assert.equal(incoming[0].originalText, '不沿用的基线');
  assert.equal(patch.citation, undefined);
});

test('replacement rejects unusable line arrays, invalid times, repeated IDs and unsafe fields', () => {
  const line = fixture().transcript![0];
  for (const invalid of [null, {}, 'text', [line, line], [{ ...line, id: '' }], [{ ...line, id: 'x\u0000y' }],
    [{ ...line, text: ' ' }], [{ ...line, text: 'x'.repeat(20_001) }], [{ ...line, start: NaN }], [{ ...line, start: line.end }],
    [{ ...line, constructor: {} }], Array.from({ length: 10_001 }, (_, index) => ({ ...line, id: String(index) }))]) {
    assert.throws(() => replaceTranscript(fixture(), invalid as never));
  }
});

test('same-asset background refresh retains edited text and revision but applies media progress', () => {
  const data = fixture(), corrected = { ...data, ...editTranscriptLine(data, 'first', '用户校对') };
  const incoming = { transcript: data.transcript, transcriptRevision: 'remote-version', duration: 12, nativeImportJobId: 'task' };
  const patch = mergeAutomaticTranscript(corrected, incoming, false);
  assert.deepEqual(patch, { duration: 12, nativeImportJobId: 'task' });
  const merged = { ...corrected, ...patch };
  assert.equal(merged.transcript?.[0].text, '用户校对');
  assert.equal(merged.transcriptRevision, corrected.transcriptRevision);
  assert.equal(incoming.transcriptRevision, 'remote-version', 'incoming result remains immutable');
  const restored = { ...corrected, ...restoreTranscriptLine(corrected, 'first') };
  assert.deepEqual(mergeAutomaticTranscript(restored, incoming, false), patch, 'restoring baseline still protects the explicit user decision');
});

test('initial automatic results are accepted, while a changed asset clears old corrections and revision', () => {
  const data = fixture(), incoming = [{ id: 'new', start: 0, end: 1, text: '新片段', originalText: '旧片段基线' }];
  const initial = mergeAutomaticTranscript(data, { transcript: incoming, transcriptRevision: 'foreign' }, false);
  assert.deepEqual(initial, { transcript: [{ id: 'new', start: 0, end: 1, text: '新片段' }] });
  assert.equal(transcriptRevision({ ...data, ...initial }), 'initial');
  const corrected = { ...data, ...editTranscriptLine(data, 'first', '用户校对') };
  const changed = mergeAutomaticTranscript(corrected, { transcript: incoming, nativeAssetId: 'new-asset' }, true);
  assert.equal(changed.transcriptRevision, undefined);
  assert.ok(Object.hasOwn(changed, 'transcriptRevision'), 'a spread merge must clear the previous revision');
  assert.equal(changed.transcript?.[0].originalText, undefined);
  assert.equal(transcriptRevision({ ...corrected, ...changed }), 'initial');
  assert.deepEqual(mergeAutomaticTranscript(corrected, {}, true), { transcript: [], transcriptRevision: undefined });
  assert.deepEqual(mergeAutomaticTranscript(data, { duration: 10 }, false), { duration: 10 });
});

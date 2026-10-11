import assert from 'node:assert/strict';
import test from 'node:test';
import type { Citation } from '../src/model';
import { createTextAnchor, normalizeTextBody, resolveTextAnchor } from '../src/text-anchor';

function capture(body: string, text: string, last = false): Citation {
  const normalized = normalizeTextBody(body), snapshot = normalizeTextBody(text);
  const from = last ? normalized.lastIndexOf(snapshot) : normalized.indexOf(snapshot);
  assert.ok(from >= 0);
  return { nodeId: 'source', title: '原文', text, textAnchor: createTextAnchor(body, from, from + snapshot.length) };
}

test('CRLF, lone CR and emoji resolve in normalized UTF-16 offsets while the snapshot stays literal', () => {
  const body = '开头\r\n甲🙂\r乙\r\n尾部', citation = capture(body, '甲🙂\r乙');
  const before = structuredClone(citation);
  assert.deepEqual(citation.textAnchor, { from: 3, to: 8, prefix: '开头\n', suffix: '\n尾部' });
  assert.deepEqual(resolveTextAnchor(body, citation), { status: 'matched', matches: [{ from: 3, to: 8 }], changed: false });
  assert.deepEqual(resolveTextAnchor(normalizeTextBody(body), citation), { status: 'matched', matches: [{ from: 3, to: 8 }], changed: false });
  assert.deepEqual(citation, before);
});

test('64-unit neighborhoods retain complete emoji and selections cannot split a surrogate pair', () => {
  const body = `🙂${'前'.repeat(63)}摘${'后'.repeat(63)}🙂`;
  const from = body.indexOf('摘'), anchor = createTextAnchor(body, from, from + 1);
  assert.equal(anchor.prefix, '前'.repeat(63));
  assert.equal(anchor.suffix, '后'.repeat(63));
  assert.ok(anchor.prefix.length <= 64 && anchor.suffix.length <= 64);
  assert.throws(() => createTextAnchor(body, 0, 1), /选区无效/);
  assert.throws(() => createTextAnchor(body, 1, 2), /选区无效/);
  for (const range of [[-1, 2], [0, 0], [0.5, 2], [0, Infinity], [0, body.length + 1]]) {
    assert.throws(() => createTextAnchor(body, range[0], range[1]), /选区无效/);
  }
});

test('a unique moved quotation is found and reports the changed position without replacing its snapshot', () => {
  const body = '序言\n需要回查的文字🙂\n结尾', citation = capture(body, '需要回查的文字🙂'), before = structuredClone(citation);
  const changedBody = `新增的一段\n${body}`;
  const from = changedBody.indexOf(citation.text!);
  assert.deepEqual(resolveTextAnchor(changedBody, citation), { status: 'matched', matches: [{ from, to: from + citation.text!.length }], changed: true });
  assert.deepEqual(citation, before);
});

test('stored context selects the correct moved occurrence among identical quoted passages', () => {
  const body = `甲${'a'.repeat(80)}共同原文${'b'.repeat(80)}乙${'c'.repeat(80)}共同原文${'d'.repeat(80)}丙`;
  const citation = capture(body, '共同原文', true), moved = `新增🙂\n${body}`;
  const from = moved.lastIndexOf('共同原文');
  assert.deepEqual(resolveTextAnchor(moved, citation), { status: 'matched', matches: [{ from, to: from + 4 }], changed: true });
});

test('an unchanged stored position remains exact even when the source contains repeated text', () => {
  const body = '前文 原文 中间 原文 后文', citation = capture(body, '原文', true), from = body.lastIndexOf('原文');
  assert.deepEqual(resolveTextAnchor(body, citation), { status: 'matched', matches: [{ from, to: from + 2 }], changed: false });
});

test('lost context with multiple copies returns every candidate and never silently chooses the first', () => {
  const citation = capture('独特前文 原文 独特后文', '原文'), changed = '新一段 原文\n另一段 原文';
  assert.deepEqual(resolveTextAnchor(changed, citation), {
    status: 'ambiguous', matches: [{ from: changed.indexOf('原文'), to: changed.indexOf('原文') + 2 }, { from: changed.lastIndexOf('原文'), to: changed.lastIndexOf('原文') + 2 }], changed: true,
  });
  // The old range happens to contain the same characters, but its changed context cannot certify it.
  const atOldOffset = '新的前文 原文 另一后文 原文';
  assert.equal(atOldOffset.indexOf('原文'), citation.textAnchor!.from);
  assert.equal(resolveTextAnchor(atOldOffset, citation).status, 'ambiguous');
});

test('changed or deleted original text has no match and keeps the original snapshot', () => {
  const citation = capture('前 原始段落🙂 后', '原始段落🙂'), before = structuredClone(citation);
  for (const body of ['前 改写段落🙂 后', '', '前 原始段落 后']) {
    assert.deepEqual(resolveTextAnchor(body, citation), { status: 'missing', matches: [], changed: true });
    assert.deepEqual(citation, before);
  }
});

test('legacy snapshots use exact lookup, exposing ambiguity without claiming an unknown revision changed', () => {
  const citation = { nodeId: 'old', title: '旧摘录', text: '甲\r\n🙂' };
  assert.deepEqual(resolveTextAnchor('前甲\n🙂后', citation), { status: 'matched', matches: [{ from: 1, to: 5 }], changed: false });
  assert.deepEqual(resolveTextAnchor('甲\n🙂/甲\n🙂', citation), { status: 'ambiguous', matches: [{ from: 0, to: 4 }, { from: 5, to: 9 }], changed: false });
  assert.deepEqual(resolveTextAnchor('改写', citation), { status: 'missing', matches: [], changed: false });
  assert.deepEqual(resolveTextAnchor('内容', { nodeId: 'old', title: '无快照' }), { status: 'missing', matches: [], changed: false });
});

test('overlapping legacy occurrences stay ambiguous and partial emoji cannot become a valid match', () => {
  assert.deepEqual(resolveTextAnchor('aaaa', { nodeId: 's', title: '', text: 'aaa' }), { status: 'ambiguous', matches: [{ from: 0, to: 3 }, { from: 1, to: 4 }], changed: false });
  assert.deepEqual(resolveTextAnchor('🙂', { nodeId: 's', title: '', text: '\uD83D' }), { status: 'missing', matches: [], changed: false });
});

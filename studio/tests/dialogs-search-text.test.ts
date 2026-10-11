import test from 'node:test';
import assert from 'node:assert/strict';
import { matchText, pinyinInitials, readableExcerpt } from '../src/dialogs/search-text';
import { SHORTCUTS, SHORTCUT_GROUPS, chordLabel, matchesShortcut, shortcutLabel } from '../src/dialogs/shortcuts';

test('pinyin initials keep one letter per UTF-16 position', () => {
  assert.equal(pinyinInitials('新建笔记'), 'xjbj');
  assert.equal(pinyinInitials('导入素材'), 'drsc');
  assert.equal(pinyinInitials('新建 PDF'), 'xj pdf');
  assert.equal(pinyinInitials('查看全部').length, 4);
});

test('commands match by title, pinyin initials or alias, with highlight ranges on the title', () => {
  const title = matchText('新建', '新建笔记');
  assert.ok(title);
  assert.deepEqual(title.ranges, [{ start: 0, end: 2 }]);
  const initials = matchText('xjbj', '新建笔记');
  assert.ok(initials);
  assert.deepEqual(initials.ranges, [{ start: 0, end: 4 }]);
  const alias = matchText('fit', '查看全部', ['fit', '缩放到全部']);
  assert.ok(alias);
  assert.equal(alias.ranges.length, 0);
  assert.equal(matchText('导出', '新建笔记'), null);
  assert.ok(matchText('新建', '新建笔记')!.score > matchText('笔记', '新建笔记')!.score, 'a match at the start ranks higher');
});

test('readable excerpts hide Markdown, internal links and ids, and remap highlights', () => {
  const raw = '## 开场\n\n> 摊主说，四点出摊不是为了赚钱。\n[来源：凌晨四点的早餐摊](field://node/0f8fad5b-d9cb-469f-a165-70867728950e?quote=1&t=72)\n\n- 先拍蒸汽';
  const start = raw.indexOf('四点');
  const result = readableExcerpt(raw, [{ start, end: start + 2 }]);
  assert.equal(result.text.includes('field://'), false);
  assert.equal(result.text.includes('##'), false);
  assert.equal(result.text.includes('>'), false);
  assert.equal(/[0-9a-f]{8}-/.test(result.text), false);
  assert.equal(result.text.includes('\n'), false);
  // Lines and paragraphs stay apart: a full-width space between Chinese lines (DLG-02), a plain space for Latin.
  assert.equal(result.text, '开场　摊主说，四点出摊不是为了赚钱。　先拍蒸汽');
  assert.deepEqual(result.ranges.map(range => result.text.slice(range.start, range.end)), ['四点']);
  const latin = readableExcerpt('first line\nsecond **bold** line');
  assert.equal(latin.text, 'first line second bold line');
  const link = readableExcerpt('见 [方法笔记](https://example.org/a) 第二段');
  assert.equal(link.text, '见 方法笔记 第二段');
  // A Markdown article's first line repeats the card title: skipped; byline and heading no longer glue to the text.
  const article = readableExcerpt('# 步行十五分钟，能到达什么\n\n文 / 林冉\n\n## 引子\n\n早上七点出门', [], { title: '步行十五分钟，能到达什么' });
  assert.equal(article.text, '文 / 林冉　引子　早上七点出门');
  // An excerpt cut inside a source pointer keeps only the quoted words around it.
  const cutStart = readableExcerpt('…能到达什么](field://node/abc?quote=q)\n\n站在老周的摊前');
  assert.equal(cutStart.text, '…站在老周的摊前');
  const cutEnd = readableExcerpt('我抄了下来：\n\n> 一座城市是否宜居。\n\n[来源：步行十五分钟，能到…');
  assert.equal(cutEnd.text, '我抄了下来：　一座城市是否宜居。…');
  assert.equal(readableExcerpt('撑住：\n\n[来源：凌晨四点的早餐摊 01:12](fiel').text, '撑住：');
});

test('the help table and the keyboard handler read the same shortcut list', () => {
  const groups = new Set(SHORTCUT_GROUPS.map(group => group.id));
  for (const item of SHORTCUTS) assert.ok(groups.has(item.group), `${item.id} belongs to a help group`);
  for (const id of ['help', 'escape', 'search', 'undo', 'redo', 'fit', 'add-note', 'add-draft']) assert.ok(SHORTCUTS.some(item => item.id === id), `${id} is listed`);
  const key = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra });
  assert.ok(matchesShortcut(key('k', { ctrlKey: true }), 'search'));
  assert.ok(matchesShortcut(key('K', { metaKey: true }), 'search'));
  assert.ok(!matchesShortcut(key('k'), 'search'));
  assert.ok(matchesShortcut(key('Z', { ctrlKey: true, shiftKey: true }), 'redo'));
  assert.ok(matchesShortcut(key('y', { ctrlKey: true }), 'redo'));
  assert.ok(!matchesShortcut(key('z', { ctrlKey: true, shiftKey: true }), 'undo'));
  assert.ok(matchesShortcut(key('?', { shiftKey: true }), 'help'));
  assert.ok(matchesShortcut(key('ArrowLeft', { shiftKey: true }), 'nudge'));
  assert.equal(chordLabel({ key: 'z', mod: true, shift: true }, false), 'Ctrl Shift Z');
  assert.equal(chordLabel({ key: 'z', mod: true, shift: true }, true), '⌘⇧Z');
  assert.equal(shortcutLabel('search', false), 'Ctrl K');
});

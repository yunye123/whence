import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runBreaks, sentenceNodes, transcriptRuns } from '../src/inspector/transcript-wrap';
import { createExampleBoard } from '../src/templates';
import { buildScript, isPictureNote, isScriptLine, scriptTimeResolver } from '../src/inspector/script-view/script-model';

// fix-panels round 4: transcript lines break between words or at pauses (QA round 3 P5), and the example script's
// two shot notes sit in the 画面 column (QA round 3 S5).

const LINE = 22.5; // em in the 480 px transcript column (344 px of text at 15 px)
const breaksOf = (text: string, capacity = LINE) => transcriptRuns(text, capacity);

test('a sentence whose pauses make tidy lines keeps them; a stray first clause or a long clause breaks between words', () => {
  assert.deepEqual(breaksOf('一张照片，一段现成的视频，就能把你一秒丢进影视级的名场面里。'), ['一张照片，', '一段现成的视频，', '就能把你一秒丢进影视级的名场面里。']);
  assert.deepEqual(breaksOf('今天一条视频教会你，如何告别超长提示词来实现这种复杂的影视效果。'), ['今天一条视频教会你，', '如何告别超长提示词来实现这种复杂的影视效果。'], 'a 10 em first line still ends at the pause');
  // “脑海中的转场、” alone on the first line was the QA case: the next clause is longer than a line, so it breaks by word.
  const long = breaksOf('脑海中的转场、变身这类精细的镜头动作根本不知道该怎么用提示词来写出来。')!;
  assert.ok(long.length > 5, 'the long clause offers word breaks');
  assert.equal(long[0], '脑海中的转场、');
  // “打到招式、” (5 of 22 em) would stand alone: by word instead.
  const stray = breaksOf('打到招式、舞蹈走位和运镜节奏都能做到几乎一比一的还原。')!;
  assert.ok(stray.length > 3);
  assert.ok(stray.includes('走位和运镜'), 'single characters the dictionary does not know stay together (运|镜)');
});

test('no break inside words the segmenter splits into single characters, and none inside a word at all', () => {
  for (const text of ['本期用到的所有案例和提示词已经整理到了教程文档里面，', '本期用到的所有案例和提示词已经整理到了教程文档里面欢迎大家下载后对照着视频一步一步练习']) {
    const runs = breaksOf(text)!;
    assert.equal(runs.join(''), text, 'runs spell the sentence');
    const at = text.indexOf('文档');
    assert.equal(runBreaks(runs).includes(at + 1), false, 'never “教程文 / 档”');
  }
});

test('mixed Chinese and Latin breaks at spaces and words; Latin-only text and an unmeasured column keep the browser breaking', () => {
  const mixed = '先在 Premiere Pro 里用 Essential Graphics 面板批量替换字幕样式，再导出成 ProRes 4444 带透明通道的素材文件。';
  const runs = breaksOf(mixed)!;
  assert.equal(runs.join(''), mixed);
  for (const word of ['Premiere ', 'Essential ', 'Graphics ', 'ProRes ']) assert.ok(runs.includes(word), `${word.trim()} is one run`);
  assert.equal(transcriptRuns('Just an English sentence, nothing to decide.', LINE), null);
  assert.equal(transcriptRuns('凌晨四点，这条街上只有一盏灯是亮的。', 0), null, 'before the column is measured (and on the server) nothing is inserted');
});

test('the rendered sentence keeps its exact text: <wbr> between runs, search hits marked across a break', () => {
  const text = '摊主说，四点出摊不是为了赚钱，';
  const html = (needle: string, breaks: number[]) => renderToStaticMarkup(createElement(Fragment, null, sentenceNodes(text, needle, breaks)));
  const plain = (markup: string) => markup.replace(/<[^>]+>/g, '');
  const breaks = runBreaks(['摊主说，', '四点', '出摊', '不是', '为了', '赚钱，']);
  assert.equal(html('', []), text);
  const wrapped = html('', breaks);
  assert.equal((wrapped.match(/<wbr\/>/g) ?? []).length, 5);
  assert.equal(plain(wrapped), text);
  const hit = html('出摊不是', breaks);
  assert.equal(plain(hit), text);
  assert.match(hit, /<wbr\/><mark class="watch-hit">出摊<wbr\/>不是<\/mark><wbr\/>为了/, 'breaks at either end of a hit sit outside the mark, inside ones stay inside');
  assert.equal((hit.match(/<mark/g) ?? []).length, 1);
  const twice = renderToStaticMarkup(createElement(Fragment, null, sentenceNodes('四点四点', '四点', [2])));
  assert.equal((twice.match(/<wbr\/>/g) ?? []).length, 1, 'adjacent hits share one break');
});

test('the example script: the two shot notes are 镜头 lines in the 画面 column; scenes, lines, length and K1 subtitles unchanged', () => {
  const board = createExampleBoard('video');
  const draft = board.nodes.find(node => node.data.kind === 'draft')!;
  const model = buildScript(draft.data.body, scriptTimeResolver(board.nodes));
  const lines = model.scenes.flatMap(scene => scene.rows.filter(isScriptLine));
  assert.equal(model.lineCount, 9);
  assert.equal(model.total, 140);
  assert.deepEqual(lines.filter(isPictureNote).map(line => line.number), [1, 3, 6, 7, 9]);
  assert.deepEqual(lines.filter(line => isPictureNote(line)).map(line => line.label), ['画面', '画面', '镜头', '画面', '镜头']);
  assert.match(draft.data.body, /\n镜头：跟着司机吃完、上车，不解释。/);
  assert.match(draft.data.body, /\n镜头：最后停在叠好的塑料凳上，黑场三秒。$/);
  assert.equal(lines.filter(line => !isPictureNote(line) && !line.shots.length).length, 2, '旁白 column keeps the two director lines (2, 4)');
  const video = board.nodes.find(node => node.data.kind === 'video')!;
  assert.deepEqual(video.data.transcript!.slice(0, 3).map(line => line.start), [0, 6, 13]);
});

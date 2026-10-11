import test from 'node:test';
import assert from 'node:assert/strict';
import { readingLines, type WordSegment } from '../native/transcript-sentences';

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
const segment = (id: string, words: ReturnType<typeof w>[]): WordSegment => ({ id, text: words.map(word => word.text).join(''), startMs: words[0].startMs, endMs: words[words.length - 1].endMs, words });

test('CORE-06: lines are regrouped from word times, so a word cut by Whisper’s segments stays on one line', () => {
  const segments = [
    segment('s0', [w('今天', 0, 400), w('我们', 400, 700), w('来', 700, 900), w('聊一聊', 900, 1500), w('无', 1500, 1700)]),
    segment('s1', [w('论', 1720, 1900), w('你', 1900, 2100), w('在', 2100, 2300), w('哪里', 2300, 2700), w('这', 3300, 3500)]),
    segment('s2', [w('就是', 3520, 3800), w('我', 3800, 4000), w('想说的', 4000, 4900)]),
  ];
  const lines = readingLines(segments);
  assert.deepEqual(lines.map(line => line.text), ['今天我们来聊一聊无论你在哪里', '这就是我想说的']);
  assert.deepEqual(lines.map(line => [line.start, line.end]), [[0, 2.7], [3.3, 4.9]]);
  assert.equal(lines[0].id, 's0');
  assert.equal(lines[1].id, 's1~w4', 'a line starting inside a segment gets a stable id of its own');
  assert.equal(new Set(lines.map(line => line.id)).size, lines.length);
});

test('CORE-06: a fragment under 1.5 s or 4 characters joins its closer neighbour; punctuation and long pauses still break', () => {
  const segments = [
    segment('a', [w('第一句话说完了。', 0, 2000)]),
    segment('b', [w('嗯', 2600, 2800)]),
    segment('c', [w('然后', 2900, 3200), w('我们', 3200, 3500), w('继续往下讲', 3500, 4600)]),
    segment('d', [w('最后', 6000, 6400), w('一句', 6400, 6800), w('收尾的话', 6800, 7900)]),
  ];
  const lines = readingLines(segments);
  assert.deepEqual(lines.map(line => line.text), ['第一句话说完了。', '嗯然后我们继续往下讲', '最后一句收尾的话']);
  assert.ok(lines.every(line => line.end - line.start >= 1.5));
});

test('CORE-06: proofread segments and segments without word times keep their own line', () => {
  const segments: WordSegment[] = [
    segment('x', [w('这', 0, 300), w('一段', 300, 900), w('照常', 900, 1800)]),
    segment('y', [w('改', 1800, 2200), w('过的', 2200, 3000)]),
    { id: 'z', text: ' 没有逐词时间', startMs: 3000, endMs: 5000, words: [] },
  ];
  const lines = readingLines(segments, { y: '校对过的一句' });
  assert.deepEqual(lines.map(line => [line.id, line.text]), [['x', '这一段照常'], ['y', '校对过的一句'], ['z', ' 没有逐词时间']]);
});

test('CORE-06: Western words keep their spaces, CJK characters lose the ones Whisper adds', () => {
  const lines = readingLines([segment('e', [w(' Hello', 0, 500), w(' world', 500, 1000), w(' 你', 1000, 1300), w(' 好', 1300, 1700)])]);
  assert.equal(lines[0].text, 'Hello world 你好');
});

test('CORE-12: transcription progress reads as time reached, never device, batch or a raw GPU error', async () => {
  const { transcribeProgressMessage, TRANSCRIBE_STARTING } = await import('../native/transcribe-progress');
  assert.equal(transcribeProgressMessage('加载本地模型：cuda / batch 8', 161), TRANSCRIBE_STARTING);
  assert.equal(transcribeProgressMessage('已转写到 100.8 秒（cuda）', 161), '转写中 1:40 / 2:41');
  assert.equal(transcribeProgressMessage('已转写到 12.0 秒（cpu） · 8%'), '转写中 0:12');
  assert.equal(transcribeProgressMessage('已转写到 3725 秒（cuda）', 4000), '转写中 1:02:05 / 1:06:40');
  assert.equal(transcribeProgressMessage('GPU 尝试失败，降低负载重试：CUDA out of memory. Tried to allocate…'), '换一种方式继续转写…');
  assert.equal(transcribeProgressMessage('正在等待这条视频已有的转写任务'), '正在等待这条视频已有的转写任务');
});

test('CORE-06: a word Whisper cut at its segment end (and its time gap) moves whole to the next line', () => {
  const chars = (text: string, start: number, step = 200) => [...text].map((ch, i) => w(ch, start + i * step, start + (i + 1) * step));
  const segments = [
    segment('p', chars('就能把你丢进名场面里无', 0)),
    segment('q', chars('论是多机对打还是运镜', 4500)),
    segment('r', chars('全都能完美复刻这', 7000)),
    segment('s', chars('就是最新上线的功能', 9600)),
  ];
  const lines = readingLines(segments).map(line => line.text);
  assert.deepEqual(lines, ['就能把你丢进名场面里', '无论是多机对打还是运镜', '全都能完美复刻', '这就是最新上线的功能']);
});

/** One word per character (marks stay on the character before them), 200 ms each by default, with optional pauses before given characters. */
function spoken(text: string, start = 0, pauses: Record<number, number> = {}, step = 200) {
  const tokens = text.match(/.[，。、！？：,]?/gu) ?? [];
  let at = start;
  return tokens.map((token, index) => { at += pauses[index] ?? 0; const word = w(token, at, at + step); at += step; return word; });
}

test('CORE-06: with punctuation, lines end at the marks and a pause after a clause’s first word does not leave it behind', () => {
  // “还是” is followed by a 2.4 s pause (the speaker shows a clip); before, it ended a line on its own.
  const first = spoken('一张照片，一段现成的视频，就能把你丢进名场面里。', 0);
  const second = spoken('无论是多机位对打，还是贴地运镜加慢动作，动作、景深、运镜全都能完美复刻。', 8000, { 9: 2000, 11: 2400 });
  const lines = readingLines([segment('a', first), segment('b', second)]).map(line => line.text);
  assert.ok(lines.every(line => /[，。]$/.test(line)), lines.join(' / '));
  assert.ok(!lines.some(line => line.endsWith('还是')), lines.join(' / '));
  assert.ok(lines.some(line => line.includes('还是贴地')), lines.join(' / '));
  assert.ok(!lines.some(line => /[、]$/.test(line)), 'a list (动作、景深、运镜) is never split');
  assert.equal(lines.join(''), first.concat(second).map(word => word.text).join(''), 'nothing is lost or reordered');
});

test('CORE-06: a punctuated sentence over 8 s or 42 characters splits at the comma nearest its middle', () => {
  const text = '你只需要找到合适的参考视频，然后上传到画布上，点击菜单中的深度提取，选择分辨率和模型，就能得到一段深度视频。';
  const lines = readingLines([segment('long', spoken(text))]).map(line => line.text);
  assert.ok(lines.length >= 2, lines.join(' / '));
  assert.ok(lines.every(line => /[，。]$/.test(line)), lines.join(' / '));
  assert.ok(lines.every(line => [...line.replace(/\p{P}/gu, '')].length <= 42), lines.join(' / '));
  assert.equal(lines.join(''), text);
});

test('CORE-06: without marks, a 12 s stretch is still cut by pauses and clauses; with marks, the cut prefers a comma', () => {
  const plain = '我们先把参考视频准备好上传到画布上然后在菜单里选择深度提取等它生成完成以后再上传身份卡和提示词最后点生成';
  const comma = '我们先把参考视频准备好，上传到画布上然后在菜单里选择深度提取等它生成完成以后再上传身份卡和提示词最后点生成';
  const plainLines = readingLines([segment('p', spoken(plain, 0, {}, 300))]).map(line => line.text);
  const commaLines = readingLines([segment('c', spoken(comma, 0, {}, 300))]).map(line => line.text);
  assert.equal(plainLines.join(''), plain);
  assert.ok(plainLines.length >= 2);
  assert.equal(commaLines.join(''), comma);
  assert.ok(commaLines[0].endsWith('准备好，'), commaLines.join(' / '));
});

test('CORE-06: a long stretch without pauses is cut where a clause starts, not after a fixed time', () => {
  const text = '你只需要找到合适的参考视频上传到画布上点击菜单中的深度提取然后就能得到一段深度视频生成深度视频是免费的';
  const words = [...text].map((ch, i) => w(ch, i * 260, (i + 1) * 260));
  const lines = readingLines([segment('long', words)]).map(line => line.text);
  assert.ok(lines.length >= 2);
  assert.ok(lines.some(line => line.startsWith('然后')), lines.join(' / '));
  assert.equal(lines.join(''), text, 'nothing is lost or reordered');
});

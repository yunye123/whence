import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardContext } from '../src/board-context';
import type { BoardActions } from '../src/board-context';
import { createNode, exportMarkdown } from '../src/board-utils';
import {
  applySurfaceTranslation, cardDataAfterEdit, normalizeTranslatedSegmentBatch, splitTranslationText,
  surfaceTranslation, translateEnglish, translationSettingsFromEnv, translationSystemPrompt,
} from '../src/english-translation';
import QuoteCitationPanel from '../src/inspector/QuoteCitationPanel';
import type { Board, BoardNode, CardData, Workspace } from '../src/model';
import { createBoard, exportBoard, importBoard, validateBoard } from '../src/storage';
import { editTranscriptLine, restoreTranscriptLine } from '../src/transcript-tools';
import { createWorkspaceSearchIndex, searchWorkspace } from '../src/workspace-search';

const KEY = 'test-key-not-real';

interface RecordedCall { url: string; body: Record<string, unknown>; headers: Record<string, string> }

function chat(content: string, status = 200) {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    json: async () => (ok ? { choices: [{ message: { content } }] } : { error: { message: 'busy' } }),
  };
}

function recorded(calls: RecordedCall[], contentFor: (segments: { id: string; text: string }[]) => string) {
  return async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, body, headers: init.headers });
    const user = (body.messages as { content: string }[])[1].content;
    const segments = JSON.parse(user).segments as { id: string; text: string }[];
    return chat(contentFor(segments));
  };
}

function chinese(segments: { id: string }[]) {
  return JSON.stringify({ segments: segments.map(segment => ({ id: segment.id, text: `译${segment.id}` })) });
}

const sample = {
  segments: [{ id: 'body', text: 'The river keeps moving tonight.' }],
  contentType: 'interfaceBatch' as const,
  contextTitle: 'Talk',
  targetLanguage: 'zh' as const,
};

test('defaults match the DeepSeek chat-completions call, and a non-DeepSeek host does not send thinking', async () => {
  const defaults = translationSettingsFromEnv({});
  assert.equal(defaults.apiKey, '');
  assert.equal(defaults.baseUrl, 'https://api.deepseek.com');
  assert.equal(defaults.model, 'deepseek-v4-flash');
  const custom = translationSettingsFromEnv({
    CANVAS_TRANSLATE_API_KEY: ' spaced ',
    CANVAS_TRANSLATE_BASE_URL: ' https://example.test/v1/chat/completions ',
    CANVAS_TRANSLATE_MODEL: ' unit-model ',
  });
  assert.equal(custom.apiKey, 'spaced');
  assert.equal(custom.model, 'unit-model');

  const deepseekCalls: RecordedCall[] = [];
  const deepseek = await translateEnglish(sample, {
    ...translationSettingsFromEnv({ CANVAS_TRANSLATE_API_KEY: KEY }),
    fetch: recorded(deepseekCalls, chinese),
  });
  assert.equal(deepseek.segments[0].text, '译s0');
  assert.equal(deepseekCalls.length, 1);
  assert.equal(deepseekCalls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(deepseekCalls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(deepseekCalls[0].body.temperature, 0.2);
  assert.equal(deepseekCalls[0].body.max_tokens, 1536);
  assert.deepEqual(deepseekCalls[0].body.thinking, { type: 'disabled' });
  assert.deepEqual(deepseekCalls[0].body.response_format, { type: 'json_object' });
  const system = (deepseekCalls[0].body.messages as { content: string }[])[0].content;
  assert.match(system, /chapter titles, summaries, quotes, and saved notes/);
  assert.match(system, /Use 你, never 您/);

  const otherCalls: RecordedCall[] = [];
  await translateEnglish(sample, { ...custom, apiKey: KEY, fetch: recorded(otherCalls, chinese) });
  assert.equal(otherCalls[0].url, 'https://example.test/v1/chat/completions');
  assert.equal(otherCalls[0].body.thinking, undefined);
  assert.equal(otherCalls[0].body.model, 'unit-model');
});

test('prompts keep the transcript and interface instructions', () => {
  const transcript = translationSystemPrompt('transcriptBatch', 'A title');
  assert.match(transcript, /complete spoken thought/);
  assert.match(transcript, /Use 你, never 您/);
  assert.match(translationSystemPrompt('interfaceBatch', 'A title'), /chapter titles, summaries, quotes, and saved notes/);
});

test('five short segments become two sequential calls, and a rate limit stops the rest', async () => {
  const segments = [1, 2, 3, 4, 5].map(index => ({ id: `line-${index}`, text: `Sentence number ${index} stays in English.` }));
  const calls: RecordedCall[] = [];
  const done = await translateEnglish(
    { segments, contentType: 'transcriptBatch', targetLanguage: 'zh' },
    { apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model', fetch: recorded(calls, chinese) },
  );
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse((calls[0].body.messages as { content: string }[])[1].content).segments.length, 3);
  assert.equal(JSON.parse((calls[1].body.messages as { content: string }[])[1].content).segments.length, 2);
  assert.equal(done.segments.filter(segment => segment.text).length, 5);

  let attempts = 0;
  const limited = await translateEnglish(
    { segments, contentType: 'transcriptBatch', targetLanguage: 'zh' },
    {
      apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model',
      fetch: async () => {
        attempts += 1;
        return chat('', 429);
      },
    },
  );
  assert.equal(attempts, 1);
  assert.equal(limited.ok, false);
  assert.match(limited.error, /限流/);
  assert.ok(limited.segments.every(segment => !segment.text && /限流/.test(segment.error)));
});

test('an HTTP 500 continues with the next batch, and an empty JSON body is retried once without response_format', async () => {
  const segments = [1, 2, 3, 4].map(index => ({ id: `line-${index}`, text: `Sentence number ${index} stays in English.` }));
  let attempts = 0;
  const continued = await translateEnglish(
    { segments, contentType: 'transcriptBatch', targetLanguage: 'zh' },
    {
      apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model',
      fetch: async (_url, init) => {
        attempts += 1;
        if (attempts === 1) return { ok: false, status: 500, json: async () => ({ error: { message: 'busy' } }) };
        const body = JSON.parse(init.body) as { messages: { content: string }[] };
        return chat(chinese(JSON.parse(body.messages[1].content).segments));
      },
    },
  );
  assert.equal(attempts, 2);
  assert.equal(continued.ok, true);
  assert.equal(continued.segments.filter(segment => segment.text).length, 1);
  assert.match(continued.error, /500/);

  const formats: unknown[] = [];
  const retried = await translateEnglish(sample, {
    apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model',
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body) as { response_format?: unknown; messages: { content: string }[] };
      formats.push(body.response_format);
      if (formats.length === 1) return chat('   ');
      return chat(chinese(JSON.parse(body.messages[1].content).segments));
    },
  });
  assert.deepEqual(formats, [{ type: 'json_object' }, undefined]);
  assert.equal(retried.segments[0].text, '译s0');
});

test('leading whitespace JSON is accepted, and oversized, idle, and hard-timeout responses fail in Chinese', async () => {
  const loose = await translateEnglish(sample, {
    apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model',
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => `\n\n${JSON.stringify({ choices: [{ message: { content: JSON.stringify({ segments: [{ id: 's0', text: '河边的句子。' }] }) } }] })}`,
    }),
  });
  assert.equal(loose.segments[0].text, '河边的句子。');

  const oversized = await translateEnglish(sample, {
    apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model',
    fetch: async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: new Uint8Array(2 * 1024 * 1024 + 1) };
            },
            async cancel() {},
          };
        },
      },
    }),
  });
  assert.match(oversized.error, /2 MiB/);

  const hang = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
    const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  for (const kind of ['idle', 'hard'] as const) {
    const delays: number[] = [];
    const result = await translateEnglish(sample, {
      apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model',
      fetch: (_url, init) => hang(init.signal),
      timers: {
        setTimeout(callback, delay) {
          delays.push(delay);
          if ((kind === 'idle' && delay === 50_000) || (kind === 'hard' && delay === 120_000)) callback();
          return delay;
        },
        clearTimeout() {},
      },
    });
    assert.deepEqual(delays.slice(0, 2), [120_000, 50_000]);
    assert.match(result.error, kind === 'idle' ? /50 秒/ : /120 秒/);
  }
});

test('a missing key does not call the network, and only Simplified Chinese is accepted', async () => {
  let called = false;
  const missing = await translateEnglish(sample, {
    apiKey: '  ', baseUrl: 'https://example.test', model: 'unit-model',
    fetch: async () => { called = true; throw new Error('called'); },
  });
  assert.equal(called, false);
  assert.match(missing.error, /CANVAS_TRANSLATE_API_KEY/);
  const rejected = await translateEnglish({ ...sample, targetLanguage: 'en' as 'zh' }, {
    apiKey: KEY, baseUrl: 'https://user:pass@example.test', model: 'unit-model',
    fetch: async () => { called = true; throw new Error('called'); },
  });
  assert.equal(called, false);
  assert.match(rejected.error, /只支持译成简体中文/);
  const leaked = await translateEnglish(sample, {
    apiKey: KEY, baseUrl: 'https://user:pass@example.test', model: 'unit-model',
    fetch: async () => { called = true; throw new Error('called'); },
  });
  assert.equal(called, false);
  assert.match(leaked.error, /不要写进地址/);
});

test('rows align by id, and a Latin source of twenty letters or more must come back in Chinese', () => {
  const source = [{ id: 's0', text: 'Hello from the river bank tonight friend' }];
  const missing = normalizeTranslatedSegmentBatch({ segments: [{ id: 'other', text: '中文译文。' }] }, source);
  assert.equal(missing[0].text, '');
  assert.match(missing[0].error, /缺少或不是有效的中文译文/);
  const latin = normalizeTranslatedSegmentBatch({ segments: [{ id: 's0', text: 'Still English without Han characters' }] }, source);
  assert.equal(latin[0].text, '');
  const short = normalizeTranslatedSegmentBatch({ segments: [{ id: 's0', text: 'OK' }] }, [{ id: 's0', text: 'Hello' }]);
  assert.equal(short[0].text, 'OK');
});

test('paragraph breaks are rejoined, and a hard cut is not', async () => {
  const paragraph = `${'Word '.repeat(700)}\n\n${'Tail '.repeat(400)}`;
  const parts = splitTranslationText(paragraph);
  assert.ok(parts.length >= 2);
  assert.equal(parts[1].gapBefore, '\n\n');
  assert.ok(parts.every(part => part.text.length <= 4000));
  const translated = await translateEnglish(
    { segments: [{ id: 'body', text: paragraph }], contentType: 'interfaceBatch', targetLanguage: 'zh' },
    { apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model', fetch: recorded([], chinese) },
  );
  assert.match(translated.segments[0].text, /译s0\n\n译s1/);

  const hard = splitTranslationText('A'.repeat(5000));
  assert.equal(hard[0].text.length, 4000);
  assert.equal(hard[1].gapBefore, '');
  const joined = await translateEnglish(
    { segments: [{ id: 'body', text: 'A'.repeat(5000) }], contentType: 'interfaceBatch', targetLanguage: 'zh' },
    { apiKey: KEY, baseUrl: 'https://example.test', model: 'unit-model', fetch: recorded([], chinese) },
  );
  assert.equal(joined.segments[0].text, hard.map((_part, index) => `译s${index}`).join(''));
  assert.equal(joined.segments[0].text.includes('\n'), false);
});

test('English notes, excerpts, drafts, and transcript lines share one surface, and a changed source is left alone', () => {
  const english = 'The river keeps moving tonight.';
  const note: CardData = { kind: 'note', title: '笔记', body: english };
  const job = surfaceTranslation(note, 'note');
  assert.equal(job?.contentType, 'interfaceBatch');
  assert.deepEqual(job?.segments, [{ id: 'body', text: english }]);
  assert.equal(surfaceTranslation({ ...note, body: '河水还在走。' }, 'note'), null);
  assert.equal(surfaceTranslation({ kind: 'link', title: '链接', body: english }, 'note'), null);
  assert.equal(surfaceTranslation({ kind: 'quote', title: '摘录', body: english }, 'note'), null);
  const quote: CardData = { kind: 'quote', title: '摘录', body: '', citation: { nodeId: 's', title: 'Talk', text: english } };
  assert.equal(surfaceTranslation(quote, 'excerpt')?.segments[0].id, 'excerpt');
  assert.equal(surfaceTranslation({ kind: 'draft', title: '文稿', body: english }, 'draft')?.segments[0].id, 'body');
  const video: CardData = {
    kind: 'video', title: 'Talk', body: '',
    transcript: [
      { id: 'a', start: 1, end: 2, text: english, translation: '已有译文。' },
      { id: 'b', start: 2, end: 3, text: 'The bank is quiet tonight.' },
      { id: 'c', start: 3, end: 4, text: '第一句中文。' },
    ],
  };
  const transcript = surfaceTranslation(video, 'transcript');
  assert.equal(transcript?.contentType, 'transcriptBatch');
  assert.deepEqual(transcript?.translatedIds, ['a']);
  assert.deepEqual(transcript?.segments.map(segment => segment.id), ['a', 'b']);
  assert.equal(surfaceTranslation({ ...video, transcript: [{ id: 'c', start: 0, end: 1, text: '第一句中文。' }] }, 'transcript'), null);

  assert.equal(applySurfaceTranslation(note, 'note', [{ id: 'body', text: '过期。', source: 'A different English sentence here.' }]), null);
  assert.deepEqual(applySurfaceTranslation(note, 'note', [{ id: 'body', text: '河水今夜还在走。', source: english }]), { translation: '河水今夜还在走。' });
  const edited = cardDataAfterEdit({ ...note, translation: '河水今夜还在走。' }, { body: 'The hill keeps moving tonight.' });
  assert.equal(edited.translation, undefined);
  const understanding = cardDataAfterEdit({ ...quote, translation: '河水今夜还在走。' }, { body: '我的理解' });
  assert.equal(understanding.translation, '河水今夜还在走。');
  const sourceChanged = cardDataAfterEdit({ ...quote, translation: '河水今夜还在走。' }, { citation: { ...quote.citation!, text: 'The hill keeps moving tonight.' } });
  assert.equal(sourceChanged.translation, undefined);
});

test('stored translations stay on the same card and line, and editing the sentence drops the old Chinese', async () => {
  const board = createBoard('blank');
  const note = createNode('note');
  note.data.body = 'The river keeps moving tonight.';
  note.data.translation = '河水今夜还在走。';
  const video = createNode('video');
  video.data.transcript = [{ id: 'line-1', start: 1.5, end: 3, text: 'Hello from the river bank.', translation: '河边问候。' }];
  board.nodes = [note, video];
  assert.equal(validateBoard(board).nodes[0].data.translation, '河水今夜还在走。');
  assert.equal(validateBoard(board).nodes[1].data.transcript?.[0].translation, '河边问候。');
  const restored = await importBoard(new File([await exportBoard(board)], 'translated.json'));
  assert.equal(restored.nodes.find(node => node.data.kind === 'note')?.data.translation, '河水今夜还在走。');
  assert.equal(restored.nodes.find(node => node.data.kind === 'video')?.data.transcript?.[0].translation, '河边问候。');
  note.data.translation = '   ';
  assert.throws(() => validateBoard(board), /译文/);

  const edited = editTranscriptLine(video.data, 'line-1', 'Hello from the hill.');
  assert.equal(Object.hasOwn(edited.transcript![0], 'translation'), false);
  assert.ok(edited.transcriptRevision);
  const restoredLine = restoreTranscriptLine({ ...video.data, transcript: [{ id: 'line-1', start: 1.5, end: 3, text: 'Hello from the hill.', originalText: 'Hello from the river bank.', translation: '山坡。' }] }, 'line-1');
  assert.equal(restoredLine.transcript?.[0].text, 'Hello from the river bank.');
  assert.equal(Object.hasOwn(restoredLine.transcript![0], 'translation'), false);

  const quoted = createNode('quote');
  quoted.data.body = '我的理解在这里。';
  quoted.data.translation = '河水今夜还在走。';
  quoted.data.citation = { nodeId: video.id, title: video.data.title, text: 'The river keeps moving tonight.' };
  const withTranslation = exportMarkdown({ ...board, nodes: [quoted, video] });
  assert.match(withTranslation, /译文：河水今夜还在走。/);
  assert.match(withTranslation, /我的理解：我的理解在这里。/);
  assert.match(withTranslation, /译文：河边问候。/);
  delete quoted.data.translation;
  delete video.data.transcript![0].translation;
  assert.equal(exportMarkdown({ ...board, nodes: [quoted, video] }).includes('译文：'), false);
});

test('transcript translations are searchable at the sentence time, and a card translation is not indexed as its body', () => {
  const video: BoardNode = {
    id: 'video', type: 'card', position: { x: 0, y: 0 },
    data: { kind: 'video', title: 'Talk', body: '', transcript: [{ id: 'line-1', start: 12.5, end: 14, text: 'The river keeps moving tonight.', translation: '今夜河水还在走。' }] },
  };
  const note: BoardNode = {
    id: 'note', type: 'card', position: { x: 0, y: 40 },
    data: { kind: 'note', title: '笔记', body: 'The river keeps moving tonight.', translation: '卡片上的译文不会进正文索引。' },
  };
  const canvas: Board = {
    id: 'board', title: '画布', description: '', category: 'writing', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
    nodes: [video, note], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  };
  const workspace: Workspace = { schema: 1, activeBoardId: canvas.id, boards: [canvas] };
  const hits = searchWorkspace(createWorkspaceSearchIndex(workspace), '今夜河水', { scope: 'board', boardId: canvas.id });
  assert.equal(hits.total, 1);
  assert.equal(hits.hits[0].field, 'transcript');
  assert.equal(hits.hits[0].time, 12.5);
  assert.equal(searchWorkspace(createWorkspaceSearchIndex(workspace), '卡片上的译文', { scope: 'board', boardId: canvas.id }).total, 0);
});

test('an English excerpt offers 译成中文, and a Chinese excerpt does not', () => {
  const actions = { nodes: [], focusSource() {}, draftReturn: null, readOnly: false, updateCard: () => true } as unknown as BoardActions;
  const render = (text: string) => renderToStaticMarkup(createElement(
    BoardContext.Provider,
    { value: actions },
    createElement(QuoteCitationPanel, {
      nodeId: 'quote-1',
      rememberVisit() {},
      data: { kind: 'quote', title: '摘录', body: '', citation: { nodeId: 'source', title: 'Talk', text } },
    }),
  ));
  const english = render('The river keeps its own time.');
  assert.match(english, /译成中文/);
  assert.match(english, /需在桌面版配置密钥/);
  assert.equal(render('当时的原文').includes('译成中文'), false);
});

/**
 * English-to-Chinese translation for excerpts, notes, drafts, and transcripts.
 *
 * This is the only translation call in 来处. Prompt text, batching, the DeepSeek
 * chat-completions request, and failure handling are adapted from youtube-digest
 * by Zara Zhang (MIT License):
 * https://github.com/zarazhangrui/youtube-digest
 *
 * Copyright (c) 2026 Zara Zhang
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * The adaptation in this repository is also covered by the project's MIT license,
 * Copyright (c) 2026 YUNYE FLOW.
 */
import type { CardData } from './model';

export const TRANSLATION_LINE_MAX = 40_000;
export const TRANSLATION_TEXT_MAX = 300_000;
const SEGMENT_MAX = 4_000;
const BATCH_MAX = 12_000;
const BATCH_SIZE = 3;
const MAX_SEGMENTS = 10_000;
const MAX_SOURCE_CHARS = 1_000_000;
const IDLE_TIMEOUT_MS = 50_000;
const HARD_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';

export type TranslationContentType = 'transcriptBatch' | 'interfaceBatch';
export type TranslationSurface = 'transcript' | 'excerpt' | 'note' | 'draft';

export interface TranslationSegment { id: string; text: string }
export interface EnglishTranslationRequest {
  segments: TranslationSegment[];
  contentType: TranslationContentType;
  contextTitle?: string;
  /** Only Simplified Chinese is supported. Any other value is rejected. */
  targetLanguage?: 'zh';
}
export interface EnglishTranslationSegment { id: string; text: string; error: string }
export interface EnglishTranslationResult {
  ok: boolean;
  segments: EnglishTranslationSegment[];
  error: string;
}
export interface TranslationUpdate { id: string; text: string; source: string }
export interface SurfaceTranslation {
  surface: TranslationSurface;
  contentType: TranslationContentType;
  contextTitle: string;
  segments: TranslationSegment[];
  translatedIds: string[];
  maxLength: number;
}
export interface TranslationSettings { apiKey: string; baseUrl: string; model: string }

interface Piece { key: string; parentId: string; text: string; gapBefore: '' | '\n\n' }
interface FetchResponse {
  ok: boolean;
  status: number;
  body?: { getReader?: () => Reader } | null;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}
interface Reader {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  cancel?: () => Promise<void>;
}
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<FetchResponse>;
interface TimerControl {
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (id: unknown) => void;
}
export interface TranslationClientOptions extends TranslationSettings {
  fetch?: FetchLike;
  signal?: AbortSignal;
  timers?: TimerControl;
}

class TranslationFailure extends Error {
  code: string;
  status?: number;
  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = 'TranslationFailure';
    this.code = code;
    this.status = status;
  }
}

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;

/** Same 10% CJK threshold the cards use for Latin type, plus enough letters to be a phrase. */
export function englishSourceText(text: string | undefined): boolean {
  if (!text) return false;
  const compact = text.replace(/\s/g, '');
  if (!compact) return false;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (latin < 4) return false;
  return (compact.match(CJK)?.length ?? 0) / compact.length < 0.1;
}

function surfaceText(data: CardData, surface: TranslationSurface): string {
  if (surface === 'excerpt' && data.kind === 'quote') return (data.citation?.text ?? data.body).trim();
  if (surface === 'note' && data.kind === 'note') return data.body.trim();
  if (surface === 'draft' && data.kind === 'draft') return data.body.trim();
  return '';
}

/**
 * The English that can be translated on one existing card. Returns nothing for
 * Chinese text, for other card kinds, and for an empty transcript.
 */
export function surfaceTranslation(data: CardData, surface: TranslationSurface): SurfaceTranslation | null {
  if (surface === 'transcript') {
    const lines = (data.transcript ?? []).filter(line => englishSourceText(line.text));
    if (!lines.length) return null;
    return {
      surface,
      contentType: 'transcriptBatch',
      contextTitle: data.title,
      segments: lines.map(line => ({ id: line.id, text: line.text.trim() })),
      translatedIds: lines.filter(line => line.translation?.trim()).map(line => line.id),
      maxLength: TRANSLATION_LINE_MAX,
    };
  }
  const text = surfaceText(data, surface);
  if (!englishSourceText(text)) return null;
  const id = surface === 'excerpt' ? 'excerpt' : 'body';
  return {
    surface,
    contentType: 'interfaceBatch',
    contextTitle: surface === 'excerpt' ? (data.citation?.title || data.title) : data.title,
    segments: [{ id, text }],
    translatedIds: data.translation?.trim() ? [id] : [],
    maxLength: TRANSLATION_TEXT_MAX,
  };
}

/** Write Chinese back onto the same card or transcript line. A changed source is left alone. */
export function applySurfaceTranslation(data: CardData, surface: TranslationSurface, updates: readonly TranslationUpdate[]): Partial<CardData> | null {
  const limit = surface === 'transcript' ? TRANSLATION_LINE_MAX : TRANSLATION_TEXT_MAX;
  const accepted = updates.filter(item => item.text.trim() && item.text.length <= limit);
  if (!accepted.length) return null;
  if (surface === 'transcript') {
    if (!data.transcript?.length) return null;
    let changed = false;
    const transcript = data.transcript.map(line => {
      const update = accepted.find(item => item.id === line.id && item.source === line.text.trim());
      if (!update || update.text === line.translation) return line;
      changed = true;
      return { ...line, translation: update.text };
    });
    return changed ? { transcript } : null;
  }
  const source = surfaceText(data, surface);
  const id = surface === 'excerpt' ? 'excerpt' : 'body';
  const update = accepted.find(item => item.id === id && item.source === source);
  if (!update || update.text === data.translation) return null;
  return { translation: update.text };
}

/** Drop a stored translation when the English it came from is edited. */
export function cardDataAfterEdit(previous: CardData, patch: Partial<CardData>): CardData {
  const data: CardData = { ...previous, ...patch };
  if (Object.hasOwn(patch, 'translation')) {
    if (!patch.translation?.trim()) delete data.translation;
    return data;
  }
  const bodyChanged = patch.body !== undefined && patch.body !== previous.body;
  const quoteSourceChanged = previous.kind === 'quote'
    && patch.citation !== undefined
    && (patch.citation.text ?? '') !== (previous.citation?.text ?? '');
  if ((bodyChanged && previous.kind !== 'quote') || quoteSourceChanged) delete data.translation;
  return data;
}

export function translationSettingsFromEnv(env: Record<string, string | undefined>): TranslationSettings {
  return {
    apiKey: (env.CANVAS_TRANSLATE_API_KEY ?? '').trim(),
    baseUrl: (env.CANVAS_TRANSLATE_BASE_URL ?? '').trim() || DEFAULT_BASE_URL,
    model: (env.CANVAS_TRANSLATE_MODEL ?? '').trim() || DEFAULT_MODEL,
  };
}

const SHARED_BASE = `TRANSLATION RULES (follow strictly):
- Match the EXACT tone and register of the original (casual stays casual, formal stays formal)
- Use natural {langName} sentence structures — NOT English syntax translated word-by-word
- Do NOT translate: proper nouns, brand names, technical terms commonly kept in English (API, AI, etc.), timestamps
- Preserve ALL formatting: paragraph breaks, bullet points, markdown, timestamps
{langSpecific}`;

const CHINESE_RULES = `- Use modern colloquial Simplified Chinese (简体中文). Avoid stiff 书面语 unless the original is formal.
- Use natural Chinese sentence structures — do NOT mirror English syntax.
- Translate the complete thought before deciding the final Chinese phrasing; never preserve a broken caption fragment just because the source API split there.
- Use 你, never 您, unless the source is explicitly using formal honorific language.
- Write for a smart tech/product audience. Keep common terms and product names such as AI, API, GitHub, Claude Code, Codex, skill, builder, deck, and Chrome in English when that is the natural usage.
- Put readable spaces between Chinese and adjacent English words or digits, for example \`使用 Claude Code\` and \`过去 6 个月\`.
- Remove empty spoken fillers rather than translating them literally, while preserving real uncertainty or emphasis.`;

const TRANSCRIPT_PROMPT = `You are a professional translator. Translate the transcript segments into {langName}.
The video is titled "{videoTitle}". Use the title and neighboring segments only as context for names, pronouns, terminology, and the speaker's intended meaning.

{baseRules}

- Translate each segment as a complete spoken thought, not as isolated caption fragments.
- Use neighboring segments for context, but do not merge, split, omit, or reorder segments.
- Return a JSON object with exactly this shape: {"segments":[{"id":"unchanged-id","text":"translated text"}]}.
- Copy every input id exactly. Translate only text values.
- Output only valid JSON. No markdown fences, commentary, labels, or extra keys.`;

const INTERFACE_PROMPT = `You are a professional translator. Translate the interface content into {langName}.
The related video is titled "{videoTitle}". Use the title and neighboring segments only as context for names, pronouns, terminology, and intended meaning.

{baseRules}

- Preserve the meaning and tone of chapter titles, summaries, quotes, and saved notes.
- Do not add explanations, labels, or facts that are not in the source.
- Do not merge, split, omit, or reorder segments.
- Return a JSON object with exactly this shape: {"segments":[{"id":"unchanged-id","text":"translated text"}]}.
- Copy every input id exactly. Translate only text values.
- Output only valid JSON. No markdown fences, commentary, labels, or extra keys.`;

function fill(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(langName|langSpecific|baseRules|videoTitle)\}/g, (whole, key: string) => variables[key] ?? whole);
}

function contextTitle(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  const clean = text.replace(/[\r\n"]/g, ' ').replace(/[{}]/g, '').trim();
  return (clean || '未命名').slice(0, 500);
}

export function translationSystemPrompt(contentType: TranslationContentType, title: string): string {
  const langName = 'Simplified Chinese';
  const baseRules = fill(SHARED_BASE, { langName, langSpecific: CHINESE_RULES });
  return fill(contentType === 'transcriptBatch' ? TRANSCRIPT_PROMPT : INTERFACE_PROMPT, {
    langName,
    videoTitle: contextTitle(title),
    baseRules,
  });
}

function failed(segments: readonly TranslationSegment[], error: string): EnglishTranslationResult {
  return { ok: false, error, segments: segments.map(segment => ({ id: segment.id, text: '', error })) };
}

function readRequest(input: unknown): EnglishTranslationRequest | EnglishTranslationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failed([], '翻译请求格式不正确。');
  const raw = input as Record<string, unknown>;
  if (raw.targetLanguage !== undefined && raw.targetLanguage !== 'zh') return failed([], '只支持译成简体中文。');
  if (raw.contentType !== 'transcriptBatch' && raw.contentType !== 'interfaceBatch') return failed([], '不支持的翻译内容。');
  if (!Array.isArray(raw.segments) || raw.segments.length < 1 || raw.segments.length > MAX_SEGMENTS) return failed([], '翻译内容为空或过长。');
  const seen = new Set<string>();
  let total = 0;
  const segments: TranslationSegment[] = [];
  for (const item of raw.segments) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return failed([], '翻译内容格式不正确。');
    const id = (item as { id?: unknown }).id;
    const text = (item as { text?: unknown }).text;
    if (typeof id !== 'string' || !id.trim() || id.length > 160 || id.includes('\u0000') || seen.has(id)) return failed([], '翻译段落的标识为空、重复或过长。');
    if (typeof text !== 'string' || !text.trim() || text.length > TRANSLATION_TEXT_MAX || text.includes('\u0000')) return failed([], '有一段文字为空、过长或格式不正确。');
    seen.add(id);
    total += text.length;
    if (total > MAX_SOURCE_CHARS) return failed([], '翻译内容过长，无法一次翻译。');
    segments.push({ id, text: text.trim() });
  }
  return { segments, contentType: raw.contentType, contextTitle: contextTitle(raw.contextTitle) };
}

/** Split one long passage. Paragraph breaks win, then sentence punctuation, then the caption splitter's comma and space cuts. */
export function splitTranslationText(text: string, max = SEGMENT_MAX): { text: string; gapBefore: '' | '\n\n' }[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  if (cleaned.length <= max) return [{ text: cleaned, gapBefore: '' }];
  const pieces: { text: string; gapBefore: '' | '\n\n' }[] = [];
  let rest = cleaned;
  let gap: '' | '\n\n' = '';
  const patterns: { pattern: RegExp; paragraph: boolean }[] = [
    { pattern: /\n\n+/g, paragraph: true },
    { pattern: /[.!?。！？]["')\]”’）】」』]*\s*/g, paragraph: false },
    { pattern: /[;:；：]\s*/g, paragraph: false },
    { pattern: /[,，]\s*/g, paragraph: false },
    { pattern: /\s/g, paragraph: false },
  ];
  while (rest.length > max) {
    const windowText = rest.slice(0, max + 1);
    const lowerBound = Math.floor(max * 0.55);
    let cut = -1;
    let paragraph = false;
    for (const candidate of patterns) {
      candidate.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      let found = -1;
      while ((match = candidate.pattern.exec(windowText))) {
        if (match.index >= lowerBound) found = match.index + match[0].length;
      }
      if (found > 0) {
        cut = found;
        paragraph = candidate.paragraph;
        break;
      }
    }
    const bounded = Math.min(cut > 0 ? cut : max, max);
    const head = rest.slice(0, bounded).trim();
    const tail = rest.slice(bounded).trim();
    if (!head || tail.length >= rest.length) {
      pieces.push({ text: rest.slice(0, max), gapBefore: gap });
      rest = rest.slice(max).trim();
      gap = '';
      continue;
    }
    pieces.push({ text: head, gapBefore: gap });
    gap = paragraph && bounded === cut ? '\n\n' : '';
    rest = tail;
  }
  if (rest) pieces.push({ text: rest, gapBefore: gap });
  return pieces;
}

function explode(segments: readonly TranslationSegment[]): Piece[] {
  const pieces: Piece[] = [];
  for (const segment of segments) {
    for (const slice of splitTranslationText(segment.text)) {
      if (slice.text.length > SEGMENT_MAX) throw new TranslationFailure('翻译分块不正确。', 'CHUNK');
      pieces.push({ key: `p${pieces.length}`, parentId: segment.id, text: slice.text, gapBefore: slice.gapBefore });
    }
  }
  return pieces;
}

function pack(pieces: readonly Piece[]): Piece[][] {
  const batches: Piece[][] = [];
  let current: Piece[] = [];
  let chars = 0;
  for (const piece of pieces) {
    if (current.length === BATCH_SIZE || (current.length > 0 && chars + piece.text.length > BATCH_MAX)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(piece);
    chars += piece.text.length;
  }
  if (current.length) batches.push(current);
  if (batches.some(batch => batch.length < 1 || batch.length > 4)) throw new TranslationFailure('翻译分块不正确。', 'CHUNK');
  return batches;
}

function looksLikeChineseTranslation(text: string, sourceText: string): boolean {
  const latinLetters = (sourceText.match(/[A-Za-z]/g) || []).length;
  if (latinLetters < 20) return true;
  return /[\u3400-\u9fff]/.test(text);
}

function parseLooseJson(text: string): unknown {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(cleaned.replace(/,(\s*[}\]])/g, '$1'));
  }
}

/** Align by the id we sent. Missing, duplicate, or non-Chinese rows stay explicit errors. */
export function normalizeTranslatedSegmentBatch(parsed: unknown, sourceSegments: readonly TranslationSegment[]): EnglishTranslationSegment[] {
  const candidates = parsed && typeof parsed === 'object' && Array.isArray((parsed as { segments?: unknown }).segments)
    ? (parsed as { segments: unknown[] }).segments
    : [];
  const sourceById = new Map(sourceSegments.map(segment => [segment.id, segment]));
  const translatedById = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const id = (candidate as { id?: unknown }).id;
    const text = (candidate as { text?: unknown }).text;
    if (typeof id !== 'string' || typeof text !== 'string' || !sourceById.has(id) || translatedById.has(id)) continue;
    const trimmed = text.trim();
    const source = sourceById.get(id);
    if (source && trimmed && looksLikeChineseTranslation(trimmed, source.text)) translatedById.set(id, trimmed);
  }
  return sourceSegments.map(source => ({
    id: source.id,
    text: translatedById.get(source.id) || '',
    error: translatedById.has(source.id) ? '' : '缺少或不是有效的中文译文。',
  }));
}

function chatCompletionsUrl(baseUrl: string): string {
  let url: URL;
  try { url = new URL(baseUrl); }
  catch { throw new TranslationFailure('翻译接口地址不正确。请检查 CANVAS_TRANSLATE_BASE_URL。', 'BAD_URL'); }
  if (url.username || url.password) throw new TranslationFailure('请把密钥放在 CANVAS_TRANSLATE_API_KEY，不要写进地址。', 'BAD_URL');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TranslationFailure('翻译接口只支持 HTTP 或 HTTPS。', 'BAD_URL');
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) url.pathname = `${path}/chat/completions`;
  url.hash = '';
  return url.toString();
}

function usesDeepSeek(endpoint: string, model: string): boolean {
  const host = new URL(endpoint).hostname;
  return host === 'api.deepseek.com' || host.endsWith('.deepseek.com') || model.toLowerCase().startsWith('deepseek');
}

async function readBounded(response: FetchResponse, onActivity: () => void): Promise<unknown> {
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let responseText = '';
    let responseBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      responseBytes += value?.byteLength ?? 0;
      if (responseBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel?.().catch(() => {});
        throw new TranslationFailure('翻译结果超过 2 MiB，已停止读取。', 'AI_RESPONSE_TOO_LARGE');
      }
      if (value) responseText += decoder.decode(value, { stream: true });
    }
    responseText += decoder.decode();
    try { return JSON.parse(responseText.trimStart()); }
    catch { throw new TranslationFailure('翻译接口返回的内容无法读取。', 'PARSE'); }
  }
  if (typeof response.text === 'function') {
    const responseText = await response.text();
    onActivity();
    if (new TextEncoder().encode(responseText).byteLength > MAX_RESPONSE_BYTES) {
      throw new TranslationFailure('翻译结果超过 2 MiB，已停止读取。', 'AI_RESPONSE_TOO_LARGE');
    }
    try { return JSON.parse(responseText.trimStart()); }
    catch { throw new TranslationFailure('翻译接口返回的内容无法读取。', 'PARSE'); }
  }
  if (typeof response.json === 'function') {
    const data = await response.json();
    onActivity();
    return data;
  }
  throw new TranslationFailure('翻译接口返回的内容无法读取。', 'PARSE');
}

async function requestAiCompletion(options: TranslationClientOptions & { endpoint: string }, messages: { role: string; content: string }[], temperature: number, responseFormat?: { type: 'json_object' }): Promise<string> {
  const controller = new AbortController();
  const outer = options.signal;
  const onOuter = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', onOuter, { once: true });
  let timeoutKind = '';
  const schedule = options.timers?.setTimeout ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const cancel = options.timers?.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let idleId: unknown;
  let hardId: unknown;
  const abortFor = (kind: 'idle' | 'hard') => {
    if (controller.signal.aborted) return;
    timeoutKind = kind;
    controller.abort();
  };
  const resetIdle = () => {
    if (idleId !== undefined) cancel(idleId);
    idleId = schedule(() => abortFor('idle'), IDLE_TIMEOUT_MS);
  };
  hardId = schedule(() => abortFor('hard'), HARD_TIMEOUT_MS);
  resetIdle();
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: 1536,
    temperature,
    messages,
  };
  if (responseFormat) body.response_format = responseFormat;
  if (usesDeepSeek(options.endpoint, options.model)) body.thinking = { type: 'disabled' };
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    resetIdle();
    let data: unknown;
    try {
      data = await readBounded(response, resetIdle);
    } catch (error) {
      if (!response.ok && error instanceof TranslationFailure && error.code === 'PARSE') {
        throw new TranslationFailure(`翻译接口返回错误（${response.status}）。`, response.status === 429 ? 'RATE_LIMITED' : response.status === 401 || response.status === 403 ? 'UNAUTHORIZED' : 'HTTP', response.status);
      }
      throw error;
    }
    if (!response.ok) {
      const record = data && typeof data === 'object' ? data as { error?: { message?: string }; message?: string } : {};
      const detail = (record.error?.message || record.message || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (response.status === 429) throw new TranslationFailure('翻译接口暂时限流，请稍后再试。', 'RATE_LIMITED', 429);
      if (response.status === 401 || response.status === 403) throw new TranslationFailure('翻译接口拒绝了密钥或没有权限。', 'UNAUTHORIZED', response.status);
      throw new TranslationFailure(detail ? `翻译接口返回错误（${response.status}）：${detail}` : `翻译接口返回错误（${response.status}）。`, 'HTTP', response.status);
    }
    const content = data && typeof data === 'object'
      ? (data as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content
      : undefined;
    if (typeof content !== 'string' || !content.trim()) throw new TranslationFailure('翻译接口返回了空内容。', 'EMPTY_AI_RESPONSE');
    return content;
  } catch (error) {
    if (timeoutKind === 'idle') throw new TranslationFailure('翻译接口 50 秒内没有返回数据，请重试。', 'AI_IDLE_TIMEOUT');
    if (timeoutKind === 'hard') throw new TranslationFailure('翻译超过 120 秒，请重试。', 'AI_HARD_TIMEOUT');
    if (outer?.aborted) throw new TranslationFailure('翻译已取消。', 'ABORTED');
    if (error instanceof TranslationFailure) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new TranslationFailure('翻译已取消。', 'ABORTED');
    const message = error instanceof Error ? error.message : '翻译请求失败。';
    throw new TranslationFailure(message.startsWith('翻译') ? message : `翻译请求失败：${message}`, 'NETWORK');
  } finally {
    if (idleId !== undefined) cancel(idleId);
    if (hardId !== undefined) cancel(hardId);
    outer?.removeEventListener('abort', onOuter);
  }
}

const FATAL = new Set(['NO_AI_KEY', 'RATE_LIMITED', 'AI_IDLE_TIMEOUT', 'AI_HARD_TIMEOUT', 'AI_RESPONSE_TOO_LARGE', 'UNAUTHORIZED', 'ABORTED', 'BAD_URL', 'NETWORK']);

async function translateBatch(pieces: readonly Piece[], contentType: TranslationContentType, title: string, options: TranslationClientOptions & { endpoint: string }): Promise<{ ok: true; byKey: Map<string, { text: string; error: string }> } | { ok: false; error: string; code: string }> {
  const local = pieces.map((piece, index) => ({ localId: `s${index}`, piece }));
  const source = local.map(item => ({ id: item.localId, text: item.piece.text }));
  const system = translationSystemPrompt(contentType, title);
  const user = JSON.stringify({ segments: source });
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  let completion: { ok: true; text: string } | { ok: false; error: string; code: string };
  try {
    completion = { ok: true, text: await requestAiCompletion(options, messages, 0.2, { type: 'json_object' }) };
  } catch (error) {
    completion = error instanceof TranslationFailure
      ? { ok: false, error: error.message, code: error.code }
      : { ok: false, error: '翻译失败。', code: 'FAILED' };
  }
  if (!completion.ok && completion.code === 'EMPTY_AI_RESPONSE') {
    try {
      completion = { ok: true, text: await requestAiCompletion(options, messages, 0.2) };
    } catch (error) {
      completion = error instanceof TranslationFailure
        ? { ok: false, error: error.message, code: error.code }
        : { ok: false, error: '翻译失败。', code: 'FAILED' };
    }
  }
  if (!completion.ok) return completion;
  let parsed: unknown;
  try { parsed = parseLooseJson(completion.text); }
  catch { return { ok: false, error: '译文不是有效的 JSON。', code: 'PARSE' }; }
  const aligned = normalizeTranslatedSegmentBatch(parsed, source);
  if (!aligned.some(segment => segment.text)) return { ok: false, error: '没有得到可用的中文译文。', code: 'NO_CHINESE' };
  const byKey = new Map<string, { text: string; error: string }>();
  aligned.forEach((segment, index) => byKey.set(local[index].piece.key, { text: segment.text, error: segment.error }));
  return { ok: true, byKey };
}

function rejoin(segments: readonly TranslationSegment[], pieces: readonly Piece[], results: ReadonlyMap<string, { text: string; error: string }>, fallback: string): EnglishTranslationSegment[] {
  return segments.map(segment => {
    const own = pieces.filter(piece => piece.parentId === segment.id);
    let text = '';
    for (const piece of own) {
      const result = results.get(piece.key);
      if (!result?.text) return { id: segment.id, text: '', error: result?.error || fallback || '缺少或不是有效的中文译文。' };
      text += text && piece.gapBefore ? piece.gapBefore : '';
      text += result.text;
    }
    return text ? { id: segment.id, text, error: '' } : { id: segment.id, text: '', error: fallback || '缺少或不是有效的中文译文。' };
  });
}

/**
 * Translate English into Simplified Chinese.
 * Batches are at most three segments, each at most 4,000 characters and 12,000
 * characters together. An empty JSON response is retried once without
 * `response_format`. Rows are aligned by id. A failed batch does not borrow a
 * neighbour's text.
 */
export async function translateEnglish(input: unknown, options: TranslationClientOptions): Promise<EnglishTranslationResult> {
  const request = readRequest(input);
  if ('ok' in request) return request;
  if (!options.apiKey.trim()) return failed(request.segments, '未配置翻译接口密钥。请在启动前设置环境变量 CANVAS_TRANSLATE_API_KEY。');
  const model = options.model.trim() || DEFAULT_MODEL;
  const baseUrl = options.baseUrl.trim() || DEFAULT_BASE_URL;
  let endpoint = '';
  try { endpoint = chatCompletionsUrl(baseUrl); }
  catch (error) { return failed(request.segments, error instanceof TranslationFailure ? error.message : '翻译接口地址不正确。'); }
  let pieces: Piece[] = [];
  let batches: Piece[][] = [];
  try {
    pieces = explode(request.segments);
    batches = pack(pieces);
  } catch (error) {
    return failed(request.segments, error instanceof Error ? error.message : '翻译分块不正确。');
  }
  const client: TranslationClientOptions & { endpoint: string } = { ...options, model, baseUrl, endpoint };
  const results = new Map<string, { text: string; error: string }>();
  let fatal = '';
  for (const batch of batches) {
    if (options.signal?.aborted) {
      fatal = '翻译已取消。';
      for (const piece of batch) results.set(piece.key, { text: '', error: fatal });
      break;
    }
    const outcome = await translateBatch(batch, request.contentType, request.contextTitle || '未命名', client);
    if (!outcome.ok) {
      for (const piece of batch) results.set(piece.key, { text: '', error: outcome.error });
      if (FATAL.has(outcome.code)) {
        fatal = outcome.error;
        break;
      }
      continue;
    }
    for (const [key, value] of outcome.byKey) results.set(key, value);
  }
  if (fatal) {
    for (const piece of pieces) if (!results.has(piece.key)) results.set(piece.key, { text: '', error: fatal });
  }
  const segments = rejoin(request.segments, pieces, results, fatal);
  const ok = segments.some(segment => segment.text);
  const firstError = segments.find(segment => segment.error)?.error || fatal;
  return {
    ok,
    segments,
    error: ok ? (segments.some(segment => segment.error) ? firstError : '') : (firstError || '没有得到可用的中文译文。'),
  };
}

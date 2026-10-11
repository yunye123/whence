import { createNode } from './board-utils';
import { getCardBounds, placeCards, type CardMeasurements } from './card-placement';
import { uid, type Board, type BoardNode } from './model';
import { STORAGE_LIMITS, validateBoard } from './storage';
import { createTextAnchor, normalizeTextBody, splitsTextCharacter } from './text-anchor';

export const TEXT_SOURCE_LIMITS = { bytes: 1024 * 1024, characters: 100_000, quoteCharacters: 20_000 } as const;

/** Windows may supply an empty or generic MIME type for both of these extensions. */
export function isTextSourceFile(file: { name: string; type?: string }): boolean {
  return !!file && typeof file.name === 'string' && /\.(txt|md)$/i.test(file.name);
}

function shortTitle(value: string): string {
  const title = value.slice(0, 120);
  // A filename ending at this limit must not leave half of an emoji in the title.
  return /[\uD800-\uDBFF]$/.test(title) ? title.slice(0, -1) : title;
}

export type TextSourceEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';
const UNREADABLE_TEXT = '这个文字文件里有无法识别的字符，可能已损坏或不是文字文件。可以用记事本打开它，“另存为”一份新的 TXT 再导入';

/**
 * UTF-8 (one leading BOM removed), UTF-16 with a BOM, or GB18030/GBK: older Chinese TXT files and Word's plain-text
 * export on Chinese Windows are GBK (W-M2). A UTF-8 file that is merely damaged (most of its multi-byte characters
 * still decode) is reported instead of being read as GBK garbage.
 */
function decodeTextBytes(bytes: Uint8Array): { body: string; encoding: TextSourceEncoding } {
  const decode = (encoding: TextSourceEncoding, data: Uint8Array) => new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(data);
  const utf16: TextSourceEncoding | null = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  try {
    if (utf16) return { body: decode(utf16, bytes.subarray(2)), encoding: utf16 };
    return { body: decode('utf-8', bytes).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch { if (utf16) throw new Error(UNREADABLE_TEXT); }
  const loose = new TextDecoder('utf-8').decode(bytes);
  const damaged = (loose.match(/�/g) ?? []).length;
  const readable = (loose.match(/[^\u0000-\u007F�]/g) ?? []).length;
  if (readable > damaged) throw new Error(UNREADABLE_TEXT);
  try { return { body: decode('gb18030', bytes), encoding: 'gb18030' }; } catch { throw new Error(UNREADABLE_TEXT); }
}

/** Decode once and preserve the text exactly, except for one leading BOM. `encoding` is set only when it was not UTF-8. */
export async function readTextSource(file: File): Promise<{ title: string; body: string; tags: string[]; encoding?: Exclude<TextSourceEncoding, 'utf-8'> }> {
  if (!isTextSourceFile(file)) throw new Error('请选择 TXT 或 Markdown（.md）文字文件');
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > TEXT_SOURCE_LIMITS.bytes) throw new Error('文字文件最大为 1 MB，请分段后导入');
  if (file.name.includes('\u0000')) throw new Error('文字文件名包含无效字符，请重命名后导入');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > TEXT_SOURCE_LIMITS.bytes) throw new Error('文字文件最大为 1 MB，请分段后导入');
  const { body, encoding } = decodeTextBytes(bytes);
  if (body.includes('\u0000')) throw new Error('文字文件包含无效的空字符，请检查文件内容');
  if (!body.trim()) throw new Error('文字文件没有可导入的正文');
  if (body.length > TEXT_SOURCE_LIMITS.characters) throw new Error('文字正文最多支持 100,000 个字符，请分段后导入');
  return {
    title: shortTitle(file.name.replace(/\.(txt|md)$/i, '')) || '文字资料',
    body,
    tags: ['文字资料', /\.md$/i.test(file.name) ? 'Markdown' : '纯文本'],
    ...(encoding === 'utf-8' ? {} : { encoding }),
  };
}

/** Offsets belong to the textarea value: CRLF and lone CR each appear there as LF. */
export interface TextSelection { from: number; to: number; bodySnapshot?: string }
export interface TextQuoteOptions {
  position?: { x: number; y: number };
  measurements?: CardMeasurements;
  limits?: { nodes: number; edges: number };
}

function rawTextOffset(body: string, textareaOffset: number): number {
  let rawOffset = 0;
  for (let offset = 0; offset < textareaOffset; offset++) rawOffset += body[rawOffset] === '\r' && body[rawOffset + 1] === '\n' ? 2 : 1;
  return rawOffset;
}

/** One current-body snapshot and source edge, committed together or rejected together. */
export function createTextQuoteBatch(board: Board, nodeId: string, range: TextSelection, options: TextQuoteOptions = {}): { board: Board; quotes: BoardNode[] } {
  const source = board.nodes.find(node => node.id === nodeId);
  if (!source) throw new Error('来源卡片已被移除，请重新选择文字资料');
  if (!['note', 'link'].includes(source.data.kind)) throw new Error('请从笔记或网页资料的正文中选择文字');
  const body = source.data.body;
  const visibleBody = normalizeTextBody(body);
  if (range?.bodySnapshot !== undefined && normalizeTextBody(range.bodySnapshot) !== visibleBody) throw new Error('正文已经变化，请重新选择要摘录的文字');
  if (!range || !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to <= range.from || range.to > visibleBody.length) throw new Error('文字选区无效，请重新选择要摘录的文字');
  if (splitsTextCharacter(visibleBody, range.from) || splitsTextCharacter(visibleBody, range.to)) throw new Error('选区切开了一个完整字符，请重新选择文字');
  if (range.to - range.from > TEXT_SOURCE_LIMITS.quoteCharacters) throw new Error('单次文字摘录最多支持 20,000 个字符，请缩小选择范围');
  const text = body.slice(rawTextOffset(body, range.from), rawTextOffset(body, range.to));
  if (!text.trim()) throw new Error('请先选择一段有内容的文字');
  const limits = options.limits ?? STORAGE_LIMITS;
  if (!Number.isInteger(limits.nodes) || limits.nodes < 0 || !Number.isInteger(limits.edges) || limits.edges < 0) throw new Error('画布容量设置无效');
  const nodeLimit = Math.min(limits.nodes, STORAGE_LIMITS.nodes), edgeLimit = Math.min(limits.edges, STORAGE_LIMITS.edges);
  if (board.nodes.length + 1 > nodeLimit) throw new Error(`摘录后将超过 ${nodeLimit} 张卡片，请先整理画布`);
  if (board.edges.length + 1 > edgeLimit) throw new Error(`摘录后将超过 ${edgeLimit} 条连线，请先整理连线`);
  if (options.position && (!Number.isFinite(options.position.x) || !Number.isFinite(options.position.y))) throw new Error('摘录位置无效，请重新选择放置位置');
  const sourceBounds = getCardBounds(source, options.measurements);
  const origin = options.position ?? { x: sourceBounds.x + sourceBounds.width + 70, y: sourceBounds.y + 35 };
  const initialQuote = createNode('quote', origin);
  // No stored height: the card follows its content (§6.11), like the example excerpts.
  initialQuote.style = { width: 290 };
  initialQuote.data = { ...initialQuote.data, title: shortTitle(`摘录 · ${source.data.title || '文字资料'}`), body: '', citation: { nodeId, title: source.data.title, text, textAnchor: createTextAnchor(body, range.from, range.to) }, tags: ['参考摘录'] };
  const [quote] = placeCards([initialQuote], board.nodes, { origin, measurements: options.measurements, preserveFirst: options.position !== undefined });
  const next = { ...board, nodes: [...board.nodes, quote], edges: [...board.edges, { id: uid(), source: nodeId, target: quote.id, label: '摘录', type: 'smoothstep' }] };
  validateBoard(next);
  return { board: next, quotes: [quote] };
}

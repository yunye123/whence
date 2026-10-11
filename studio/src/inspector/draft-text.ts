import type { DraftReference } from '../draft-references';
import { draftCharacterCount, draftReadableSegments, plainMarkdown } from '../source-location';
import type { TextEditorHandle } from './draft-editor/handle';

/** The readable text of a draft: reference links, Markdown marks and the internal protocol removed (PW-B1, PW-B2). */
export function draftReadableText(body: string): string {
  return draftReadableSegments(body).map(segment => ('text' in segment ? segment.text : '')).join('');
}

/**
 * Characters inside quotation blocks (`> …`), counted the same way as draftCharacterCount. The status band shows
 * “正文 N 字” (draftCharacterCount, the number the card, the outline and the sidebar also show) and how much of it
 * is quoted, so the writer can see their own share (PW-B2).
 */
export function draftQuotedCharacterCount(body: string): number {
  const quoted = body.replace(/\r\n?/g, '\n').split('\n').filter(line => /^[ \t]{0,3}>/.test(line)).join('\n');
  return quoted ? draftCharacterCount(quoted) : 0;
}

/** Reading time from the readable text only (UUIDs and link markup no longer count as English words, PW-B2). */
export function readingMinutes(body: string): number {
  const text = draftReadableText(body);
  const chinese = (text.match(/[㐀-鿿]/g) || []).length;
  const words = (text.replace(/[㐀-鿿]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return chinese / 400 + words / 220;
}

/** “预计阅读 6 分钟” (K11 keeps “预计阅读”; C12 retires the old “1 分 2 秒” form). */
export function readingLength(body: string): string {
  const minutes = readingMinutes(body);
  if (minutes <= 0) return '0 分钟';
  if (minutes < 1) return '不到 1 分钟';
  return `${Math.round(minutes)} 分钟`;
}

/**
 * The status band's numbers from one pass over the body (they run on every keystroke): `count` is exactly
 * draftCharacterCount (the number the card, outline and sidebar show; the band calls it “含引文”), `quoted` counts the
 * quotation lines the same way (“正文” = count − quoted), reading time comes from the same readable text.
 */
export function draftStats(body: string): { count: number; quoted: number; minutes: number } {
  const text = draftReadableText(body);
  const chinese = (text.match(/[㐀-鿿]/g) || []).length;
  const words = (text.replace(/[㐀-鿿]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return { count: [...text.replace(/\s/g, '')].length, quoted: draftQuotedCharacterCount(body), minutes: chinese / 400 + words / 220 };
}

/** Thousands separators as the design writes numbers (1,860). */
export const formatCount = (value: number) => value.toLocaleString('en-US');

/** Editor ranges are UTF-16 offsets in LF text, including after restoring a CRLF version (K9-14). */
export function insertDraftText(body: string, start: number, end: number, text: string, wrap?: [string, string]) {
  const normalize = (value: string) => value.replace(/\r\n?/g, '\n');
  const current = normalize(body);
  const from = Math.max(0, Math.min(current.length, start));
  const to = Math.max(from, Math.min(current.length, end));
  const selection = current.slice(from, to);
  const inserted = wrap ? normalize(wrap[0]) + (selection || normalize(text)) + normalize(wrap[1]) : normalize(text);
  return { body: current.slice(0, from) + inserted + current.slice(to), cursor: from + inserted.length };
}

/** Plain-text paragraphs of a saved version, for the read-only preview before restoring (PW-m1). */
export function versionParagraphs(body: string): string[] {
  return plainMarkdown(draftReadableText(body)).split(/\n[ \t]*\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
}

/**
 * Select a reference in the body and bring it into view. The CodeMirror editor reveals it itself (centred,
 * respecting the status band); a plain textarea falls back to measuring the line with a mirror element.
 */
export function revealDraftReference(editor: TextEditorHandle & { revealRange?: (from: number, to: number) => void }, reference: Pick<DraftReference, 'from' | 'to'>) {
  if (editor.revealRange) { editor.revealRange(reference.from, reference.to); return; }
  if (!(editor instanceof HTMLTextAreaElement)) { editor.focus({ preventScroll: true }); editor.setSelectionRange(reference.from, reference.to); return; }
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(reference.from, reference.to);
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  mirror.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;';
  for (const property of [
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing',
    'text-indent', 'text-transform', 'tab-size', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  ]) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  mirror.style.width = `${editor.clientWidth}px`;
  mirror.textContent = editor.value.slice(0, reference.from);
  const marker = document.createElement('span');
  marker.textContent = editor.value.slice(reference.from, reference.to) || '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.getClientRects()[0]?.top ?? 0;
  mirror.remove();
  editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
  editor.scrollIntoView({ block: 'nearest' });
}

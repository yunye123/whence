import { Fragment, type ReactNode } from 'react';
import { textPieces, type TextMode } from './text-measure';

/**
 * Chinese short-text wrapping (DESIGN_SYSTEM §3.4 折行): the element uses `word-break: keep-all` and gets a
 * `<wbr>` between the words that Intl.Segmenter finds, so a title never breaks inside a word (“赚/钱”).
 * Punctuation joins the word before it (closing marks) or after it (opening marks), so no line starts with
 * “，” or ends with “「”. Results are cached per text and computed once per render, never during zoom/pan.
 * Grapheme-safe fallback works without Intl.Segmenter. Long source text stays in the same pipeline.
 */


/** Compatibility helper for existing short-CJK callers; Words itself supports Latin and long text too. */
export function wordPieces(text: string): string[] | null {
  if (!text || !/[㐀-鿿]/.test(text)) return null;
  const pieces = textPieces(text, { mode: 'word' });
  return pieces.length > 1 ? pieces : null;
}

/**
 * Inline text with word break points. `className` is merged with `cjk-wrap` when break points exist.
 * `keep` (card text that wraps over several lines): the last words of each paragraph that hold at least this many
 * visible characters stay on one line, so no paragraph ends with one or two characters on a row of their own
 * (§3.4 “不允许孤字成行”; the draft card and focus writing keep 4 the same way). Whole words move, never half a word.
 */
export function Words({ text, as: Tag = 'span', className, lang, keep = 0, mode = 'word', minRun = keep, font, width, letterSpacing, wordSpacing, whiteSpace, tabSize, autospace }: {
  text: string; as?: 'span' | 'p' | 'h3' | 'div'; className?: string; lang?: string; keep?: number;
  mode?: TextMode;
  /** Minimum visible paragraph tail; keeps the old `keep` call sites compatible. */
  minRun?: number;
  /** Optional resolved font and known content width for measured sentence planning (no layout reads). */
  font?: string; width?: number;
  letterSpacing?: number; wordSpacing?: number; whiteSpace?: 'normal' | 'pre-wrap' | 'pre-line' | 'pre' | 'break-spaces'; tabSize?: number; autospace?: boolean;
}) {
  const pieces = textPieces(text, { mode, font, width, letterSpacing, wordSpacing, whiteSpace, tabSize, autospace, minRun });
  const classes = [className, pieces && (mode === 'char' ? 'char-wrap' : 'cjk-wrap'), pieces && mode === 'sentence' && 'sentence-wrap'].filter(Boolean).join(' ') || undefined;
  return <Tag className={classes} lang={lang}>{pieces ? minRun > 0 ? withKeptTails(pieces, minRun) : withBreaks(pieces) : text}</Tag>;
}

export function withBreaks(pieces: string[]): ReactNode[] {
  return pieces.map((piece, index) => index === 0 ? piece : <Fragment key={index}><wbr />{piece}</Fragment>);
}

const visibleLength = (text: string) => Array.from(text.replace(/\s+/g, '')).length;

/** `withBreaks`, with the last words of every paragraph (a run ending in a line break, or the end) in a keep-together span. */
export function withKeptTails(pieces: string[], keep: number): ReactNode[] {
  const out: ReactNode[] = [];
  let start = 0;
  const flush = (end: number) => {
    // The paragraph's own line break stays outside the span, where it still breaks the line.
    const last = pieces[end - 1];
    const trail = last.match(/\s*$/)?.[0] ?? '';
    const runs = pieces.slice(start, end);
    runs[runs.length - 1] = last.slice(0, last.length - trail.length);
    let tail = runs.length, count = 0;
    while (tail > 0 && count < keep) count += visibleLength(runs[--tail]);
    runs.forEach((piece, index) => {
      if (index >= tail) return;
      const at = start + index;
      out.push(at === 0 ? piece : <Fragment key={at}><wbr />{piece}</Fragment>);
    });
    const kept = runs.slice(tail).join('');
    if (kept) out.push(<Fragment key={`keep-${start + tail}`}>{start + tail > 0 && <wbr />}<span className="keep-together">{kept}</span></Fragment>);
    if (trail) out.push(trail);
    start = end;
  };
  pieces.forEach((piece, index) => { if (/\n\s*$/.test(piece)) flush(index + 1); });
  if (start < pieces.length) flush(pieces.length);
  return out;
}

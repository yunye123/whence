import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { wordPieces } from '../cards/Words';

/** Mid-sentence marks whose ink sits in the left half of the em box (、，；：). */
const SQUEEZE = /[、，；：]/;

/** One run of text with each 、，；： in a `.draft-punct` span (the stylesheet tucks its blank half in). */
function squeeze(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (!SQUEEZE.test(text[index])) continue;
    if (index > start) out.push(text.slice(start, index));
    out.push(<span key={`${key}-${index}`} className="draft-punct">{text[index]}</span>);
    start = index + 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * Short serif passages of the writer's own draft beside sans text (the 来历 draft card of the watching workbench,
 * INSP-32): the Song comma's ink is a small hook at the far left of a full em, so next to the heavier sans comma the
 * serif sentence reads “摊主说，  四点”. Each 、，；： gives back about a third of its blank half (`.draft-punct`, in
 * inspector-writing.css); 。 and closing quotes keep their full width, so a superscript still tucks into them. Word break
 * points are the same as `Words` (no break inside “赚钱”). Long draft text (the editor, the script view) keeps the
 * standard full-width marks.
 */
export default function DraftWords({ text, className }: { text: string; className?: string }) {
  const pieces = wordPieces(text);
  const classes = [className, pieces && 'cjk-wrap'].filter(Boolean).join(' ') || undefined;
  return <span className={classes}>{pieces
    ? pieces.map((piece, index) => <Fragment key={index}>{index > 0 && <wbr />}{squeeze(piece, String(index))}</Fragment>)
    : squeeze(text, 'all')}</span>;
}

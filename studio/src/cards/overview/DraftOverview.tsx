import { useMemo } from 'react';
import { manuscriptProjection } from '../draft-preview';
import { Words } from '../Words';
import type { CardOverviewProps } from './types';

export interface DraftOverviewParagraph {
  text: string;
  cited: boolean;
  footnotes: number[];
  number: number;
  citeKeys: string[];
}

/** Same LF owners/global footnotes as the face, no second paragraph parser. Whole paragraphs only. */
export function draftOverviewParagraphs(body: string, limit = 1600): DraftOverviewParagraph[] {
  const projection = manuscriptProjection(body);
  const paragraphs: DraftOverviewParagraph[] = [];
  let length = 0;
  for (const p of projection.paragraphs) {
    if (!p.number || !p.text) continue;
    if (length >= limit || paragraphs.length >= 8) break;
    length += p.text.length;
    paragraphs.push({ text: p.text, cited: p.quoted, number: p.number,
      footnotes: [...p.footnotes], citeKeys: p.footnotes.map(i => projection.footnotes[i - 1]).filter(Boolean).map(f => f.quoteNodeId ?? f.sourceNodeId) });
  }
  return paragraphs;
}

export function DraftOverview({ data, title }: CardOverviewProps) {
  const draft = useMemo(() => draftOverviewParagraphs(data.body), [data.body]);
  let anchorsLeft = 8;
  return <div className="field-card__overview field-card__overview--draft card-drag" aria-hidden="true">
    <div className="field-card__overview-content">
      <Words as="h3" text={title} />
      <div className="field-card__draft-rule" />
      <div className="field-card__overview-bars"><div>{draft.map(p => {
        const anchors = p.footnotes.slice(0, anchorsLeft); anchorsLeft -= anchors.length;
        return <p key={p.number} className={`field-card__ref${p.citeKeys.length ? ' is-cited' : ''}`} data-pn={p.number}
        data-cite-key={p.citeKeys[0]}>
        {anchors.map((footnote, i) => <i key={footnote} data-footnote={footnote} data-edge-anchor="para-ref" data-cite-key={p.citeKeys[i]} />)}
        <span>{p.text}</span>
      </p>; })}</div></div>
    </div>
  </div>;
}

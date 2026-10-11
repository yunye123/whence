import type { BoardNode } from '../../model';
import { timecode } from '../../model';
import { citationLocationLabel, paragraphIndexAt, timeRangeLabel } from '../../source-location';
import type { DraftReferenceSpan, ReferenceInfo } from './references';

/** One reference in the draft joined with what the board knows about it (margin card, popover, list row). */
export interface ResolvedReference {
  index: number;
  span: DraftReferenceSpan;
  source?: BoardNode;
  quote?: BoardNode;
  /** The link names an excerpt that is gone or no longer belongs to this source. */
  quoteMissing: boolean;
  /** Source title without the “来源：” prefix and the time suffix that `formatDraftQuote` writes into the label. */
  title: string;
  /** What the provenance tag says: `01:12–01:26` or `第 3 段` (§6.7); undefined when there is no exact place. */
  location?: string;
  /** The tag's action name: “回到原片 01:12”, “回到原文第 3 段”. */
  actionLabel: string;
  /** The quoted sentence as captured, and the writer's own understanding written on the excerpt. */
  text?: string;
  mine?: string;
  video: boolean;
}

function labelTitle(label: string): string {
  const raw = label.replace(/^来源[：:]\s*/, '').replace(/\\([\\[\]()`])/g, '$1').trim();
  return raw.replace(/\s\d{1,2}:\d{2}(?::\d{2})?$/, '').trim();
}

export function resolveReferences(spans: readonly DraftReferenceSpan[], nodes: readonly BoardNode[]): ResolvedReference[] {
  return spans.map(span => {
    const source = nodes.find(node => node.id === span.sourceNodeId);
    const quote = span.quoteNodeId
      ? nodes.find(node => node.id === span.quoteNodeId && node.data.kind === 'quote' && node.data.citation?.nodeId === span.sourceNodeId)
      : undefined;
    const citation = quote?.data.citation;
    const video = source?.data.kind === 'video' || span.time !== undefined || citation?.start !== undefined;
    const paragraph = citation?.textAnchor && source ? paragraphIndexAt(source.data.body, citation.textAnchor.from) : undefined;
    const location = citation ? citationLocationLabel(citation, paragraph) : span.time !== undefined ? timeRangeLabel(span.time) : undefined;
    const fromLabel = /^field:\/\//i.test(span.label) ? '' : labelTitle(span.label);
    const start = citation?.start ?? span.time;
    return {
      index: span.index,
      span,
      source,
      quote,
      quoteMissing: !!span.quoteNodeId && !quote,
      title: fromLabel || source?.data.title || citation?.title || '来源卡片',
      location: location === '原文' ? undefined : location,
      actionLabel: start !== undefined ? `回到原片 ${timecode(start)}` : paragraph ? `回到原文第 ${paragraph} 段` : '打开来源',
      text: (citation?.text ?? (quote && !citation ? quote.data.body : undefined))?.trim() || undefined,
      mine: citation && quote?.data.body.trim() ? quote.data.body.trim() : undefined,
      video,
    };
  });
}

export function referenceInfoMap(references: readonly ResolvedReference[]): Map<number, ReferenceInfo> {
  return new Map(references.map(reference => [reference.index, { title: reference.title, location: reference.location, gone: !reference.source }]));
}

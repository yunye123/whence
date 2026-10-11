import { History } from 'lucide-react';
import type { CardData } from '../model';
import { timecode } from '../model';
import { useBoard } from '../board-context';
import { transcriptRevision } from '../transcript-tools';
import { resolveTextAnchor } from '../text-anchor';
import { paragraphIndexAt, plainMarkdown, timeRangeLabel } from '../source-location';
import { ProvenanceTagShape } from '../components/ProvenanceTag';

/**
 * The quote's captured source text, laid out like the quote card (§6.11): the provenance tag with the exact place
 * (`01:12–01:26`, `第 3 段`) and the source title, then the original sentence. The snapshot never changes when its
 * source is corrected or edited; the tag goes back to the source and keeps the draft return point (contract C15).
 */
export default function QuoteCitationPanel({ nodeId, data, rememberVisit }: {
  nodeId: string;
  data: CardData;
  rememberVisit: () => void;
}) {
  const board = useBoard();
  const citation = data.citation;
  const citationSource = citation ? board.nodes.find(item => item.id === citation.nodeId) : undefined;
  const citationIsOutdated = !!citation
    && citationSource?.data.kind === 'video'
    && !!citationSource.data.transcriptRevision
    && transcriptRevision(citation) !== transcriptRevision(citationSource.data);
  const textLocation = citation && citationSource && ['note', 'link'].includes(citationSource.data.kind) ? resolveTextAnchor(citationSource.data.body, citation) : null;
  const citationTextChanged = !!textLocation && (textLocation.changed || textLocation.status === 'missing');
  const paragraph = textLocation?.status === 'matched' ? paragraphIndexAt(citationSource!.data.body, textLocation.matches[0].from) : undefined;
  const timeLabel = citation ? timeRangeLabel(citation.start, citation.end) : undefined;
  const place = timeLabel ?? (paragraph ? `第 ${paragraph} 段` : '原文');
  const action = citation?.start !== undefined ? `回到原片 ${timecode(citation.start)}` : paragraph ? `回到原文第 ${paragraph} 段` : '回到原文';
  return <section className="inspector-section inspector-citation">
    {citation ? <button
      type="button"
      className="inspector-source-button"
      disabled={!citationSource}
      title={citationSource ? action : '来源卡片已不在当前画布'}
      aria-label={citationSource ? `${action}：${citation.title}` : `来源卡片已不在当前画布：${citation.title}`}
      onClick={() => { rememberVisit(); board.focusSource(citation.nodeId, citation.start, !!board.draftReturn, nodeId); }}
    >
      <ProvenanceTagShape label={place} gone={!citationSource} />
      <span className="inspector-citation-source">{citation.title || '未命名来源'}</span>
    </button> : <h3 className="inspector-citation-heading">原文</h3>}
    <blockquote>{plainMarkdown(citation?.text ?? data.body).trim()}</blockquote>
    {citationIsOutdated && <p className="inspector-citation-updated"><History size={14} aria-hidden="true" />来源逐字稿后来有更新；这张摘录保留了创建时的文字。</p>}
    {citationTextChanged && <p className="inspector-citation-updated"><History size={14} aria-hidden="true" />来源文字后来有修改；这张摘录保留了创建时的原文。</p>}
    {citation && !citationSource && <p className="inspector-citation-missing">来源卡片已不在当前画布，摘录原文仍保留在这里。</p>}
  </section>;
}

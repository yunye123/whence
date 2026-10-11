import type { Dispatch, SetStateAction } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { Citation } from '../model';
import type { TextAnchorResolution } from '../text-anchor';
import { QuoteIcon } from '../icons/field-icons';
import { ProvenanceTagShape } from '../components/ProvenanceTag';
import type { SourceReveal } from './shared';

/**
 * Result of locating a quote inside its text source. Repeated text never selects the first match silently, and
 * a missing match shows the snapshot (contract C13). The notice sticks to the top of the reading column so it stays
 * visible while the quotation is centred (PR-M3); “返回摘录” goes back to the quote card that sent the reader here
 * (PR-m2, Alt+←).
 */
export default function SourceLocationNotice({
  normalizedBody, sourceLocation, revealCitation, chosenSourceMatch, setChosenSourceMatch, setSourceReveal, setReading, paragraph, onReturnToQuote, origin,
}: {
  normalizedBody: string;
  sourceLocation: TextAnchorResolution | null;
  revealCitation: Citation | undefined;
  chosenSourceMatch: number | null;
  setChosenSourceMatch: Dispatch<SetStateAction<number | null>>;
  setSourceReveal: Dispatch<SetStateAction<SourceReveal | null>>;
  setReading: Dispatch<SetStateAction<boolean>>;
  /** “第 N 段” of the located quotation. */
  paragraph?: number;
  onReturnToQuote?: () => void;
  /** CORE-05: the reader came from a search hit (a passage of the current text), not from an excerpt card. */
  origin?: 'search';
}) {
  const missing = sourceLocation?.status === 'missing' || !revealCitation;
  const ambiguous = sourceLocation?.status === 'ambiguous';
  const fromSearch = origin === 'search';
  const heading = !revealCitation ? '对应摘录已不在当前画布'
    : sourceLocation?.status === 'missing' ? '当前资料中未找到这段原文'
      : ambiguous && chosenSourceMatch === null ? `找到 ${sourceLocation!.matches.length} 处相同原文`
        : fromSearch ? '已定位到搜索结果' : '已定位到摘录原文';
  return <section
    className={`inspector-source-location${missing ? ' inspector-source-location--missing' : ''}${ambiguous ? ' inspector-source-location--choices' : ''}`}
    aria-label={fromSearch ? '搜索结果定位' : '摘录原文定位'}
    role="status"
  >
    <div className="inspector-source-location-heading">
      <QuoteIcon size={16} />
      <strong>{heading}</strong>
      {!missing && paragraph !== undefined && (!ambiguous || chosenSourceMatch !== null) && <span className="inspector-source-location-where"><ProvenanceTagShape label={`第 ${paragraph} 段`} /></span>}
      <span className="inspector-source-location-actions">
        {onReturnToQuote && <button
          type="button"
          className="btn btn--sm inspector-source-return"
          aria-keyshortcuts="Alt+ArrowLeft"
          title="回到刚才的摘录 (Alt+←)"
          onClick={onReturnToQuote}
        ><ArrowLeft size={14} aria-hidden="true" />返回摘录</button>}
        <button type="button" className="icon-btn icon-btn--sm" aria-label="关闭原文定位提示" title="关闭提示" onClick={() => { setSourceReveal(null); setChosenSourceMatch(null); }}><X size={14} aria-hidden="true" /></button>
      </span>
    </div>
    {sourceLocation?.changed && sourceLocation.status !== 'missing' && <p>来源后来有修改。这里显示当前文字，摘录保留创建时的原文。</p>}
    {ambiguous && <>
      <p>选择要回查的位置。</p>
      <div className="inspector-source-matches">
        {sourceLocation!.matches.map((match, index) => <button
          type="button"
          key={`${match.from}-${match.to}`}
          aria-pressed={chosenSourceMatch === index}
          onClick={() => { setReading(true); setChosenSourceMatch(index); }}
        >
          <span>第 {index + 1} 处</span>
          <small>{normalizedBody.slice(Math.max(0, match.from - 24), Math.min(normalizedBody.length, match.to + 24)).replace(/\s+/g, ' ')}</small>
        </button>)}
      </div>
    </>}
    {sourceLocation?.status === 'missing' && (fromSearch ? <p>这段文字刚刚改过。重新搜索一次即可定位。</p> : <>
      <p>原文可能已修改或删除。资料照常可读，摘录里的文字不会改变。</p>
      <details><summary>查看当时摘录的原文</summary><blockquote>{revealCitation?.text}</blockquote></details>
    </>)}
    {!revealCitation && <p>资料仍可阅读，当前无法定位到原摘录。</p>}
  </section>;
}

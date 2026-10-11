import { useMemo } from 'react';
import { ArrowUpRight, Plus, X } from 'lucide-react';
import type { BoardNode } from '../model';
import { useBoard } from '../board-context';
import ProvenanceTag from '../components/ProvenanceTag';
import { citationLocationLabel, paragraphIndexAt } from '../source-location';
import { keepEditorFocus } from './shared';

/**
 * Canvas excerpts available to a draft (PW-M2): each shows its sentence, the writer's understanding and its exact
 * place, can open its source, and is inserted at the caret. In focus writing it is a drawer on the right of the desk,
 * in the docked panel a sheet over the lower part of the panel, so the body keeps its height while choosing.
 * The class `inspector-reference-list` and the test ids are script contracts.
 */
export default function DraftReferenceList({ openDraftSource, onInsert, onClose, usedCounts, variant }: {
  openDraftSource: (sourceId: string, time?: number, quoteNodeId?: string) => void;
  onInsert: (quote: BoardNode) => void;
  onClose: () => void;
  /** How many times each excerpt is already cited in this draft. */
  usedCounts: ReadonlyMap<string, number>;
  variant: 'inline' | 'sheet' | 'drawer';
}) {
  const board = useBoard();
  const quotes = useMemo(() => board.nodes.filter(item => item.data.kind === 'quote'), [board.nodes]);
  return <section className={`inspector-reference-list draft-picker draft-picker--${variant}`} aria-label="画布里的摘录"
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    }}
  >
    <div className="draft-picker__head">
      <h3>画布里的摘录</h3>
      <span className="draft-picker__count tabular">{quotes.length}</span>
      <button type="button" className="icon-btn draft-picker__close" onPointerDown={keepEditorFocus} onClick={onClose} aria-label="收起引用列表" title="收起 (Esc)"><X size={15} aria-hidden="true" /></button>
    </div>
    <div className="draft-picker__body">
      {quotes.length ? quotes.map(quote => {
        const citation = quote.data.citation;
        const source = citation ? board.nodes.find(item => item.id === citation.nodeId) : undefined;
        const paragraph = citation?.textAnchor && source ? paragraphIndexAt(source.data.body, citation.textAnchor.from) : undefined;
        const location = citationLocationLabel(citation, paragraph);
        const sourceGone = !!citation && !source;
        const used = usedCounts.get(quote.id) ?? 0;
        const sentence = citation?.text ?? quote.data.body;
        const mine = citation ? quote.data.body.trim() : '';
        return <article key={quote.id} className={`draft-picker__item${used ? ' is-used' : ''}`} data-testid={`draft-available-quote-${quote.id}`}>
          <div className="draft-picker__item-head">
            {location && location !== '原文' && <ProvenanceTag size="mini" label={location} gone={sourceGone} />}
            <button
              type="button"
              className="draft-picker__source"
              disabled={sourceGone}
              title={sourceGone ? '来源卡片已不在当前画布' : `打开来源：${citation?.title || quote.data.title}`}
              onPointerDown={keepEditorFocus}
              onClick={() => openDraftSource(citation?.nodeId || quote.id, citation?.start, citation ? quote.id : undefined)}
            ><span>{citation?.title || quote.data.title}</span><ArrowUpRight size={13} aria-hidden="true" /></button>
            {used > 0 && <span className="draft-picker__used">已引用{used > 1 ? ` ${used} 次` : ''}</span>}
          </div>
          <p className="draft-picker__sentence">{sentence}</p>
          {mine && <p className="draft-picker__mine">{mine}</p>}
          <div className="draft-picker__actions">
            <button type="button" className="btn btn--soft btn--sm" disabled={board.readOnly} onPointerDown={keepEditorFocus} onClick={() => onInsert(quote)} title="插入到光标处"><Plus size={14} aria-hidden="true" />插入</button>
          </div>
        </article>;
      }) : <p className="draft-empty-copy">画布上还没有摘录。打开文字资料选中原文，或在视频的逐字稿里勾选句子，摘到画布。</p>}
    </div>
  </section>;
}

import { useSyncExternalStore, type ClipboardEvent, type CSSProperties } from 'react';
import { ProvenanceTagShape } from '../components/ProvenanceTag';
import { citationLocationLabel } from '../source-location';
import { Words } from './Words';
import { cardExtras, type CardBodyProps } from './types';
import { canMeasureText, estimateLines, type TextMode } from './text-measure';

// One font subscription for these two materials. The shared text planner owns its LRU and
// loadingdone invalidation; card unmounts only unsubscribe the render, never clear that cache.
let fontRevision = 0;
const fontListeners = new Set<() => void>();
let watchingFonts = false;
function subscribeFonts(listener: () => void) {
  fontListeners.add(listener);
  if (!watchingFonts && typeof document !== 'undefined' && document.fonts) {
    watchingFonts = true;
    document.fonts.addEventListener('loadingdone', () => {
      fontRevision += 1;
      for (const notify of fontListeners) notify();
    });
  }
  return () => { fontListeners.delete(listener); };
}

/** Local quote/note intrinsic height planning, using outer node geometry with 14px own insets.
 * SSR and unavailable canvas defer to natural CSS layout, rather than inventing line counts. */
export function useStationeryLines(text: string, previewWidth: number | undefined, font: string, mode: TextMode = 'word', minRun = 0) {
  useSyncExternalStore(subscribeFonts, () => fontRevision, () => 0);
  if (!canMeasureText()) return undefined;
  // createNode's current default outer width is 290; legacy isolated renders omit the prop.
  const width = Math.max(1, (previewWidth ?? 290) - 28);
  return estimateLines(text, { font, width, mode, minRun, whiteSpace: 'pre-wrap', letterSpacing: 0 });
}

/** Tag text and the spoken action of an excerpt's provenance tag (§6.7: only the position is written). */
export function quoteLocation({ data, board }: Pick<CardBodyProps, 'data' | 'board'>) {
  const citation = data.citation;
  if (!citation) return undefined;
  const paragraph = citation.start === undefined && citation.textAnchor
    ? cardExtras(board).sourceParagraph?.(citation.nodeId, citation.textAnchor.from)
    : undefined;
  const label = citationLocationLabel(citation, paragraph) ?? '原文';
  const video = citation.start !== undefined;
  const action = video ? `回到原片 ${label.split('–')[0]}` : label === '原文' ? '回到原文' : `回到原文${label}`;
  return { label, action };
}

/**
 * The excerpt's head (PLAN §2.4/2.5): a rectangular stamp inside the paper. It is the way back to
 * the source (`field-card__citation`, title “回到原始素材”); when the source card is gone it turns into a
 * dashed, inert outline (K5 title “来源卡片已不在当前画布”).
 */
export function QuoteTag({ id, data, board, activate }: CardBodyProps) {
  const citation = data.citation;
  const location = quoteLocation({ data, board });
  if (!citation || !location) return null;
  const sourceExists = board.sourceNodeIds.has(citation.nodeId);
  if (!sourceExists) {
    return (
      <span className="field-card__citation is-gone" data-edge-anchor="stamp" title="来源卡片已不在当前画布">
        <ProvenanceTagShape variant="stamp" kind={citation.start !== undefined ? 'video' : 'text'} label={location.label} gone />
      </span>
    );
  }
  return (
    <button
      type="button"
      className="field-card__citation tag-btn nodrag nowheel nopan"
      data-edge-anchor="stamp"
      onClick={event => activate(event, () => board.focusSource(citation.nodeId, citation.start, false, id))}
      aria-label={location.action}
      title="回到原始素材"
    >
      <ProvenanceTagShape variant="stamp" kind={citation.start !== undefined ? 'video' : 'text'} label={location.label} />
    </button>
  );
}

/** Source title next to the tag, 12px meta (the header's extra). */
export function QuoteSource({ data, describedById }: Pick<CardBodyProps, 'data'> & { describedById: string }) {
  if (!data.citation) return <span className="field-card__quote-source is-missing">尚未关联原始素材</span>;
  const title = data.citation.title || '原始素材';
  return (
    <>
      <span className="field-card__quote-source">{title}</span>
      <span id={describedById} className="sr-only">来源：{title}</span>
    </>
  );
}

/** Native selection stays in the source DOM. Copy its text nodes rather than the browser's
 * rendered-text projection, which can normalize CRLF or add soft-wrap breaks. No source rewrite. */
function copySourceSelection(event: ClipboardEvent<HTMLElement>) {
  const selection = event.currentTarget.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  if (!event.currentTarget.contains(range.startContainer) || !event.currentTarget.contains(range.endContainer)) return;
  const text = range.cloneContents().textContent;
  if (!text) return;
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Source snapshot in Song, followed by a visibly labelled understanding in Sans. Text and offsets
 * remain untouched; CSS floors the available height to complete lines, including fixed-height cards.
 */
export function QuoteCardBody({ data, previewWidth }: CardBodyProps) {
  const quoteText = data.citation?.text ?? data.body;
  const hasSeparateNote = data.citation?.text !== undefined
    && !!data.body.trim()
    && data.body.trim() !== data.citation.text.trim();
  const translation = data.translation?.trim() ?? '';
  const showTranslation = !hasSeparateNote && !!translation;
  const secondary = hasSeparateNote ? `我的理解 ${data.body}` : showTranslation ? `译文 ${translation}` : '';
  const lines = useStationeryLines(quoteText || '选中素材中的文字，即可留下带来源的摘录。', previewWidth, '500 16px "Noto Serif SC Variable"', 'word', 4);
  const noteLines = useStationeryLines(secondary, previewWidth, '400 14px "Noto Sans SC Variable"', 'word', 4);
  const style = lines === undefined || noteLines === undefined ? undefined : {
    '--text-natural-block': `${Math.max(1, lines) * 26 + (noteLines ? noteLines * 22 + 6 : 0)}px`,
    '--quote-natural-block': `${Math.max(1, lines) * 26}px`,
    '--mine-natural-block': `${noteLines ? noteLines * 22 + 6 : 0}px`,
  } as CSSProperties;

  return (
    <div className="field-card__quote-content card-drag-content nowheel" data-text-planned={style ? '' : undefined} style={style}>
      <blockquote
        className="field-card__quote-text nodrag nowheel nopan"
        style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        tabIndex={-1}
        onPointerDown={event => { if (event.button === 0) event.currentTarget.focus({ preventScroll: true }); }}
        onClick={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
        onCopy={copySourceSelection}
      >
        {quoteText ? <Words text={quoteText} keep={4} /> : <span className="is-placeholder">选中素材中的文字，即可留下带来源的摘录。</span>}
      </blockquote>
      {(hasSeparateNote || showTranslation) && (
        <div className="field-card__quote-note">
          <p><span className="field-card__quote-note-label">{hasSeparateNote ? '我的理解' : '译文'}</span><Words text={hasSeparateNote ? data.body : translation} keep={4} /></p>
        </div>
      )}
    </div>
  );
}

/** One state line only when there is one to tell (“来源已不在画布”). */
export function QuoteCardFooter({ data, board }: Pick<CardBodyProps, 'data' | 'board'>) {
  if (data.citation && !board.sourceNodeIds.has(data.citation.nodeId)) {
    return <span className="field-card__meta-state" title="来源卡片已移除，原文快照仍保留。">来源已不在画布</span>;
  }
  return null;
}

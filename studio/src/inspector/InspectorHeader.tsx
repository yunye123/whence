import type { ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, LocateFixed, Maximize2, Minimize2, X } from 'lucide-react';
import type { CardData, CardKind } from '../model';
import { useBoard } from '../board-context';
import { PanelKindIcon, keepEditorFocus } from './shared';
import type { InspectorLayout } from './shared';

/**
 * Panel header (DESIGN_SYSTEM §6.18). One component, four arrangements:
 * - docked   52: kind icon · title · [header-meta] … [header-actions] · expand · close
 * - video    56: “回到画布 Esc” · title · [header-meta] … [header-actions] · find on canvas; on a trip from a draft
 *              “返回文稿 Esc” leads and returning to the canvas becomes the icon button at the right end (INSP-13)
 * - reading  52: kind icon · [header-meta] … [header-actions] · find on canvas · collapse · close
 * - writing  56: “收起写作 Esc” · [header-meta] … [header-actions] · close
 * The left-most button in the two whole-window layouts is always what Esc does there.
 * Accessible names are contracts (K4): 关闭编辑面板, 展开写作/收起写作, 展开阅读/收起阅读 (aria-pressed), 返回文稿.
 * “Return to draft” appears only on a source trip away from that draft (contract C14 / K9-20).
 */
export default function InspectorHeader({ nodeId, kind, data, layout, title, meta, writingExpanded, readingExpanded, onToggleWriting, onToggleReading, onFindOnCanvas, onClose, metaSlotRef, actionsSlotRef }: {
  nodeId: string;
  kind: CardKind;
  /** The card, so the kind icon matches the sidebar's (文字资料, X posts…); falls back to the kind alone. */
  data?: Pick<CardData, 'kind' | 'tags' | 'url' | 'sourceUrl'>;
  layout: InspectorLayout;
  /** The title field, shown in the header only for docked and video layouts. */
  title?: ReactNode;
  /** Shell-provided meta (reading length and progress, video length); mode components add to the slot after it. */
  meta?: ReactNode;
  writingExpanded: boolean;
  readingExpanded: boolean;
  onToggleWriting: () => void;
  onToggleReading: () => void;
  /** Present only when the canvas can actually bring this card into view. */
  onFindOnCanvas?: () => void;
  onClose: () => void;
  metaSlotRef?: (element: HTMLDivElement | null) => void;
  actionsSlotRef?: (element: HTMLDivElement | null) => void;
}) {
  const board = useBoard();
  const isDraft = kind === 'draft';
  const isTextSource = kind === 'note' || kind === 'link';
  const whole = layout === 'video' || layout === 'writing';
  const draftReturn = board.draftReturn && board.draftReturn.draftId !== nodeId ? board.draftReturn : null;
  // The workbench's leading button says where Esc goes; a trip from a draft goes back to it, the canvas moves right.
  const videoLead = layout === 'video' && !draftReturn;
  const closeTitle = layout === 'video' ? (draftReturn ? '回到画布' : '回到画布 (Esc)') : '关闭面板 (Esc)';
  const closeButton = videoLead
    ? <button type="button" className="inspector-head-button inspector-head-button--text inspector-head-close" onClick={onClose} title={closeTitle} aria-label="关闭编辑面板">
      <ChevronLeft size={16} aria-hidden="true" /><span>回到画布</span><kbd aria-hidden="true">Esc</kbd>
    </button>
    : <button type="button" className="inspector-head-button inspector-head-close" onClick={onClose} title={closeTitle} aria-label="关闭编辑面板"><X size={18} aria-hidden="true" /></button>;
  return <header className={`inspector-header inspector-header--${layout}`}>
    <div className="inspector-head-lead">
      {videoLead && closeButton}
      {layout === 'writing' && <button
        type="button"
        className="inspector-head-button inspector-head-button--text inspector-head-toggle"
        aria-label="收起写作"
        aria-pressed={true}
        title="收起写作，回到面板 (Esc)"
        onPointerDown={keepEditorFocus}
        onClick={onToggleWriting}
      ><ChevronLeft size={16} aria-hidden="true" /><span>收起写作</span><kbd aria-hidden="true">Esc</kbd></button>}
      {draftReturn && <button
        type="button"
        className="inspector-head-button inspector-head-button--text inspector-head-return"
        aria-label="返回文稿"
        title={`返回文稿：${draftReturn.title || '未命名文稿'}${layout === 'video' ? ' (Esc)' : ''}`}
        onClick={() => board.returnToDraft()}
      ><ArrowLeft size={15} aria-hidden="true" /><span>返回文稿</span>{layout === 'video' && <kbd aria-hidden="true">Esc</kbd>}</button>}
      {!whole && !draftReturn && <span className="inspector-head-kind" aria-hidden="true"><PanelKindIcon data={data ?? { kind }} size={16} /></span>}
    </div>
    {title && <div className="inspector-head-title">{title}</div>}
    <div className="inspector-head-meta">
      {meta}
      <div ref={metaSlotRef} className="inspector-slot inspector-slot--header-meta" />
    </div>
    <div className="inspector-head-actions inspector-header-actions">
      <div ref={actionsSlotRef} className="inspector-slot inspector-slot--header-actions" />
      {onFindOnCanvas && <button type="button" className="inspector-head-button" aria-label="在画布上找到" title="在画布上找到" onClick={onFindOnCanvas}><LocateFixed size={16} aria-hidden="true" /></button>}
      {isTextSource && layout !== 'writing' && <button
        type="button"
        className="inspector-head-button inspector-head-toggle"
        aria-label={readingExpanded ? '收起阅读' : '展开阅读'}
        aria-pressed={readingExpanded}
        title={readingExpanded ? '收起阅读，回到面板 (Esc)' : '展开阅读：画布退到左侧'}
        onPointerDown={keepEditorFocus}
        onClick={onToggleReading}
      >{readingExpanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</button>}
      {isDraft && layout === 'docked' && <button
        type="button"
        className="inspector-head-button inspector-head-toggle"
        aria-label="展开写作"
        aria-pressed={writingExpanded}
        title="展开写作：整窗专注"
        onPointerDown={keepEditorFocus}
        onClick={onToggleWriting}
      ><Maximize2 size={16} aria-hidden="true" /></button>}
      {!videoLead && closeButton}
    </div>
  </header>;
}

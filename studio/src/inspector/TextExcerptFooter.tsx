import { Plus } from 'lucide-react';
import type { CardData } from '../model';
import { useBoard } from '../board-context';
import { paragraphIndexAt, plainMarkdown } from '../source-location';
import type { Dispatch, SetStateAction } from 'react';
import { keepEditorFocus } from './shared';
import type { TextSelection } from './shared';

/**
 * Status and the excerpt action for the text panel footer. A selection is valid only for the body it was taken
 * from. While the reading view shows its own selection toolbar, the footer button steps aside (CSS) so there is
 * one “摘录选中文字到画布” at a time; in the editor the footer button is the action.
 */
export default function TextExcerptFooter({ nodeId, data, normalizedBody, textSelection, setTextSelection }: {
  nodeId: string;
  data: CardData;
  normalizedBody: string;
  textSelection: TextSelection | null;
  /** The shell's setter (integration request): clears the selection right after the excerpt, in either view. */
  setTextSelection?: Dispatch<SetStateAction<TextSelection | null>>;
}) {
  const board = useBoard();
  const canExcerptText = !!textSelection && textSelection.bodySnapshot === data.body && !!normalizedBody.slice(textSelection.from, textSelection.to).trim();
  const selected = canExcerptText ? Array.from(plainMarkdown(normalizedBody.slice(textSelection!.from, textSelection!.to)).replace(/\s+/g, '')).length : 0;
  const paragraph = canExcerptText ? paragraphIndexAt(normalizedBody, textSelection!.from) : undefined;
  return <footer className="inspector-footer inspector-excerpt-footer" aria-label="文字摘录">
    <span className="inspector-excerpt-status" aria-live="polite">
      {board.readOnly ? <span className="inspector-excerpt-line">此窗口只读，可阅读与回查来源</span>
        : canExcerptText ? <>
          <span className="inspector-excerpt-line">已选 <b className="tabular">{selected.toLocaleString('zh-CN')}</b> 字{paragraph ? <>，在第 <span className="tabular">{paragraph}</span> 段</> : null}</span>
          <small>摘录会保留原文与出处</small>
        </> : <>
          <span className="inspector-excerpt-line">选择正文中值得留下的文字</span>
          <small className="inspector-excerpt-hint">按 <kbd>E</kbd> 摘录，<kbd>Alt</kbd><kbd>↓</kbd> 按句选择</small>
        </>}
    </span>
    <button
      type="button"
      className="btn btn--soft inspector-excerpt-button"
      aria-label="摘录选中文字到画布"
      title="摘录到画布 (E)"
      disabled={!canExcerptText || board.readOnly}
      onPointerDown={keepEditorFocus}
      onClick={event => {
        if (!canExcerptText || !textSelection) return;
        if (!board.addTextQuote(nodeId, textSelection)) return;
        // Done: clear the selection so the same words are not excerpted twice (PR-M3).
        setTextSelection?.(null);
        window.getSelection()?.removeAllRanges();
        const editor = document.querySelector<HTMLTextAreaElement>('.inspector textarea#card-body[aria-label="资料正文"]');
        if (editor) { editor.focus({ preventScroll: true }); editor.setSelectionRange(textSelection.to, textSelection.to); }
        else event.currentTarget.focus({ preventScroll: true });
      }}
    ><Plus size={15} aria-hidden="true" />摘录到画布</button>
  </footer>;
}

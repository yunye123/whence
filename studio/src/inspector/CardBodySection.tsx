import type { RefObject } from 'react';
import type { CardData } from '../model';
import { useBoard } from '../board-context';
import type { PatchCard } from './shared';

/**
 * Free-text body for quote (“我的理解”, in the note hand §3.4 `--type-mine`), image (“画面笔记”) and frame cards.
 * The field grows with its text instead of scrolling inside the panel. A legacy quote without a citation snapshot
 * keeps its old body as the snapshot on first edit.
 */
export default function CardBodySection({ nodeId, data, editorRef, patch }: {
  nodeId: string;
  data: CardData;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  patch: PatchCard;
}) {
  const board = useBoard();
  const isQuote = data.kind === 'quote';
  return <section className={`inspector-section inspector-body-section inspector-body-section--${data.kind}`}>
    <label className="inspector-field-label" htmlFor="card-body">{isQuote ? '我的理解' : data.kind === 'image' ? '画面笔记' : '正文'}</label>
    <textarea
      ref={editorRef}
      id="card-body"
      className={isQuote ? 'inspector-mine' : 'inspector-note-field'}
      maxLength={100000}
      readOnly={board.readOnly}
      value={isQuote && data.citation?.text === undefined ? '' : data.body}
      onChange={event => {
        if (isQuote && data.citation?.text === undefined) patch({ body: event.target.value, citation: { nodeId: data.citation?.nodeId || nodeId, title: data.citation?.title || data.title, ...data.citation, text: data.body } });
        else patch({ body: event.target.value });
      }}
      placeholder={isQuote ? '这句话为什么值得留下？写几句理解……' : '记录想法，留住细节……'}
      spellCheck={false}
    />
  </section>;
}

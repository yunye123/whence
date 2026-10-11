import type { CSSProperties, RefObject } from 'react';
import { BookOpen, Check, PencilLine } from 'lucide-react';
import { useStationeryLines } from './QuoteCardBody';
import { joinLines } from './card-utils';
import type { CardBodyProps, CardLod } from './types';

interface NoteCardBodyProps extends CardBodyProps {
  /** The simple tier clamps the preview to whole lines on one run: line breaks are joined CJK-aware. */
  lod?: CardLod;
  noteEditing: boolean;
  noteRef: RefObject<HTMLTextAreaElement | null>;
  beginNoteEditing: () => void;
  finishNoteEditing: (restoreFocus?: boolean) => void;
}

const PLACEHOLDER = '一个想法、一句想留住的话……';

/**
 * Note card (PLAN §2.4): opaque WenKai paper, an optional title, no crease. The preview is a drag
 * surface that switches in place to a textarea with the same face and leading while editing.
 * Only the textarea carries `nokey`; the preview stays available to canvas multiselection.
 */
export function NoteCardBody(props: NoteCardBodyProps) {
  const { id, data, board, lod, noteEditing, noteRef, finishNoteEditing } = props;
  const preview = lod === 'simple' ? joinLines(data.body) : data.body;
  // The plain preview and textarea use identical native wrapping. Per-word wbr/tail spans would
  // change where the first line breaks on entering the native editor.
  const lines = useStationeryLines(preview || PLACEHOLDER, props.previewWidth, '400 14px "LXGW WenKai Screen"', 'char');
  const style = !noteEditing && lines !== undefined ? { '--text-natural-block': `${Math.max(1, lines) * 22}px` } as CSSProperties : undefined;
  return (
    <div className={`field-card__note-content${noteEditing ? ' nodrag nowheel' : ' card-drag-content'}`} data-text-planned={style ? '' : undefined} style={style}>
      {noteEditing ? (
        <textarea
          ref={noteRef}
          className="field-card__note-editor nodrag nowheel nokey"
          aria-label={`编辑笔记：${data.title}`}
          placeholder={PLACEHOLDER}
          value={data.body}
          maxLength={300000}
          onChange={event => board.updateCard(id, { body: event.target.value })}
          spellCheck={false}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              finishNoteEditing(true);
            }
          }}
          onBlur={event => {
            const card = event.currentTarget.closest('.field-card');
            if (!card?.contains(event.relatedTarget as globalThis.Node | null)) finishNoteEditing();
          }}
        />
      ) : (
        <div className={`field-card__note-preview${!data.body ? ' is-empty' : ''}`} data-note-preview>
          {data.body ? preview : PLACEHOLDER}
        </div>
      )}
    </div>
  );
}

/** Hover actions of a note: edit in place (or read, in a read-only window); while editing, “完成”. */
export function NoteCardActions({ data, board, activate, openCard, noteEditing, beginNoteEditing, finishNoteEditing }: NoteCardBodyProps) {
  if (noteEditing) {
    return (
      <>
        <span className="field-card__hint" aria-hidden="true">Esc 完成</span>
        <button className="field-card__chip is-text nodrag nowheel" onClick={event => activate(event, () => finishNoteEditing(true))} aria-label="完成笔记编辑">
          <Check size={14} aria-hidden="true" />完成
        </button>
      </>
    );
  }
  const reading = !!board.readOnly;
  return (
    <button
      className="field-card__chip nodrag nowheel"
      onClick={event => activate(event, reading ? openCard : beginNoteEditing)}
      aria-label={`${reading ? '展开阅读' : '编辑笔记'}：${data.title}`}
      title={reading ? '展开阅读' : '编辑笔记'}
    >
      {reading ? <BookOpen size={14} aria-hidden="true" /> : <PencilLine size={14} aria-hidden="true" />}
    </button>
  );
}

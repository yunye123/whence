import { useState, type CSSProperties, RefObject } from 'react';
import { BookOpen, Check, PencilLine } from 'lucide-react';
import { useStationeryLines } from './QuoteCardBody';
import { joinLines } from './card-utils';
import { pictureSource } from '../pictures';
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
const clampRatio = (ratio: number) => Math.min(4, Math.max(.25, ratio));

function NoteCover({ title, src, count, ratio, onRatio }: { title: string; src?: string; count: number; ratio?: number; onRatio: (ratio: number) => void }) {
  return (
    <div className="field-card__note-cover card-drag-content" style={{ '--note-cover-ratio': ratio ? String(ratio) : '3 / 4' } as CSSProperties}>
      {src ? <img
        src={src}
        alt={title}
        draggable={false}
        onLoad={event => {
          const image = event.currentTarget;
          if (image.naturalWidth && image.naturalHeight) onRatio(clampRatio(image.naturalWidth / image.naturalHeight));
        }}
      /> : <span className="field-card__note-cover-pending">正在读取图片</span>}
      {count > 1 && <span className="field-card__note-cover-count">{count} 张</span>}
    </div>
  );
}

/**
 * Note card (PLAN §2.4): opaque WenKai paper, an optional title, no crease. The preview is a drag
 * surface that switches in place to a textarea with the same face and leading while editing.
 * Only the textarea carries `nokey`; the preview stays available to canvas multiselection.
 */
export function NoteCardBody(props: NoteCardBodyProps) {
  const { id, data, board, lod, noteEditing, noteRef, finishNoteEditing } = props;
  const pictureCount = data.pictures?.length ?? 0;
  const folded = pictureCount > 0 && !noteEditing;
  const preview = folded ? '' : lod === 'simple' ? joinLines(data.body) : data.body;
  const shownTranslation = !folded && !noteEditing && lod !== 'simple' ? (data.translation?.trim() ?? '') : '';
  // The plain preview and textarea use identical native wrapping. Per-word wbr/tail spans would
  // change where the first line breaks on entering the native editor.
  const lines = useStationeryLines(preview || PLACEHOLDER, props.previewWidth, '400 14px "LXGW WenKai Screen"', 'char');
  const translationLines = useStationeryLines(shownTranslation, props.previewWidth, '400 14px "LXGW WenKai Screen"', 'char');
  const style = !noteEditing && lines !== undefined && (!shownTranslation || translationLines !== undefined)
    ? { '--text-natural-block': `${Math.max(1, lines) * 22 + (shownTranslation && translationLines ? translationLines * 22 + 6 : 0)}px` } as CSSProperties
    : undefined;
  const cover = folded ? pictureSource(data.pictures![0], board.getMediaUrl) : undefined;
  const [ratio, setRatio] = useState<number>();
  if (pictureCount > 0 && !noteEditing) {
    return <NoteCover title={data.title || '笔记'} src={cover} count={pictureCount} ratio={ratio} onRatio={setRatio} />;
  }
  return (
    <>
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
          {shownTranslation && <div className="field-card__note-translation" lang="zh-CN"><span className="field-card__note-translation-label">译文</span>{shownTranslation}</div>}
        </div>
      )}
    </div>
    </>
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
  const reading = !!board.readOnly || (data.pictures?.length ?? 0) > 0;
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

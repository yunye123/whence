import type { CardData } from '../model';
import { useBoard } from '../board-context';
import type { PatchCard } from './shared';
import { TranslationForCard } from './EnglishTranslation';

/**
 * The creator's own viewing notes for a video, kept apart from the transcript and post prose.
 * The platform description, when there is one, sits above the notes: Chinese if it was translated, otherwise the original.
 * Viewing notes use LXGW WenKai (P3), on an opaque, square-cornered note sheet.
 */
export default function VideoNotesSection({ nodeId, data, patch }: { nodeId: string; data: CardData; patch: PatchCard }) {
  const board = useBoard();
  const description = (data.translation || data.sourceDescription || '').trim();
  return <>
  {description && <section className="inspector-section watch-description">
    <h3 className="watch-notes__label">简介</h3>
    <p className="watch-description__text">{description}</p>
    <TranslationForCard data={data} surface="description" nodeId={nodeId} readOnly={!!board.readOnly} showExisting={false} update={(_id, next) => patch(next)} />
  </section>}
  <section className="inspector-section watch-notes">
    <label className="watch-notes__label" htmlFor="video-observations">观看笔记</label>
    <textarea
      id="video-observations"
      className="watch-notes__field"
      maxLength={100000}
      readOnly={board.readOnly}
      value={data.body}
      onChange={event => patch({ body: event.target.value })}
      placeholder="记下这段视频的开头、节奏或发现……"
    />
  </section>
  </>;
}

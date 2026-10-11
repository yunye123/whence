import type { CardData } from '../model';
import { useBoard } from '../board-context';
import type { PatchCard } from './shared';

/**
 * The creator's own viewing notes for a video, kept apart from the transcript and post prose.
 * Viewing notes use LXGW WenKai (P3), on an opaque, square-cornered note sheet.
 */
export default function VideoNotesSection({ data, patch }: { data: CardData; patch: PatchCard }) {
  const board = useBoard();
  return <section className="inspector-section watch-notes">
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
  </section>;
}

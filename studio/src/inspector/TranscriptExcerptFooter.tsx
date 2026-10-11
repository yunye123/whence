import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Clapperboard, PenLine } from 'lucide-react';
import type { TranscriptLine } from '../model';
import type { TripWriteMode } from '../draft-navigation';
import { useBoard } from '../board-context';
import { lineIndexAt, usePlayhead, useTranscriptView } from './video-watch';

/**
 * Transcript footer (§6.18.2, 40 high): how selecting works, select all / clear, and proofreading progress
 * “已校对 12 / 42” (D4). The excerpt button itself sits in the inline row under the selection, where the
 * drag MIME `application/x-field-quote` and `draggable` are kept (K1).
 */
export default function TranscriptExcerptFooter({ nodeId, transcript, selectedLines, setSelectedLines, setLastSelected }: {
  nodeId: string;
  transcript: TranscriptLine[];
  selectedLines: Set<string>;
  setSelectedLines: Dispatch<SetStateAction<Set<string>>>;
  setLastSelected: Dispatch<SetStateAction<number | null>>;
}) {
  const board = useBoard();
  const view = useTranscriptView(nodeId);
  // On a “补一个镜头” trip (§6.29), nothing selected: the sentence playing now can be given to the line (“配给这一行”) or
  // written in after it (“另起一行写进原话”).
  const tripLine = board.draftReturn?.insert && board.draftReturn.draftId !== nodeId && !board.readOnly && board.writeLinesToDraft ? board.draftReturn.insert : null;
  const live = board.activeVideo === nodeId;
  const currentIndex = usePlayhead(nodeId, time => (tripLine && live ? lineIndexAt(transcript, time) : -1));
  const current = currentIndex >= 0 ? transcript[currentIndex] : undefined;
  const row = tripLine?.line ? `第 ${tripLine.line} 行` : '这一行';
  const said = current ? `「${current.text.slice(0, 24)}${current.text.length > 24 ? '…' : ''}」` : '';
  const write = (mode: TripWriteMode) => { if (current) board.writeLinesToDraft!(nodeId, [current], mode); };
  const visible = view?.visibleIds ?? null;
  const corrected = useMemo(() => transcript.reduce((count, line) => count + (line.originalText !== undefined ? 1 : 0), 0), [transcript]);
  const count = selectedLines.size;
  const share = transcript.length ? Math.round((corrected / transcript.length) * 100) : 0;
  const selectAll = () => { setSelectedLines(new Set(visible ?? transcript.map(line => line.id))); setLastSelected(null); };
  const clear = () => { setSelectedLines(new Set()); setLastSelected(null); };
  return <footer className="inspector-footer inspector-excerpt-footer">
    <p className="watch-foot__hint">
      {count ? <>已选 <b className="tabular">{count}</b> 句，Shift 点击可连选</>
        : board.readOnly ? '此窗口只读，可播放、阅读与导出'
          : tripLine ? (tripLine.line ? <>为第 <b className="tabular">{tripLine.line}</b> 行挑一个镜头</> : '为这一行挑一个镜头')
            : '点句子跳到那一秒，勾选后可摘录'}
    </p>
    {count ? <button type="button" className="btn btn--sm watch-foot__select" onClick={clear}>清除选择</button>
      : tripLine ? <>
        <button type="button" className="btn btn--sm watch-foot__newline" disabled={!current}
          aria-label={current ? `把正在播放的这一句另起一行写进原话，在${row}之后` : '另起一行写进原话'}
          title={current ? `${said}另起一行写在${row}之后，然后回到脚本` : '先播放，或点一句跳到那一秒'}
          onClick={() => write('line')}>
          <PenLine size={14} aria-hidden="true" />另起一行写进原话
        </button>
        <button type="button" className="btn btn--sm btn--soft watch-foot__write" disabled={!current}
          aria-label={current ? `把正在播放的这一句配给${row}` : '配给这一行'}
          title={current ? `${said}作为${row}的画面，旁白不变，然后回到脚本` : '先播放，或点一句跳到那一秒'}
          onClick={() => write('shot')}>
          <Clapperboard size={14} aria-hidden="true" />配给这一行
        </button>
      </>
      : visible?.length === 0 ? null
        : <button type="button" className="btn btn--sm watch-foot__select" onClick={selectAll}>{visible ? `选择这 ${visible.length} 句` : '选择全部'}</button>}
    {/* Picking a shot (nothing selected), the two trip actions take the room of the proofreading progress. */}
    {!(tripLine && !count) && <span className="watch-foot__progress" title="校对过的句子，会保留原文">
      已校对<span className="tabular">{corrected} / {transcript.length}</span>
      <span className="watch-meter" role="progressbar" aria-label="校对进度" aria-valuemin={0} aria-valuemax={transcript.length} aria-valuenow={corrected}>
        <i style={{ width: `${share}%` }} />
      </span>
    </span>}
  </footer>;
}

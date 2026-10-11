import { BookOpen, LoaderCircle, RotateCcw } from 'lucide-react';
import { useBoard } from '../board-context';
import { XLogoIcon } from '../icons/field-icons';
import type { XPostView } from './x-post-view';

/**
 * Post prose with reading paragraph spacing: a blank line between paragraphs becomes a .85em gap instead of a whole
 * empty line. Every character stays in the DOM (the gap text is hidden), single line breaks stay line breaks.
 */
function PostProse({ text }: { text: string }) {
  const parts = text.split(/(\n[ \t]*\n\s*)/);
  if (parts.length === 1) return <>{text}</>;
  return <>{parts.map((part, index) => index % 2
    ? <span key={index} className="x-post-gap" aria-hidden="true">{part}</span>
    : <span key={index} className="x-post-para">{part}</span>)}</>;
}

/**
 * Post prose for an X video, set as reading text (someone else's words: the interface sans at reading size).
 * The prose must render before its actions (test-locked order); the status chip says honestly what was kept.
 */
export default function XPostSection({ nodeId, view, xPostExpanded, onExpand, rememberVisit }: {
  nodeId: string;
  view: XPostView;
  xPostExpanded: boolean;
  onExpand: () => void;
  rememberVisit: () => void;
}) {
  const board = useBoard();
  const { xPostSource, preferVideoText, xPostText, xPostPartial, xPostHasSnapshot, xPostLong, xPostPreview, xPostLoading, xPostError } = view;
  return <section className="inspector-section inspector-x-post" aria-label="推文正文" aria-busy={xPostLoading}>
    <div className="inspector-section-heading inspector-x-heading">
      <h3><XLogoIcon size={16} />推文正文</h3>
      {xPostText !== undefined && <span className={`inspector-x-chip${xPostPartial ? ' is-partial' : ''}`}>{xPostPartial ? '正文预览' : xPostHasSnapshot ? '原文快照' : '原帖卡正文'}</span>}
    </div>
    {xPostText === undefined
      ? <p className="inspector-x-post-hint">
        {xPostLoading ? '正在补全推文正文…' : board.readOnly ? '这份视频尚未保存推文正文。请在编辑窗口补全。' : '这份视频尚未保存推文正文。补全后，可以阅读与摘录原帖文字。'}
      </p>
      : xPostText.trim() ? <>
        <p className={`inspector-x-post-text${xPostLong && !xPostExpanded ? ' is-clipped' : ''}`}><PostProse text={xPostPreview ?? ''} /></p>
        {xPostPartial && <p className="inspector-x-post-hint">目前只取得正文预览，原帖可能还有内容。</p>}
        {xPostSource
          && typeof xPostSource.data.sourceOriginalText === 'string'
          && xPostSource.data.sourceOriginalText.replace(/\r\n?/g, '\n') !== xPostSource.data.body.replace(/\r\n?/g, '\n')
          && <p className="inspector-x-post-hint">原帖卡的正文已有编辑。这里显示导入时保留的原文。</p>}
      </> : <p className="inspector-x-post-hint">原帖没有文字正文，已通过公开内容服务核对。</p>}
    {xPostError && <p className="inspector-x-post-error" role="alert">{xPostError}</p>}
    <div className="inspector-x-post-actions">
      {xPostText?.trim() && (!board.readOnly && !xPostPartial || xPostSource && !preferVideoText || xPostLong && !xPostExpanded) && <button
        type="button"
        className="btn btn--soft btn--sm"
        disabled={xPostLoading}
        onClick={() => {
          if (xPostPartial || board.readOnly) {
            if (xPostSource && !preferVideoText) { rememberVisit(); board.openCard(xPostSource.id); }
            else onExpand();
          } else if (board.readXPost) board.readXPost(nodeId);
          else if (xPostSource) { rememberVisit(); board.openCard(xPostSource.id); }
          else onExpand();
        }}
      >
        <BookOpen size={14} aria-hidden="true" />
        {xPostPartial && (!xPostSource || preferVideoText)
          ? '展开已缓存正文'
          : board.readOnly ? xPostLong && !xPostExpanded ? '阅读全文' : '阅读已缓存正文' : xPostPartial ? '阅读已缓存正文并摘录' : '阅读全文并摘录'}
      </button>}
      {(xPostText === undefined || xPostPartial) && <button
        type="button"
        className="btn btn--line btn--sm"
        disabled={board.readOnly || xPostLoading || !board.readXPost}
        onClick={() => board.readXPost?.(nodeId)}
      >
        {xPostLoading ? <LoaderCircle size={14} className="inspector-is-processing" aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
        {xPostLoading ? '正在补全正文' : '补全推文正文'}
      </button>}
    </div>
    {xPostPartial && board.readOnly && <p className="inspector-x-post-hint">此窗口只读，可阅读已缓存内容。补全正文请回到编辑窗口。</p>}
  </section>;
}

import { AlertTriangle, ArrowUpRight, CheckCheck, LoaderCircle, Pause } from 'lucide-react';
import { importStatusLabel, pendingImport, videoPlatform } from '../app/video-links';
import type { ImportEntry } from '../app/types';
import type { VideoImportStatus } from '../model';

export interface VideoImportsDialogProps {
  entries: ImportEntry[];
  readOnly: boolean;
  videoAvailable: boolean;
  /** A cancel / retry for this card is already in flight. */
  isActionPending: (nodeId: string) => boolean;
  onGoToCard: (boardId: string, nodeId: string) => void;
  onCancel: (nodeId: string) => void;
  onRetry: (nodeId: string) => void;
}

const unfinished = (status: VideoImportStatus) => status === 'failed' || status === 'interrupted' || status === 'cancelled';

/** IM-M2：未完成的任务不再挂着“正在导入”，标题写成“导入未完成 · 原标题”。 */
export function importRowTitle(title: string, status: VideoImportStatus, url: string): string {
  const base = title.replace(/^正在导入 · /, '').trim() || videoPlatform(url);
  if (status === 'failed' || status === 'interrupted') return `导入未完成 · ${base}`;
  if (pendingImport(status) && !title.trim()) return `正在导入 · ${videoPlatform(url)}`;
  return title.trim() || base;
}

function StatusIcon({ status }: { status: VideoImportStatus }) {
  if (pendingImport(status)) return <LoaderCircle size={17} className="spin" aria-hidden="true"/>;
  if (status === 'completed') return <CheckCheck size={17} aria-hidden="true"/>;
  if (status === 'cancelled') return <Pause size={17} aria-hidden="true"/>;
  return <AlertTriangle size={17} aria-hidden="true"/>;
}

/** Content of the “视频导入任务” modal (rendered inside ModalShell). */
export default function VideoImportsDialog({ entries, readOnly, videoAvailable, isActionPending, onGoToCard, onCancel, onRetry }: VideoImportsDialogProps) {
  const running = entries.filter(entry => pendingImport(entry.task.status)).length;
  const attention = entries.filter(entry => entry.task.status === 'failed' || entry.task.status === 'interrupted').length;
  return (
    <>
      <header className="modal-header">
        <h2 id="modal-title" className="modal-title">视频导入任务</h2>
        <p className="modal-subtitle vit-summary">
          {running > 0 && <span>{running} 个处理中</span>}
          {attention > 0 && <span className="vit-summary__attention">{attention} 个需要处理</span>}
          {!running && !attention && <span>任务回到创建它的画布。下载好就能先播放。</span>}
        </p>
      </header>
      <div className="modal-body">
        <div className="video-import-list">
          {entries.slice(0,100).map(({board:target,node,task})=>{
            const retryReason = readOnly ? '当前窗口只读' : !videoAvailable ? '重新导入需要来处桌面版' : '';
            return (
              <article key={node.id} className={`video-import-row is-${task.status}${unfinished(task.status) ? ' is-unfinished' : ''}`} data-testid={`video-import-task-${node.id}`}>
                <div className="video-import-row-heading">
                  <span className="vit-icon"><StatusIcon status={task.status}/></span>
                  <div><strong>{importRowTitle(node.data.title, task.status, task.url)}</strong><small>{target.title} · {videoPlatform(task.url)}</small></div>
                  <span className="video-import-state">{importStatusLabel[task.status]}</span>
                </div>
                {(task.error||task.message) && <p className="video-import-row-message">{task.error||task.message}</p>}
                {pendingImport(task.status)&&task.progress!==undefined&&(
                  <div className="video-import-meter" role="progressbar" aria-label={`${node.data.title} 导入进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(task.progress)}><span style={{width:`${Math.max(0,Math.min(100,task.progress))}%`}}/></div>
                )}
                <div className="video-import-row-actions">
                  <span>{task.mediaReady?'视频已可播放':(task.status!=='completed'&&!pendingImport(task.status)&&retryReason)||''}</span>
                  <button type="button" className="btn btn--sm" onClick={()=>onGoToCard(target.id,node.id)}>前往卡片<ArrowUpRight size={13} aria-hidden="true"/></button>
                  {pendingImport(task.status)
                    ?<button type="button" className="btn btn--sm btn--line" disabled={readOnly||isActionPending(node.id)} onClick={()=>onCancel(node.id)}>取消任务</button>
                    :task.status!=='completed'
                      ?<button type="button" className="btn btn--sm btn--line" disabled={readOnly||isActionPending(node.id)||!videoAvailable} title={retryReason||undefined} onClick={()=>onRetry(node.id)}>{task.mediaReady?'继续提取逐字稿':'重新导入'}</button>
                      :null}
                </div>
              </article>
            );
          })}
          {!entries.length && <p className="dialog-hint">还没有视频导入任务。</p>}
        </div>
      </div>
    </>
  );
}

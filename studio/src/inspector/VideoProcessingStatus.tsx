import { CheckCircle2, CircleAlert, CirclePause, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { CardData, TranscriptLine, VideoImportStatus } from '../model';
import { useBoard } from '../board-context';

const importStatusLabels: Record<VideoImportStatus, string> = {
  queued: '已加入处理队列', downloading: '正在下载视频', transcribing: '正在生成逐字稿',
  completed: '视频处理完成', failed: '处理未完成', cancelled: '处理已取消', interrupted: '处理已中断',
};

/**
 * Download/transcription task status and the stored-media notice. Each state is said once, here, with its one next
 * step (§6.8 失败 / 导入中); the player and the transcript do not repeat it. A local transcription started in this
 * window (no task) is reported by the transcript column instead, where its sentences will appear (TranscriptPanel).
 */
export default function VideoProcessingStatus({ nodeId, data, transcript, videoUrl, importBusy, canRetryImport, importActionPending, nativeTranscribeBusy }: {
  nodeId: string;
  data: CardData;
  transcript: TranscriptLine[];
  videoUrl?: string;
  importBusy: boolean;
  canRetryImport: boolean;
  importActionPending: boolean;
  nativeTranscribeBusy: boolean;
}) {
  const board = useBoard();
  const videoImport = data.videoImport;
  const savedMediaWarning = typeof data.nativeMediaWarning === 'string' ? data.nativeMediaWarning.trim() : '';
  const nativeMediaWarning = savedMediaWarning && data.url?.startsWith('field-media://')
    ? '素材存放于此画布目录。需要携带大视频时，请另存完整画布目录。'
    : savedMediaWarning;
  const importProgress = typeof videoImport?.progress === 'number' && Number.isFinite(videoImport.progress) ? Math.max(0, Math.min(100, videoImport.progress)) : undefined;
  const importTitle = videoImport?.status === 'completed' && transcript.length ? '视频与逐字稿已就绪' : videoImport ? importStatusLabels[videoImport.status] : '';
  const ImportStateIcon = importBusy ? LoaderCircle : videoImport?.status === 'completed' ? CheckCircle2 : videoImport?.status === 'failed' ? CircleAlert : CirclePause;
  return <>
    {videoImport && <section className={`inspector-import-status inspector-import-status--${videoImport.status}`} aria-label="视频处理状态" aria-busy={importBusy}>
      <div className="inspector-import-heading">
        <ImportStateIcon size={16} className={importBusy ? 'inspector-is-processing' : ''} aria-hidden="true" />
        <strong>{importTitle}</strong>
        {importBusy && importProgress !== undefined && <span className="tabular">{Math.round(importProgress)}%</span>}
      </div>
      <p role="status">{videoImport.message || (importBusy ? '可以继续整理画布，处理完会在这里更新。' : '任务状态已更新。')}</p>
      {videoImport.error && videoImport.error !== videoImport.message && <p className="inspector-import-error">{videoImport.error}</p>}
      {importBusy && importProgress !== undefined && <progress value={importProgress} max={100} aria-label="视频处理进度" />}
      {importBusy && videoUrl && <p className="inspector-import-detail">视频已就绪，可以先播放、记录观看笔记。</p>}
      {(importBusy || canRetryImport) && <div className="inspector-import-actions">
        {importBusy && <button
          type="button"
          className="btn btn--sm btn--line"
          disabled={board.readOnly || !board.videoImportAvailable || importActionPending}
          onClick={() => board.cancelVideoImport(nodeId)}
        ><X size={14} aria-hidden="true" />{importActionPending ? '正在取消' : '取消处理'}</button>}
        {canRetryImport && <button
          type="button"
          className="btn btn--sm btn--line"
          disabled={board.readOnly || !board.videoImportAvailable || nativeTranscribeBusy || importActionPending}
          onClick={() => board.retryVideoImport(nodeId)}
        ><RotateCcw size={14} aria-hidden="true" />{importActionPending ? '正在重试' : '重试'}</button>}
        {!board.videoImportAvailable && <span>请在桌面版继续处理</span>}
      </div>}
    </section>}
    {nativeMediaWarning && <p className="inspector-native-warning" role="status">{nativeMediaWarning}</p>}
  </>;
}

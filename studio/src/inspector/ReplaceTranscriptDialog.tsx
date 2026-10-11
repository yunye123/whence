import InspectorDialog from '../InspectorDialog';

/** Replacing an existing transcript always asks first; existing quotes keep their captured text (contract B9 / K9-17). */
export default function ReplaceTranscriptDialog({ action, busy, onCancel, onConfirm }: {
  action: 'subtitles' | 'transcribe';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <InspectorDialog title={action === 'subtitles' ? '替换现有逐字稿' : '重新转写这个视频'} className="watch-replace-dialog" onCancel={onCancel}>
    <p className="inspector-dialog-description">
      {action === 'subtitles' ? '新字幕导入成功后，将替换这份逐字稿中的文字与手动校对。' : '转写成功后，将替换当前逐字稿中的文字与手动校对。'}画布中已有的摘录会保留当时的文字。
    </p>
    <p className="watch-correct__note">需要保留当前校对稿，可以先取消并导出全文 TXT 或 SRT。</p>
    {busy && <p className="watch-correct__error" role="status">已有任务正在处理这份逐字稿，请等待完成。</p>}
    <footer>
      <button type="button" className="btn btn--line" data-autofocus onClick={onCancel}>取消</button>
      <button type="button" className="btn btn--primary" disabled={busy} onClick={onConfirm}>{action === 'subtitles' ? '选择新字幕' : '确认重新转写'}</button>
    </footer>
  </InspectorDialog>;
}

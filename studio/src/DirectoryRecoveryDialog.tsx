import { FolderOpen, ShieldCheck } from 'lucide-react';
import InspectorDialog from './InspectorDialog';
import type { BoardRecoveryAvailable } from '../native/board-storage';

/** 目录画布打不开时，提供通过完整性检查的上一版（§6.20：确认按钮是对话框里唯一的墨色实底，默认聚焦“取消”）。 */
export default function DirectoryRecoveryDialog({ recovery, onDecision }: { recovery: BoardRecoveryAvailable; onDecision: (accepted: boolean) => void }) {
  const savedAt = new Date(recovery.savedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return <InspectorDialog title="找到可以恢复的上一版" className="directory-recovery-dialog" onCancel={() => onDecision(false)} closeLabel="取消恢复">
    <div className="directory-recovery-content">
      <div className="directory-recovery-board">
        <span className="directory-recovery-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
        <div><h3>{recovery.title || '未命名画布'}</h3><p>当前文件无法打开。上一版的画布和素材已通过完整性检查。</p></div>
      </div>
      <dl><div><dt>上一版保存时间</dt><dd className="tabular">{savedAt}</dd></div><div><dt>当前文件的问题</dt><dd>{recovery.reason}</dd></div></dl>
      <p className="directory-recovery-note">恢复会在选定的位置建立独立副本。原文件和当前工作区都会保留。</p>
      <div className="directory-recovery-actions"><button type="button" className="btn btn--line" data-autofocus onClick={() => onDecision(false)}>取消</button><button type="button" className="btn btn--primary" onClick={() => onDecision(true)}><FolderOpen size={16} aria-hidden="true" />恢复上一版为副本</button></div>
    </div>
  </InspectorDialog>;
}

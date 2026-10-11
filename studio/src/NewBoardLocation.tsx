import { useId } from 'react';
import { FolderOpen, HardDrive, X } from 'lucide-react';
import type { DirectoryChoice } from '../native/board-storage';

/**
 * 新画布的保存位置（F-m1）。桌面版是一个可选的文件夹按钮；浏览器里收成一行说明，
 * 不展示一个按不下去的选择器。两种形态都保留 `选择画布保存文件夹` 与 `.directory-path`。
 */
export default function NewBoardLocation({ location, error, disabled, onChoose, onClear }: { location: DirectoryChoice | null; error: string; disabled: boolean; onChoose(): void; onClear(): void }) {
  const available = typeof window !== 'undefined' && !!window.fieldBoardStorage;
  const id = useId();
  const errorId = `${id}-error`;
  if (!available) {
    return <div className="new-board-location is-compact" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="dialog-label">保存位置</span>
      <p className="new-board-location__line">
        <HardDrive size={14} aria-hidden="true"/>
        <span className="directory-path">本机浏览器工作区</span>
        <span className="new-board-location__why">选择自己的文件夹需要桌面版</span>
      </p>
      {error && <p id={errorId} className="dialog-error" role="alert">{error}</p>}
    </div>;
  }
  return <div className="new-board-location" role="group" aria-labelledby={`${id}-label`}>
    <span id={`${id}-label`} className="dialog-label">保存位置</span>
    <div className="directory-picker">
      <button type="button" className="new-board-location__choose" disabled={disabled} onClick={onChoose} aria-label="选择画布保存文件夹" aria-describedby={`${id}-hint${error ? ` ${errorId}` : ''}`} title={location?.directory || '选择保存文件夹；不选择则使用默认的本机工作区'}>
        <FolderOpen size={16} aria-hidden="true"/>
        <span className="directory-path">{location?.directory || '默认本机工作区'}</span>
        <span className="new-board-location__action">{location ? '更换' : '选择文件夹'}</span>
      </button>
      {location && <button type="button" className="directory-clear icon-btn" disabled={disabled} aria-label="使用默认存储位置" title="使用默认存储位置" onClick={onClear}><X size={14} aria-hidden="true"/></button>}
    </div>
    <p id={`${id}-hint`} className="dialog-hint">{location ? '会在这里建一个独立的画布文件夹，内容和素材自动保存进去。' : '不选择就放在默认的本机工作区。'}</p>
    {error && <p id={errorId} className="dialog-error" role="alert"><HardDrive size={14} aria-hidden="true"/>{error}</p>}
  </div>;
}

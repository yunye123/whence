import { useEffect, useRef, type KeyboardEvent } from 'react';
import { HardDrive, LoaderCircle } from 'lucide-react';
import type { TemplateId } from '../model';
import type { DirectoryChoice } from '../../native/board-storage';
import NewBoardLocation from '../NewBoardLocation';
import { useModalControls } from '../shell/ModalShell';
import TemplatePreview from './TemplatePreview';

/** 不默认偏向任何一类用户（F-M1）：空白画布排第一、默认选中；三种起点按写作、视频、创意排列。 */
export const BOARD_TEMPLATES: readonly { id: TemplateId; name: string; description: string }[] = [
  { id: 'blank', name: '空白画布', description: '从第一张卡片开始' },
  { id: 'writing', name: '深度写作', description: '素材、问题与文稿' },
  { id: 'video', name: '视频创作', description: '视频、笔记与脚本' },
  { id: 'design', name: '视觉灵感', description: '四个分组和设计意图' },
];

export interface NewBoardDialogProps {
  name: string;
  onName: (name: string) => void;
  template: TemplateId;
  onTemplate: (template: TemplateId) => void;
  directory: DirectoryChoice | null;
  directoryError: string;
  creating: boolean;
  readOnly: boolean;
  onChooseDirectory: () => void;
  onClearDirectory: () => void;
  onCreate: () => void;
}

/** Content of the “新建画布” modal (rendered inside ModalShell): pick a starting layout, name it, Enter creates. */
export default function NewBoardDialog({ name, onName, template, onTemplate, directory, directoryError, creating, readOnly, onChooseDirectory, onClearDirectory, onCreate }: NewBoardDialogProps) {
  const modal = useModalControls();
  const group = useRef<HTMLDivElement>(null);
  // 每次打开都从“空白画布”开始（App 的初始值仍是 'video'，见集成请求），只在挂载时校正一次。
  const initialTemplate = useRef(template);
  useEffect(() => { if (initialTemplate.current !== 'blank') onTemplate('blank'); }, []);

  const known = BOARD_TEMPLATES.some(item => item.id === template) ? template : 'blank';
  const canCreate = !creating && !readOnly;
  const submit = () => { if (canCreate) onCreate(); };

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? BOARD_TEMPLATES.length - 1 : null;
    if (!step && jump === null) return;
    event.preventDefault();
    const next = jump ?? (index + step + BOARD_TEMPLATES.length) % BOARD_TEMPLATES.length;
    onTemplate(BOARD_TEMPLATES[next].id);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <form className="modal-form new-board-dialog" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
      <header className="modal-header">
        <h2 id="modal-title" className="modal-title">新建画布</h2>
      </header>
      <div className="modal-body">
        <p className="dialog-section-title" id="new-board-template-label">先选一个起点</p>
        <div className="template-grid nb-templates" role="radiogroup" aria-labelledby="new-board-template-label" ref={group}>
          {BOARD_TEMPLATES.map((item, index) => {
            const selected = known === item.id;
            return (
              <button type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} key={item.id}
                className={`template-card${selected ? ' selected' : ''}`} disabled={creating}
                onClick={() => onTemplate(item.id)} onKeyDown={event => moveSelection(event, index)}>
                <TemplatePreview template={item.id}/>
                <span className="nb-template-copy"><strong>{item.name}</strong><span>{item.description}</span></span>
              </button>
            );
          })}
        </div>
        <label className="dialog-field nb-name">
          <span>画布名称</span>
          {/* 读屏名“新画布名称”：与顶栏的“画布名称”区分开（KB-m1、§8.3 #27）；可见标签不变。 */}
          <input aria-label="新画布名称" autoFocus disabled={creating} placeholder="给这块画布起个名字" value={name} maxLength={100} enterKeyHint="done"
            onChange={event => onName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); } }}/>
        </label>
        <NewBoardLocation location={directory} error={directoryError} disabled={creating} onChoose={onChooseDirectory} onClear={onClearDirectory}/>
        {readOnly && <p className="dialog-hint nb-readonly" role="status">此窗口只读，可阅读已缓存内容。</p>}
      </div>
      <footer className="modal-footer">
        <span className="modal-footer-hint"><HardDrive size={14} aria-hidden="true"/>保存到本机<span className="nb-enter"><kbd>Enter</kbd> 创建</span></span>
        {modal && <button type="button" className="btn btn--line" disabled={modal.locked} onClick={modal.close}>取消</button>}
        <button type="submit" className="btn btn--primary nb-create" disabled={!canCreate} title={readOnly ? '当前窗口只读' : undefined}>
          {creating && <LoaderCircle className="spin" size={16} aria-hidden="true"/>}
          {creating ? '正在创建…' : '创建画布'}
        </button>
      </footer>
    </form>
  );
}

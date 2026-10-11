import { useEffect, useState, type CSSProperties } from 'react';
import { Link2, Upload } from 'lucide-react';
import { NoteIcon } from '../icons/field-icons';
import { getCanvasSafeInsets, type SafeInsets } from '../canvas/safe-area';

export interface EmptyCanvasProps {
  readOnly: boolean;
  /** Opens the import dialog (fallback for the two import buttons until App wires the direct actions). */
  onImport: () => void;
  onAddNote: () => void;
  /** The board's name, shown as the place name (§6.25). */
  title?: string;
  /** “本机文件”：直接打开文件选择（与添加菜单“本机文件…”、导入对话框“本机文件”同一个词，§8.1）。 */
  onPickFiles?: () => void;
  /** “粘贴链接”：打开导入对话框的网页链接页。 */
  onPasteLink?: () => void;
}

const ZERO: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * 空画布（§6.25，SB-M2）：画布名作“地名”，写在可见画布的正中（扣掉顶栏、工具条、面板等浮层），
 * 下面一句该做什么，再给三个纸片动作。整层只有按钮接收指针，不拦截画布的拖放和双击。
 */
export default function EmptyCanvas({ readOnly, onImport, onAddNote, title, onPickFiles, onPasteLink }: EmptyCanvasProps) {
  const [insets, setInsets] = useState<SafeInsets>(ZERO);
  // App 传入画布名之前，先读顶栏画布名输入框（K3 testid board-title）作为兜底，并跟着改名更新。
  const [fallbackTitle, setFallbackTitle] = useState('');
  // 每次 App 重绘（改名、切换画布）后读一次；值相同时 setState 不会再触发重绘。
  useEffect(() => {
    if (title !== undefined) return;
    const input = document.querySelector<HTMLInputElement>('[data-testid="board-title"]');
    if (input) setFallbackTitle(input.value);
  });
  useEffect(() => {
    const update = () => setInsets(getCanvasSafeInsets());
    update();
    const frame = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    const canvas = document.querySelector<HTMLElement>('.flow-container');
    if (canvas) observer.observe(canvas);
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const style = { '--empty-top': `${insets.top}px`, '--empty-right': `${insets.right}px`, '--empty-bottom': `${insets.bottom}px`, '--empty-left': `${insets.left}px` } as CSSProperties;
  return (
    <div className="empty-canvas" style={style}>
      <div className="empty-canvas__inner">
        <h2 className="empty-canvas__place" title={(title ?? fallbackTitle).trim() || '未命名画布'}>{(title ?? fallbackTitle).trim() || '未命名画布'}</h2>
        <p className="empty-canvas__lead">这页还空着。把文件拖进来，或按 N 记下第一条笔记。</p>
        <div className="empty-canvas__actions">
          <button type="button" className="btn btn--line" disabled={readOnly} onClick={() => onAddNote()}><NoteIcon size={16}/>笔记<kbd>N</kbd></button>
          <button type="button" className="btn btn--line" disabled={readOnly} onClick={() => (onPickFiles ?? onImport)()}><Upload size={16} strokeWidth={1.75} aria-hidden="true"/>本机文件</button>
          <button type="button" className="btn btn--line" disabled={readOnly} onClick={() => (onPasteLink ?? onImport)()}><Link2 size={16} strokeWidth={1.75} aria-hidden="true"/>粘贴链接</button>
        </div>
        {readOnly && <p className="empty-canvas__readonly">此窗口只读，可阅读已缓存内容。</p>}
      </div>
    </div>
  );
}

import { useCallback, useMemo } from 'react';
import { ClipboardPaste, Scan, Upload } from 'lucide-react';
import { DraftIcon, GroupIcon, NoteIcon } from '../icons/field-icons';
import { Menu, MenuItem, MenuSeparator, type MenuCloseReason } from '../components/Menu';
import { keyOf } from '../components/shortcut-keys';

export interface CanvasContextMenuProps {
  /** Screen position of the right click. */
  x: number;
  y: number;
  /** Creates the card at the pointer. */
  onAddCard: (kind: 'note' | 'draft' | 'frame') => void;
  onImport: () => void;
  onFit: () => void;
  /** Closes the menu. Without it the menu asks App to close through its page-level Escape (K9-4). */
  onClose?: () => void;
  /** “从剪贴板粘贴” through App's paste router; the item is hidden without it. */
  onPaste?: () => void;
  readOnly?: boolean;
}

/** App closes the menu on Escape (dialog → context menu → panel); replay one when App gave no onClose. */
const askAppToClose = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));

/**
 * Right-click menu on the empty canvas (DESIGN_SYSTEM.md §6.21, CV-m1): portal on body, fixed 14px type,
 * role=menu with full keyboard support, flips at the viewport edges by its real size.
 */
export default function CanvasContextMenu({ x, y, onAddCard, onImport, onFit, onClose, onPaste, readOnly = false }: CanvasContextMenuProps) {
  const anchor = useMemo(() => ({ x, y }), [x, y]);
  const close = useCallback((reason: MenuCloseReason) => {
    if (onClose) onClose();
    else if (reason !== 'select') askAppToClose(); // Item handlers in App already close it.
  }, [onClose]);
  const locked = readOnly ? '只读窗口' : undefined;
  return (
    <Menu label="画布操作" anchor={anchor} onClose={close} minWidth={220} className="field-menu--canvas">
      {/* One verb with the “添加” menu (§8.1): 添加笔记 / 添加文稿 / 添加分组; “分组区域” is only the K4 accessible name. */}
      <MenuItem icon={<NoteIcon size={16}/>} label="添加笔记" shortcut={keyOf('add-note', 'N')} disabled={readOnly} reason={locked} onSelect={() => onAddCard('note')}/>
      <MenuItem icon={<DraftIcon size={16}/>} label="添加文稿" shortcut={keyOf('add-draft', 'T')} disabled={readOnly} reason={locked} onSelect={() => onAddCard('draft')}/>
      <MenuItem icon={<GroupIcon size={16}/>} label="添加分组" ariaLabel="添加分组区域" shortcut={keyOf('add-frame', 'G')} disabled={readOnly} reason={locked} onSelect={() => onAddCard('frame')}/>
      <MenuSeparator/>
      {onPaste && <MenuItem icon={<ClipboardPaste size={16} strokeWidth={1.75}/>} label="从剪贴板粘贴" shortcut={keyOf('paste', 'Ctrl V')} disabled={readOnly} reason={locked} onSelect={() => onPaste()}/>}
      <MenuItem icon={<Upload size={16} strokeWidth={1.75}/>} label="导入素材…" disabled={readOnly} reason={locked} onSelect={() => onImport()}/>
      <MenuSeparator/>
      <MenuItem icon={<Scan size={16} strokeWidth={1.75}/>} label="查看全部" shortcut={keyOf('fit', 'F')} onSelect={() => onFit()}/>
    </Menu>
  );
}

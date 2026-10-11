import { Check, CircleAlert, FolderOpen, LayoutPanelTop, ListTree, LoaderCircle, Lock, PanelLeftClose, PanelLeftOpen, Redo2, Undo2, Upload, Video } from 'lucide-react';
import type { Board } from '../model';
import type { CanvasView, SaveStatus } from '../app/types';
import { saveFailureCopy } from './StatusBanners';

export interface TopBarProps {
  board: Board;
  readOnly: boolean;
  saveStatus: SaveStatus;
  saveError: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /**
   * 集成后为 true：侧栏品牌行自带“收起侧栏”，顶栏只在侧栏隐藏时显示“展开侧栏”。
   * 未集成（默认 false）时顶栏照旧在两种状态下都显示切换按钮，保证侧栏始终能收起。
   */
  sidebarHasCollapse?: boolean;
  /** Renames the board; the caller merges consecutive edits into one undo step. */
  onRename: (title: string) => void;
  onRevealStorage: () => void;
  /**
   * Kept for the callers: a failed save is retried from the canvas banner (“重试保存”, the one main action, polish round 4
   * P7) and, in full-window layouts, from their own notices; the top bar only reports the state.
   */
  onRetrySave?: () => void;
  view: CanvasView;
  onViewChange: (view: CanvasView) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  importTaskCount: number;
  activeImportCount: number;
  /** 失败或中断、需要人处理的视频导入任务数（可选；未传时不区分）。 */
  attentionImportCount?: number;
  onOpenImports: () => void;
  /** @deprecated 顶栏不再放“导入素材”（C1）；唯一入口在画布工具条的“添加”菜单。 */
  onOpenImport?: () => void;
  onOpenExport: () => void;
}

function SaveIndicator({ board, saveStatus, saveError }: Pick<TopBarProps, 'board' | 'saveStatus' | 'saveError'>) {
  const pending = saveStatus === 'loading' || saveStatus === 'saving';
  const text = saveStatus === 'loading' ? '读取中' : saveStatus === 'saving' ? '保存中'
    : saveStatus === 'error' ? '保存失败' : saveStatus === 'readonly' ? '只读窗口'
      : board.storage ? '已保存到本机文件夹' : '已保存到本机';
  const detail = saveStatus === 'loading' ? '正在读取本机画布内容'
    : saveStatus === 'readonly' ? '只读窗口，不会改写工作区'
    : saveStatus === 'saving' ? '正在核对并保存最新内容'
      : saveStatus === 'error' ? saveFailureCopy(saveError).message
        : board.storage ? `已保存到 ${board.storage.directory}` : '内容保存在本机的来处工作区';
  // K3/C4：状态始终是文字；窄窗只在视觉上收起文字。重试仅在画布横幅里。
  return (
    <span data-testid="save-status" role="status" className={`save-status is-${saveStatus}`} title={detail}>
      {pending ? <LoaderCircle className="save-status__icon spin" size={14} strokeWidth={2} aria-hidden="true" />
        : saveStatus === 'error' ? <CircleAlert className="save-status__icon" size={14} strokeWidth={1.75} aria-hidden="true" />
          : saveStatus === 'readonly' ? <Lock className="save-status__icon" size={14} strokeWidth={1.75} aria-hidden="true" />
            : <Check className="save-status__icon" size={14} strokeWidth={2} aria-hidden="true" />}
      <span className="save-status__text">{text}</span>
    </span>
  );
}

/** 顶栏（§6.3，banner 地标）：画布名、保存状态、导入任务；撤销重做、画布 / 大纲、导出。 */
export default function TopBar({ board, readOnly, saveStatus, saveError, sidebarOpen, onToggleSidebar, sidebarHasCollapse = false, onRename, onRevealStorage, view, onViewChange, canUndo, canRedo, onUndo, onRedo, importTaskCount, activeImportCount, attentionImportCount = 0, onOpenImports, onOpenExport }: TopBarProps) {
  const showToggle = !sidebarOpen || !sidebarHasCollapse;
  const taskCount = activeImportCount || attentionImportCount || importTaskCount;
  const taskText = activeImportCount ? ' 个处理中' : attentionImportCount ? ' 个需要处理' : ' 个视频任务';
  const taskDetail = [activeImportCount ? `${activeImportCount} 个视频处理中` : '', attentionImportCount ? `${attentionImportCount} 个视频导入需要处理` : ''].filter(Boolean).join('；') || `${importTaskCount} 个视频任务`;
  return (
    <header className={`topbar${showToggle ? ' has-toggle' : ''}`}>
      <div className="topbar-left">
        {showToggle && (
          <button type="button" className="icon-btn sidebar-toggle" aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} title={sidebarOpen ? '收起侧栏' : '展开侧栏'} aria-expanded={sidebarOpen} onClick={() => onToggleSidebar()}>
            {sidebarOpen ? <PanelLeftClose size={16} strokeWidth={1.75} /> : <PanelLeftOpen size={16} strokeWidth={1.75} />}
          </button>
        )}
        <input data-testid="board-title" aria-label="画布名称" className="board-title" value={board.title} title={board.title || '未命名画布'} placeholder="未命名画布" disabled={readOnly} onChange={e => onRename(e.target.value)} maxLength={100} spellCheck={false} />
        {board.storage && (
          <button type="button" className="icon-btn icon-btn--sm storage-folder-button" aria-label="打开画布存储文件夹" title={board.storage.directory} onClick={() => onRevealStorage()}><FolderOpen size={15} strokeWidth={1.75} /></button>
        )}
        <SaveIndicator board={board} saveStatus={saveStatus} saveError={saveError} />
        {importTaskCount > 0 && (
          <button
            type="button"
            className={`btn btn--sm video-import-activity${activeImportCount ? ' is-active' : attentionImportCount ? ' is-attention' : ''}`}
            aria-label="查看视频导入任务"
            title={taskDetail}
            onClick={() => onOpenImports()}
          >
            {activeImportCount ? <LoaderCircle className="spin" size={14} strokeWidth={2} aria-hidden="true" /> : attentionImportCount ? <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" /> : <Video size={14} strokeWidth={1.75} aria-hidden="true" />}
            <span className="video-import-activity__count">{taskCount}</span><span className="video-import-activity__text">{taskText}</span>
          </button>
        )}
      </div>
      <div className="topbar-actions">
        <div className="history-actions">
          <button type="button" className="icon-btn" title="撤销 (Ctrl+Z)" aria-label="撤销" disabled={!canUndo || readOnly} onClick={() => onUndo()}><Undo2 size={16} strokeWidth={1.75} /></button>
          <button type="button" className="icon-btn" title="重做 (Ctrl+Shift+Z)" aria-label="重做" disabled={!canRedo || readOnly} onClick={() => onRedo()}><Redo2 size={16} strokeWidth={1.75} /></button>
        </div>
        <span className="topbar-rule" aria-hidden="true" />
        <div className="seg view-switch" role="group" aria-label="视图">
          <button type="button" className={`seg__item${view === 'canvas' ? ' active' : ''}`} aria-pressed={view === 'canvas'} onClick={() => onViewChange('canvas')}><LayoutPanelTop size={14} strokeWidth={1.75} aria-hidden="true" /><span>画布</span></button>
          <button type="button" className={`seg__item${view === 'outline' ? ' active' : ''}`} aria-pressed={view === 'outline'} onClick={() => onViewChange('outline')}><ListTree size={14} strokeWidth={1.75} aria-hidden="true" /><span>大纲</span></button>
        </div>
        <button type="button" className="btn btn--line export-trigger" aria-label="导出作品" onClick={() => onOpenExport()}><Upload size={16} strokeWidth={1.75} aria-hidden="true" /><span>导出</span></button>
      </div>
    </header>
  );
}

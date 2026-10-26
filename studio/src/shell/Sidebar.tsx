import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleHelp, KeyRound, Search, Wrench } from 'lucide-react';
import { requestTranslationSettings } from '../app/translation-settings-open';
import { requestMediaTools } from '../app/media-tools-open';
import type { Board, Workspace } from '../model';
import BoardLibrary from '../BoardLibrary';
import ThemeControl from '../ThemeControl';
import MaterialsLibrary, { type LibraryFacet } from './MaterialsLibrary';
import { MarkIcon, Wordmark } from '../icons/field-icons';
import { keyOf } from '../components/shortcut-keys';

export interface SidebarProps {
  open: boolean;
  workspace: Workspace;
  board: Board;
  readOnly: boolean;
  /** A background operation is running; board management is paused. */
  busy: boolean;
  selectedIds: string[];
  /** 会话内四组目录筛选（PLAN §2.8），由 App 持有并交给 useFlowNodes 压暗其余卡片；不存入画布。 */
  facet?: LibraryFacet;
  onFacet?: (facet: LibraryFacet) => void;
  onSearch: () => void;
  onSwitchBoard: (id: string) => void;
  onNewBoard: () => void;
  onChangeWorkspace: (change: (workspace: Workspace) => Workspace) => void;
  /** 画布“…”菜单：重命名走画布历史（可撤销）；复制、导出需要 App 实现，未传时不显示对应菜单项。 */
  onRenameBoard?: (id: string, title: string) => void;
  onDuplicateBoard?: (id: string) => void;
  onExportBoard?: (id: string) => void;
  onRevealCard: (id: string) => void;
  onOpenCard: (id: string) => void;
  /** 品牌行的“收起侧栏”。未传时不渲染，收起由顶栏按钮完成；窄窗抽屉的遮罩与 Esc 则借用顶栏按钮。 */
  onToggleSidebar?: () => void;
  /** @deprecated 添加素材的唯一入口在画布工具条（IM-M1）。 */
  onImport?: () => void;
  onHelp: () => void;
}

/** 未集成 onToggleSidebar 时，遮罩与 Esc 借用顶栏的切换按钮收起抽屉，避免窄窗下被抽屉困住。 */
function collapse(onToggleSidebar?: () => void) {
  if (onToggleSidebar) onToggleSidebar();
  else document.querySelector<HTMLButtonElement>('.topbar .sidebar-toggle')?.click();
}

/**
 * 工作区导航（§6.2）：品牌、搜索、画布树、本画布卡片列表、外观与帮助。
 * 阅读拆分时（§5.1、§6.18.3）收成 56px 窄轨：标志、展开、搜索、使用指南；窄轨由样式按阅读布局切换，
 * 不改侧栏的开合状态。“展开侧栏”把整条侧栏临时浮在画布条上（不挤阅读面板），点到外面或按 Esc 收回窄轨。
 */
export default function Sidebar({ open, workspace, board, readOnly, busy, selectedIds, facet, onFacet, onSearch, onSwitchBoard, onNewBoard, onChangeWorkspace, onRenameBoard, onDuplicateBoard, onExportBoard, onRevealCard, onOpenCard, onToggleSidebar, onHelp }: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null);
  const [railOpen, setRailOpen] = useState(false);
  const railOpenRef = useRef(railOpen);
  railOpenRef.current = railOpen;
  useEffect(() => {
    if (!railOpen) return;
    const close = (event: PointerEvent) => { if (!asideRef.current?.contains(event.target as Node | null)) setRailOpen(false); };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [railOpen]);
  // Esc folds the floating sidebar back into the rail before the reading panel hears it (it collapses reading on Esc
  // and skips a handled key). Registered once, at mount, so it runs ahead of the panel's own window listener.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!railOpenRef.current || event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (!asideRef.current?.contains(document.activeElement) || (event.target as HTMLElement).closest?.('select, input, [role="menu"], dialog')) return;
      event.preventDefault();
      event.stopPropagation();
      setRailOpen(false);
      requestAnimationFrame(() => asideRef.current?.querySelector<HTMLElement>('.sidebar-rail__expand')?.focus());
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  return (
    <>
      <aside
        ref={asideRef}
        className={`sidebar${railOpen ? ' is-rail-open' : ''}`}
        aria-label="工作区导航"
        inert={!open}
        aria-hidden={!open}
        onKeyDown={event => {
          // 窄窗（<1000）下侧栏是覆盖抽屉：Esc 收起并把焦点交还给顶栏的展开按钮。
          if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || !matchMedia('(max-width: 999px)').matches) return;
          if ((event.target as HTMLElement).closest('select, input, [role="menu"]')) return;
          event.preventDefault();
          event.stopPropagation();
          collapse(onToggleSidebar);
          requestAnimationFrame(() => document.querySelector<HTMLElement>('.topbar .sidebar-toggle')?.focus());
        }}
      >
        <div className="sidebar-rail">
          <MarkIcon className="sidebar-brand__mark" size={24} />
          <button type="button" className="icon-btn sidebar-rail__expand" aria-label="展开侧栏" title="展开侧栏" aria-expanded={railOpen} onClick={() => { setRailOpen(true); requestAnimationFrame(() => asideRef.current?.querySelector<HTMLElement>('.search-trigger')?.focus()); }}>
            <ChevronRight size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" aria-label="搜索与命令" title="搜索与命令 (Ctrl+K)" onClick={() => onSearch()}>
            <Search size={16} strokeWidth={1.75} />
          </button>
          <span className="sidebar-rail__fill" />
          <button type="button" className="icon-btn" aria-label="翻译密钥" title="翻译密钥" onClick={() => requestTranslationSettings()}>
            <KeyRound size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" aria-label="本机工具" title="本机工具" onClick={() => requestMediaTools()}>
            <Wrench size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" aria-label="使用指南" title="使用指南 (?)" onClick={() => onHelp()}>
            <CircleHelp size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="sidebar-brand">
          <MarkIcon className="sidebar-brand__mark" size={24} />
          <Wordmark className="sidebar-brand__word" height={17} />
          {onToggleSidebar && (
            <button type="button" className="icon-btn icon-btn--sm sidebar-collapse" aria-label="收起侧栏" title="收起侧栏" aria-expanded={open} onClick={() => { if (railOpen) setRailOpen(false); else onToggleSidebar(); }}>
              <ChevronLeft size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>
        <button type="button" className="search-trigger" onClick={() => onSearch()}>
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>搜索与命令</span>
          <kbd>{keyOf('search', 'Ctrl K')}</kbd>
        </button>
        <section className="board-navigation" aria-label="画布管理">
          <BoardLibrary workspace={workspace} disabled={readOnly || busy} onSwitch={onSwitchBoard} onNew={onNewBoard} onChange={onChangeWorkspace} onRename={onRenameBoard} onDuplicate={onDuplicateBoard} onExport={onExportBoard} />
        </section>
        <div className="sidebar-rule" role="separator" />
        <MaterialsLibrary key={board.id} board={board} selectedIds={selectedIds} facet={facet} onFacet={onFacet} onRevealCard={onRevealCard} onOpenCard={onOpenCard} />
        <div className="sidebar-bottom">
          <ThemeControl />
          <button type="button" className="icon-btn" aria-label="翻译密钥" title="翻译密钥" onClick={() => requestTranslationSettings()}>
            <KeyRound size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" aria-label="本机工具" title="本机工具" onClick={() => requestMediaTools()}>
            <Wrench size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" aria-label="使用指南" title="使用指南 (?)" onClick={() => onHelp()}>
            <CircleHelp size={16} strokeWidth={1.75} />
          </button>
        </div>
      </aside>
      <div className="sidebar-scrim" aria-hidden="true" onClick={() => collapse(onToggleSidebar)} />
    </>
  );
}

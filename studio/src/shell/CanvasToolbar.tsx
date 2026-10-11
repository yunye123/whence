import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Captions, ClipboardPaste, Globe, Hand, Import, MousePointer2, Plus, Upload } from 'lucide-react';
import { DraftIcon, GroupIcon, NoteIcon, ThreadIcon, VideoIcon, XLogoIcon } from '../icons/field-icons';
import type { CanvasTool, LinkMode } from '../app/types';
import { Menu, MenuItem, MenuSection, MenuSeparator, TipHit, useHudTooltip, useRovingFocus } from '../components/Menu';
import { isVideoImportAvailable } from '../video-import';
import { getConnectPick, startConnectPick, stopConnectPick, useConnectPick } from '../components/connect-pick';
import { keyOf } from '../components/shortcut-keys';

/**
 * Bottom toolbar of the canvas (DESIGN_SYSTEM.md §6.4): modes on the left, then the grouping tool and the
 * one “添加” entry. “添加” opens the single add menu — write (note, draft) and collect (local files, web,
 * video, X, subtitles, clipboard, every import method). Methods the current environment cannot run sit at
 * the end of their section, stay focusable, and say why.
 *
 * Shortcuts live in the drawn tooltip, never as badges on the buttons. The buttons keep their K4 names and
 * C15 drawn tooltips. The toolbar is one Tab stop; arrows move between its buttons.
 * The rail owns layout; only the popped minimap registers a canvas overlay. App passes snapping to navigation.
 */
export interface CanvasToolbarProps {
  tool: CanvasTool;
  readOnly: boolean;
  onTool: (tool: CanvasTool) => void;
  onAddCard: (kind: 'note' | 'draft' | 'frame') => void;
  /** Opens the hidden media file input directly (“本机文件…”, Ctrl O). */
  onPickFiles: () => void;
  /** Opens the import dialog; `mode` selects its link tab when App supports it. */
  onOpenImport: (mode?: LinkMode) => void;
  /** Deprecated compatibility props; App passes snapping directly to ZoomControls. */
  smartSnap?: boolean;
  onToggleSnap?: () => void;
  /** “从剪贴板粘贴” through App's paste router (K9-11). Without it the toolbar reads the clipboard itself. */
  onPaste?: () => void;
  /** “字幕文件…”: shown when provided; `subtitleTarget` is the selected video's title (null: none selected). */
  onImportSubtitles?: () => void;
  subtitleTarget?: string | null;
  /** How many videos are selected, when App knows (more than one: “只选一个视频”). Read from the canvas otherwise. */
  selectedVideoCount?: number;
  /** “连线” tool (C). Without it the toolbar runs the shared connect mode (components/connect-pick). */
  onConnectTool?: () => void;
  connectActive?: boolean;
  /** Overrides for tests; default to the running environment. */
  videoImportAvailable?: boolean;
  xImportAvailable?: boolean;
}

/* ------------------------------------------------------------------ clipboard fallback */
const PASTE_REFUSED = `请改按 ${keyOf('paste', 'Ctrl V')}`;
const PASTE_REFUSED_TITLE = `浏览器没有允许读取剪贴板。焦点在画布上时按 ${keyOf('paste', 'Ctrl V')}，同样会按内容放进画布。`;

/**
 * Without an App paste handler: in the desktop app replay Ctrl V (App reads the native clipboard); in the
 * browser read the async clipboard and hand App's paste router an equivalent paste event. Returns a short
 * reason when nothing could be pasted.
 */
async function pasteThroughPage(): Promise<string | null> {
  if (typeof window === 'undefined') return PASTE_REFUSED;
  if ((window as { fieldLocalFiles?: unknown }).fieldLocalFiles) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true }));
    return null;
  }
  const transfer = new DataTransfer();
  try {
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        for (const type of item.types) {
          if (type === 'text/plain') transfer.setData('text/plain', await (await item.getType(type)).text());
          else if (/^(image|video|audio)\//.test(type)) {
            const blob = await item.getType(type);
            const kind = type.startsWith('image/') ? '图片' : type.startsWith('video/') ? '视频' : '音频';
            transfer.items.add(new File([blob], `粘贴的${kind}.${type.split('/')[1].split(/[+;]/)[0]}`, { type }));
          }
        }
      }
    } else if (navigator.clipboard?.readText) transfer.setData('text/plain', await navigator.clipboard.readText());
    else return PASTE_REFUSED;
  } catch {
    return PASTE_REFUSED;
  }
  if (!transfer.files.length && !transfer.getData('text/plain').trim()) return '剪贴板是空的';
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  return null;
}

const typingTarget = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="menu"], [role="dialog"], .tiptap, .inspector, video, audio');
const modalOpen = () => !!document.querySelector('.modal-backdrop, dialog[open], [aria-modal="true"]');

/** The one selected card the connect mode starts from (a group is not a card); null when none or several. */
function selectedConnectStart(): string | null {
  if (typeof document === 'undefined') return null;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node.selected')).filter(node => !node.querySelector('.field-card--frame'));
  return cards.length === 1 ? cards[0].dataset.id ?? null : null;
}

/** Selected videos on the canvas (the add menu opens on demand, so reading the DOM then is enough). */
function selectedVideosOnCanvas(): number {
  if (typeof document === 'undefined') return 0;
  return document.querySelectorAll('.react-flow__node.selected .field-card--video').length;
}

export default function CanvasToolbar({ tool, readOnly, onTool, onAddCard, onPickFiles, onOpenImport, onPaste, onImportSubtitles, subtitleTarget = null, selectedVideoCount, onConnectTool, connectActive = false, videoImportAvailable, xImportAvailable }: CanvasToolbarProps) {
  const rovingRef = useRovingFocus<HTMLDivElement>();
  const { ref: tipRootRef, tooltip } = useHudTooltip<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRoot = useCallback((element: HTMLDivElement | null) => { rootRef.current = element; rovingRef(element); tipRootRef(element); }, [rovingRef, tipRootRef]);
  const addRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<null | 'first' | 'last'>(null);
  const [paste, setPaste] = useState<{ busy: boolean; reason?: string }>({ busy: false });

  const openMenu = useCallback((focus: 'first' | 'last') => { setPaste({ busy: false }); setMenu(focus); }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

  // “连线” (C): App's tool when it passes one, otherwise the shared connect mode — click two cards in turn.
  const pick = useConnectPick();
  const connectOn = onConnectTool ? connectActive : !!pick;
  const toggleConnect = useCallback(() => {
    if (onConnectTool) { onConnectTool(); return; }
    if (getConnectPick()) stopConnectPick();
    else startConnectPick(selectedConnectStart());
  }, [onConnectTool]);

  // Single keys of the toolbar (§6.28): A opens “添加”, G adds a group area, Ctrl O picks local files.
  const handlers = useRef({ readOnly, onAddCard, onPickFiles, openMenu, toggleConnect });
  handlers.current = { readOnly, onAddCard, onPickFiles, openMenu, toggleConnect };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey) return;
      if (typingTarget(event.target) || modalOpen()) return;
      const root = rootRef.current;
      if (!root || !root.getClientRects().length) return; // Hidden while reading or writing is expanded.
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const { readOnly: locked, onAddCard: add, onPickFiles: pickFiles, openMenu: open, toggleConnect: connect } = handlers.current;
      if (mod && key === 'o') { event.preventDefault(); if (!locked) pickFiles(); return; }
      if (mod) return;
      if (key === 'a') { event.preventDefault(); if (!locked) open('first'); }
      else if (key === 'g') { event.preventDefault(); if (!locked) add('frame'); }
      else if (key === 'c') { event.preventDefault(); if (!locked) connect(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (readOnly) setMenu(null); }, [readOnly]);

  const videoReady = videoImportAvailable ?? isVideoImportAvailable();
  const xReady = xImportAvailable ?? (typeof window !== 'undefined' && !!(window as { fieldXImports?: unknown }).fieldXImports);

  const runPaste = async () => {
    if (onPaste) { closeMenu(); onPaste(); return; }
    setPaste({ busy: true });
    const failure = await pasteThroughPage();
    if (failure) setPaste({ busy: false, reason: failure });
    else closeMenu();
  };

  const readOnlyNote = readOnly ? '当前窗口只读' : undefined;
  const available: ReactNode[] = [];
  const unavailable: ReactNode[] = [];
  const videoItem = <MenuItem key="video" icon={<VideoIcon size={16}/>} label="视频链接…" disabled={!videoReady} reason={videoReady ? undefined : '需要桌面版'} title={videoReady ? undefined : '浏览器版不能下载视频和生成逐字稿，需要来处桌面版'} onSelect={() => onOpenImport('video')}/>;
  const xItem = <MenuItem key="x" icon={<XLogoIcon size={16}/>} label="X 推文…" disabled={!xReady} reason={xReady ? undefined : '需要桌面版'} title={xReady ? undefined : '浏览器版不能读取推文正文与素材，需要来处桌面版'} onSelect={() => onOpenImport('x')}/>;
  (videoReady ? available : unavailable).push(videoItem);
  (xReady ? available : unavailable).push(xItem);
  if (onImportSubtitles) {
    // Several selected videos: the subtitles belong to one of them (FV2-11), so the reason says “只选一个”.
    const several = !subtitleTarget && (selectedVideoCount ?? selectedVideosOnCanvas()) > 1;
    const subtitleItem = <MenuItem key="subtitles" icon={<Captions size={16} strokeWidth={1.75}/>} label="字幕文件…" disabled={!subtitleTarget} reason={subtitleTarget ? undefined : several ? '只选一个视频' : '先选中视频'} title={subtitleTarget ? `给「${subtitleTarget}」导入 SRT / VTT 字幕` : several ? '字幕要导入到某一个视频，请只选中它' : '在画布上选中一个视频，再导入它的字幕'} onSelect={() => onImportSubtitles()}/>;
    (subtitleTarget ? available : unavailable).unshift(subtitleItem);
  }

  return (
    <div ref={setRoot} className="canvas-toolbar" role="toolbar" aria-label="画布工具">
      <div className="canvas-toolbar__group" role="group" aria-label="移动与选择">
        <button type="button" className={`canvas-toolbar__tool${tool === 'select' ? ' active' : ''}`} aria-label="选择" aria-pressed={tool === 'select'} data-tip="选择" data-tip-kbd={keyOf('tool-select', 'V')} onClick={() => onTool('select')}><TipHit/><MousePointer2 size={17} strokeWidth={1.75} aria-hidden="true"/><span className="canvas-toolbar__label">选择</span></button>
        <button type="button" className={`canvas-toolbar__tool${tool === 'hand' ? ' active' : ''}`} aria-label="平移" aria-pressed={tool === 'hand'} data-tip="平移" data-tip-note="或按住空格" data-tip-kbd={keyOf('tool-hand', 'H')} onClick={() => onTool('hand')}><TipHit/><Hand size={17} strokeWidth={1.75} aria-hidden="true"/><span className="canvas-toolbar__label">平移</span></button>
        <button type="button" className={`canvas-toolbar__tool${connectOn ? ' active' : ''}`} title={readOnlyNote} aria-label="连线" aria-pressed={connectOn} aria-disabled={readOnly || undefined} data-tip="连线" data-tip-kbd={keyOf('tool-connect', 'C')} data-tip-note={readOnlyNote ?? (connectOn ? 'Esc 退出' : '依次点两张卡片')} onClick={() => { if (!readOnly) toggleConnect(); }}><TipHit/><ThreadIcon size={17}/><span className="canvas-toolbar__label">连线</span></button>
        <button type="button" className="canvas-toolbar__tool" title={readOnlyNote} aria-label="添加分组区域" aria-disabled={readOnly || undefined} data-tip="添加分组" data-tip-kbd={keyOf('add-frame', 'G')} data-tip-note={readOnlyNote} onClick={() => { if (!readOnly) onAddCard('frame'); }}><TipHit/><GroupIcon size={17}/><span className="canvas-toolbar__label">分组</span></button>
      </div>
      <span className="canvas-toolbar__rule" aria-hidden="true"/>
      <div className="canvas-toolbar__group" role="group" aria-label="创建与收集">
        <button
          ref={addRef}
          type="button"
          className={`canvas-toolbar__add${menu ? ' is-open' : ''}`}
          title={readOnlyNote}
          aria-label="添加"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          aria-disabled={readOnly || undefined}
          data-tip="添加"
          data-tip-kbd={keyOf('add-menu', 'A')}
          data-tip-note={readOnlyNote}
          onClick={() => { if (readOnly) return; if (menu) closeMenu(); else openMenu('first'); }}
          onKeyDown={event => {
            if (readOnly || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
            event.preventDefault();
            event.stopPropagation();
            openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
          }}
        >
          <TipHit/><Plus size={16} strokeWidth={2} aria-hidden="true"/><span>添加</span>
        </button>
      </div>
      {menu && (
        <Menu label="添加" anchor={addRef.current} placement="top-start" offset={10} alignOffset={-8} minWidth={248} initialFocus={menu} onClose={closeMenu} className="field-menu--add">
          <MenuSection title="自己写">
            <MenuItem icon={<NoteIcon size={16}/>} label="笔记" ariaLabel="添加笔记" shortcut={keyOf('add-note', 'N')} onSelect={() => onAddCard('note')}/>
            <MenuItem icon={<DraftIcon size={16}/>} label="文稿" ariaLabel="添加文稿" shortcut={keyOf('add-draft', 'T')} onSelect={() => onAddCard('draft')}/>
          </MenuSection>
          <MenuSeparator/>
          <MenuSection title="收集">
            <MenuItem icon={<Upload size={16} strokeWidth={1.75}/>} label="本机文件…" ariaLabel="导入素材" shortcut={keyOf('pick-files', 'Ctrl O')} title="文字、图片、视频文件" onSelect={() => onPickFiles()}/>
            <MenuItem icon={<Globe size={16} strokeWidth={1.75}/>} label="网页链接…" ariaLabel="收集链接" onSelect={() => onOpenImport('web')}/>
            {available}
            <MenuItem icon={<ClipboardPaste size={16} strokeWidth={1.75}/>} label={paste.busy ? '正在读取剪贴板…' : '从剪贴板粘贴'} shortcut={paste.reason ? undefined : keyOf('paste', 'Ctrl V')} reason={paste.reason} title={paste.reason === PASTE_REFUSED ? PASTE_REFUSED_TITLE : '文件、链接或文字，按内容放进画布'} busy={paste.busy} keepOpen={!onPaste} onSelect={() => void runPaste()}/>
            {unavailable}
          </MenuSection>
          <MenuSeparator/>
          <MenuItem icon={<Import size={16} strokeWidth={1.75}/>} label="所有导入方式…" ariaLabel="所有导入方式" onSelect={() => onOpenImport()}/>
        </Menu>
      )}
      {tooltip}
    </div>
  );
}

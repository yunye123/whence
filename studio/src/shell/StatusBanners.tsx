import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { CircleAlert, Lock, LoaderCircle } from 'lucide-react';
import type { SaveStatus } from '../app/types';
import { useCanvasOverlay } from '../canvas/safe-area';
import { Words } from '../cards/Words';

export interface StatusBannersProps {
  saveStatus: SaveStatus;
  saveError: string;
  readOnly: boolean;
  busy: boolean;
  /** Desktop build with at least one board saved in a custom folder. */
  canReconnect: boolean;
  onRetrySave: () => void;
  onReconnect: () => void;
  onExportBackup: () => void;
}

/** `storage.ts` reports folder boards that could not be written with this prefix (the edit itself is already in IndexedDB). */
const FOLDER_FAILURE = /^以下画布的本[地机](?:目录|文件夹)尚未更新：/;

/**
 * What the banner says about a failed save (§8.2: the reason in plain words and one next step; §8.1: “本机”). The raw
 * error stays available as `detail` (the banner's tooltip and the top bar's), never as the sentence people read: a
 * folder that could not be written becomes “最新修改已留在本机，还没写进‘城中村’的画布文件夹……”, not
 * “以下画布的本地目录尚未更新：‘城中村’：ENOENT …”.
 */
export function saveFailureCopy(saveError: string): { message: string; detail: string } {
  const detail = saveError.trim();
  if (FOLDER_FAILURE.test(detail)) {
    // “标题”：原因；“标题”：原因 — the titles are the quoted runs right before a full-width colon.
    const titles = [...new Set([...detail.replace(FOLDER_FAILURE, '').matchAll(/“([^”]*)”：/g)].map(match => match[1] || '未命名画布'))];
    const where = titles.length > 1 ? ` ${titles.length} 块画布的文件夹（${titles.map(title => `“${title}”`).join('')}）` : `“${titles[0] ?? '这块画布'}”的画布文件夹`;
    return { message: `最新修改已留在本机，还没写进${where}。文件夹可能被移动、改名，或所在磁盘没有连接。`, detail };
  }
  if (!detail) return { message: '最新修改还没有写入本机。', detail };
  return { message: detail.replace(/本地/g, '本机'), detail };
}

/**
 * 保存失败与只读横幅（§5.3）：画布容器顶部内 12px、居中、最宽 560，登记为安全区顶部浮层。
 * 状态不只靠颜色：图标 + 文字 + 一个下一步。保存失败时这里是唯一的主操作“重试保存”（顶栏只报状态，
 * polish round 4 P7）；重新连接文件夹、导出备份是次一级的出路。重试进行中横幅留着、按钮转成“保存中”，
 * 不会一闪一闪；重试成功才收起。
 */
/**
 * The strip of canvas a banner stands over, in `.main-workspace` pixels: the canvas container, less the reading panel
 * that is laid over its right part (§6.18.3). Written as `--strip-left` / `--strip-width` on the banner, so it is centred
 * on the canvas people can see and never runs under a panel — a docked panel of any width, or the reading split, where
 * the strip is about 440 px wide at 1440 (polish round 4: the banner used to be cut by the reading panel).
 */
function useCanvasStrip(): (element: HTMLDivElement | null) => void {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const host = element.parentElement;
    if (!host) return;
    const measure = () => {
      const canvas = host.querySelector<HTMLElement>('.canvas-shell');
      if (!canvas) { element.style.removeProperty('--strip-left'); element.style.removeProperty('--strip-width'); return; }
      const hostBox = host.getBoundingClientRect(), box = canvas.getBoundingClientRect();
      let right = box.right;
      // The reading panel sits at the right edge with a slide-in transform: its edge is the host's right less its width.
      const cover = host.querySelector<HTMLElement>('.inspector--reading-expanded');
      if (cover) right = Math.min(right, hostBox.right - cover.offsetWidth);
      element.style.setProperty('--strip-left', `${Math.round(box.left - hostBox.left)}px`);
      element.style.setProperty('--strip-width', `${Math.max(0, Math.round(right - box.left))}px`);
    };
    measure();
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    sizes?.observe(host);
    const canvas = host.querySelector<HTMLElement>('.canvas-shell');
    if (canvas) sizes?.observe(canvas);
    // The panel (a direct child of the workspace body) mounts, unmounts and switches layout (docked ↔ reading) by class;
    // only those few elements are watched, never the canvas below them (a drag changes classes on every frame).
    const body = canvas?.parentElement ?? host;
    const layouts = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null;
    const watchPanels = () => {
      layouts?.disconnect();
      body.querySelectorAll<HTMLElement>(':scope > .inspector').forEach(panel => { layouts?.observe(panel, { attributes: true, attributeFilter: ['class'] }); sizes?.observe(panel); });
      structure?.observe(body, { childList: true });
    };
    const structure = typeof MutationObserver === 'function' ? new MutationObserver(() => { watchPanels(); measure(); }) : null;
    watchPanels();
    window.addEventListener('resize', measure);
    return () => { sizes?.disconnect(); layouts?.disconnect(); structure?.disconnect(); window.removeEventListener('resize', measure); };
  }, [element]);
  return setElement;
}

export default function StatusBanners({ saveStatus, saveError, readOnly, busy, canReconnect, onRetrySave, onReconnect, onExportBackup }: StatusBannersProps) {
  // Top overlays of the safe area; they only count while they actually cover the canvas container.
  const recoveryOverlay = useCanvasOverlay<HTMLDivElement>('top');
  const readOnlyOverlay = useCanvasOverlay<HTMLDivElement>('top');
  const recoveryStrip = useCanvasStrip();
  const readOnlyStrip = useCanvasStrip();
  const recoveryRef = useCallback((element: HTMLDivElement | null) => { recoveryOverlay(element); recoveryStrip(element); }, [recoveryOverlay, recoveryStrip]);
  const readOnlyRef = useCallback((element: HTMLDivElement | null) => { readOnlyOverlay(element); readOnlyStrip(element); }, [readOnlyOverlay, readOnlyStrip]);
  // A retry (or an edit typed meanwhile) saves again: keep the banner through that attempt instead of hiding it.
  const [failing, setFailing] = useState(false);
  const [lastError, setLastError] = useState('');
  useEffect(() => {
    if (saveStatus === 'error') { setFailing(true); setLastError(saveError); }
    else if (saveStatus !== 'saving') setFailing(false);
  }, [saveStatus, saveError]);
  const saving = saveStatus === 'saving';
  const showRecovery = saveStatus === 'error' || (failing && saving);
  const copy = saveFailureCopy(saveStatus === 'error' ? saveError : lastError);
  return (
    <>
      {showRecovery && (
        <div ref={recoveryRef} data-canvas-overlay="top" className="status-banner error save-recovery-banner status-banner--desk" role="status">
          <CircleAlert className="status-banner__icon" data-status-icon="error" size={16} strokeWidth={1.75} aria-hidden="true" />
          <div className="status-banner__body">
            <strong>保存失败</strong>
            {/* Words keep whole (“改名” is not split over two lines, §3.4); the raw error is the tooltip. */}
            <span title={copy.detail && copy.detail !== copy.message ? copy.detail : undefined}><Words text={copy.message} keep={4} /></span>
          </div>
          <div className="save-recovery-actions">
            <button type="button" className="btn btn--sm btn--primary" disabled={readOnly || busy || saving} aria-busy={saving || undefined} onClick={() => onRetrySave()}>
              {saving && <LoaderCircle className="spin" size={14} strokeWidth={2} aria-hidden="true" />}{saving ? '保存中' : '重试保存'}
            </button>
            {canReconnect && <button type="button" className="btn btn--sm btn--line" disabled={readOnly || busy} onClick={() => onReconnect()}>重新连接文件夹</button>}
            <button type="button" className="btn btn--sm btn--line" disabled={busy} onClick={() => onExportBackup()}>导出备份</button>
          </div>
        </div>
      )}
      {readOnly && (
        <div ref={readOnlyRef} data-canvas-overlay="top" className="status-banner warning status-banner--desk" role="status">
          <Lock className="status-banner__icon" data-status-icon="readonly" size={16} strokeWidth={1.75} aria-hidden="true" />
          <div className="status-banner__body">
            <strong>此窗口只读，可阅读已缓存内容。</strong>
            <span>另一个窗口正在编辑这个工作区。关闭那个窗口后，重新载入这里即可编辑。</span>
          </div>
        </div>
      )}
    </>
  );
}

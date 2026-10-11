import { useEffect, useState } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useBoard } from '../board-context';
import type { BoardActions } from '../board-context';
import { saveFailureCopy } from '../shell/StatusBanners';

/**
 * Optional App fields for the recovery the canvas banner offers. Until App passes them through the board context,
 * the banner itself (still rendered, but under this whole-window layout) is read and its own buttons are used.
 */
type RecoveryBoard = BoardActions & { saveError?: string; reconnectFolder?(): void; exportBackup?(): void };

const FALLBACK = '最新修改还没有写入本机。请重试，或重新连接画布文件夹。';
const BANNER = '.save-recovery-banner';

function bannerButton(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>(`${BANNER} button`)].find(button => button.textContent?.trim() === label) ?? null;
}

interface BannerState { message: string; reconnect: boolean; backup: boolean; busy: boolean }
function readBanner(): BannerState | null {
  const banner = document.querySelector(BANNER);
  if (!banner) return null;
  return {
    message: banner.querySelector('.status-banner__body > span')?.textContent?.trim() ?? '',
    reconnect: !!bannerButton('重新连接文件夹'),
    backup: !!bannerButton('导出备份'),
    busy: !!bannerButton('重试保存')?.disabled,
  };
}
const sameBanner = (a: BannerState | null, b: BannerState | null) => !!a && !!b
  && a.message === b.message && a.reconnect === b.reconnect && a.backup === b.backup && a.busy === b.busy;

/**
 * Save failure inside the watching workbench (FD-02). The whole-window layout covers the top bar's save state and
 * the canvas banner, so the failure and the same next steps — 重试保存 · 重新连接文件夹 · 导出备份 — sit under the
 * header until a save goes through. Edits typed meanwhile start new attempts; the strip stays up through them
 * instead of flickering with each one, and only the buttons wait while an attempt runs.
 */
export default function SaveRecoveryNotice() {
  const board = useBoard() as RecoveryBoard;
  const status = board.saveStatus;
  const [failing, setFailing] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);
  useEffect(() => {
    if (status === 'error') setFailing(true);
    else if (status !== 'saving') setFailing(false);
  }, [status]);
  useEffect(() => {
    if (status !== 'error') return;
    const read = () => setBanner(previous => { const next = readBanner(); return !next || sameBanner(previous, next) ? previous : next; });
    read();
    const element = document.querySelector(BANNER);
    if (!element || typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(read);
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
    return () => observer.disconnect();
  }, [status]);

  if (status !== 'error' && !(failing && status === 'saving')) return null;
  const saving = status === 'saving';
  const busy = saving || !!banner?.busy || !!board.readOnly;
  const reconnect = board.reconnectFolder ?? (banner?.reconnect ? () => bannerButton('重新连接文件夹')?.click() : undefined);
  const backup = board.exportBackup ?? (banner?.backup ? () => bannerButton('导出备份')?.click() : undefined);
  // The same plain sentence as the canvas banner (polish round 4 P7); the raw error stays in the tooltip.
  const copy = saveFailureCopy(board.saveError || banner?.message || '');
  const message = copy.detail ? copy.message : FALLBACK;
  return <div className="watch-save-alert">
    <CircleAlert className="watch-save-alert__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
    <p className="watch-save-alert__text" role="alert"><strong>保存失败</strong><span title={copy.detail && copy.detail !== message ? copy.detail : undefined}>{message}</span></p>
    <div className="watch-save-alert__actions">
      {board.retrySave && <button type="button" className="btn btn--sm btn--line" disabled={busy} onClick={() => board.retrySave?.()}>
        {saving && <LoaderCircle size={13} className="inspector-is-processing" aria-hidden="true" />}{saving ? '保存中' : '重试保存'}
      </button>}
      {reconnect && <button type="button" className="btn btn--sm" disabled={busy} onClick={reconnect}>重新连接文件夹</button>}
      {backup && <button type="button" className="btn btn--sm" disabled={saving || !!banner?.busy} onClick={backup}>导出备份</button>}
    </div>
  </div>;
}

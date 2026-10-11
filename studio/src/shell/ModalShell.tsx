import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface ModalShellProps {
  kind: string;
  /** While locked (a board is being created) neither the backdrop nor the close button dismisses. */
  locked: boolean;
  closeDisabled: boolean;
  onClose: () => void;
  children: ReactNode;
}

interface ModalControls { close: () => void; locked: boolean; closeDisabled: boolean }
const ModalContext = createContext<ModalControls | null>(null);

/** Dialog content can offer its own “取消” without App passing another handler (DESIGN_SYSTEM §6.20). */
export function useModalControls(): ModalControls | null { return useContext(ModalContext); }

/**
 * Shared backdrop + dialog frame (§6.20): neutral panel on the scrim, 56px header row, scrolling body,
 * 64px footer. Width follows `modal-{kind}` in dialog.css. Focus trapping and Esc handling live in
 * App's effects, which locate this element through `[role="dialog"]`; the close button sits last in
 * the DOM so the first Tab stop is the dialog's own content.
 */
const TABBABLE = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]';

/** Only real Tab stops (roving radios keep tabindex=-1), so Shift+Tab never escapes past a skipped radio. */
function tabStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'));
}

export default function ModalShell({ kind, locked, closeDisabled, onClose, children }: ModalShellProps) {
  const frame = useRef<HTMLElement>(null);
  // Busy import fields may already be disabled on first mount. App's input-first
  // focus routine cannot focus those; keep a real stop inside the panel instead.
  // Existing autoFocus and any deliberate in-panel focus always win.
  useLayoutEffect(() => {
    const root = frame.current;
    if (!root || root.contains(document.activeElement)) return;
    const stops = tabStops(root);
    const preferred = stops.find(element => element.matches('[data-autofocus], input, textarea'));
    (preferred ?? stops[0] ?? root).focus({ preventScroll: true });
  }, [children]);
  const close = () => { if (!locked) onClose(); };
  return (
    <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!locked)onClose();}}>
      <section ref={frame} className={`modal modal-${kind}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} onKeyDown={event=>{
        if(event.key!=='Tab'||event.defaultPrevented)return;
        const stops=tabStops(event.currentTarget);
        if(!stops.length){event.preventDefault();event.currentTarget.focus();return;}
        const first=stops[0],last=stops[stops.length-1],active=document.activeElement;
        if(event.shiftKey&&(active===first||!event.currentTarget.contains(active))){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&(active===last||!event.currentTarget.contains(active))){event.preventDefault();first.focus();}
      }}>
        <ModalContext.Provider value={{ close, locked, closeDisabled }}>
          {children}
        </ModalContext.Provider>
        <button type="button" className="modal-close icon-btn" aria-label="关闭对话框" title="关闭（Esc）" disabled={closeDisabled} onClick={close}><X size={18} aria-hidden="true"/></button>
      </section>
    </div>
  );
}

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Native modal dialogs make the whole canvas inert while a correction is being reviewed. */
export default function InspectorDialog({ title, children, dirty = false, className = '', closeLabel = '取消并关闭对话框', onCancel }: {
  title: string;
  children: ReactNode;
  dirty?: boolean;
  className?: string;
  closeLabel?: string;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const composing = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog.close();
      // Return focus one frame later (SB-M1): restoring it synchronously while the closing Enter key is still
      // being dispatched lets that same key activate the trigger button and reopen the dialog. Focus that the
      // closing action already moved somewhere meaningful is left alone.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected && !dialog.contains(active) && active !== previous) return;
        if (previous?.isConnected) previous.focus();
        else document.querySelector<HTMLElement>('.inspector .inspector-search input, .inspector .inspector-header button')?.focus();
      });
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty]);

  if (typeof document === 'undefined') return null;
  return createPortal(<dialog ref={dialogRef} className={`inspector-dialog${className ? ` ${className}` : ''}`} aria-labelledby={titleId} aria-modal="true"
    onCancel={event => { event.preventDefault(); if (!composing.current) onCancel(); }}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onPaste={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) {
        if (event.key === 'Escape') event.preventDefault();
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); return; }
      if (event.key === 'Tab') {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'));
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" className="inspector-icon-button" aria-label={closeLabel} onClick={onCancel}><X size={18} /></button></header>
    {children}
  </dialog>, document.body);
}

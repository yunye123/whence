import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small panel helpers for the writing surface. Drawers and popovers are positioned against the panel root
 * (`aside.inspector`), which keeps one element across the docked and focus-writing layouts, so they never scroll
 * with the paper and are never trapped by the paper's entrance transform.
 */
export function useInspectorRoot(ref: RefObject<HTMLElement | null>): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setRoot(ref.current?.closest<HTMLElement>('aside.inspector') ?? null); }, [ref]);
  return root;
}

/** Render into the panel root once it is known; before that (server rendering, first frame) render in place or not at all. */
export function InPanel({ root, inline = false, children }: { root: HTMLElement | null; inline?: boolean; children: ReactNode }) {
  if (root) return createPortal(children, root);
  return inline ? <>{children}</> : null;
}

/** `matchMedia` as React state; false on the server. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener('change', notify);
    return () => list.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches, () => false);
}

/** A change signal that does not re-render anyone: the margin subscribes and measures in the next frame. */
export interface Signal { emit(): void; subscribe(listener: () => void): () => void }
export function createSignal(): Signal {
  const listeners = new Set<() => void>();
  return {
    emit: () => { for (const listener of listeners) listener(); },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/**
 * Continuous typing fades the status band (`is-typing` on the panel root, CSS does the rest): it comes back after
 * 1.5 s without input or as soon as the pointer moves (§6.18.4). No React state changes per keystroke.
 */
export function useTypingFade(root: HTMLElement | null) {
  const timer = useRef(0);
  const clear = useCallback(() => { window.clearTimeout(timer.current); root?.classList.remove('is-typing'); }, [root]);
  useEffect(() => {
    if (!root) return;
    const onMove = () => { if (root.classList.contains('is-typing')) clear(); };
    root.addEventListener('pointermove', onMove, { passive: true });
    return () => { root.removeEventListener('pointermove', onMove); clear(); };
  }, [root, clear]);
  return useCallback(() => {
    if (!root) return;
    root.classList.add('is-typing');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(clear, 1500);
  }, [root, clear]);
}

/** Ctrl+S in the editor: saving is automatic, so the band shows that it is saved instead of the browser's “save page”. */
export const DRAFT_SAVE_EVENT = 'field:draft-save-shortcut';

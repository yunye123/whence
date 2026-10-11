import { useSyncExternalStore } from 'react';

/**
 * Connect mode (DESIGN_SYSTEM §6.4 “连线 C”, §6.6 “连线”): click two cards on the canvas, one after the other.
 * The toolbar's “连线” and the selection bar's “连线” start it; the selection toolbar owns the clicks, the
 * connection and the label box that follows (the same as a dragged thread). Esc or a click on the empty
 * canvas leaves it. `source: null` means the start card has not been chosen yet.
 */
export interface ConnectPick { source: string | null }

let current: ConnectPick | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const getConnectPick = (): ConnectPick | null => current;

export function startConnectPick(source: string | null): void {
  if (current?.source === source && current) return;
  current = { source };
  emit();
}

export function stopConnectPick(): void {
  if (!current) return;
  current = null;
  emit();
}

export function useConnectPick(): ConnectPick | null {
  return useSyncExternalStore(subscribe, getConnectPick, () => null);
}

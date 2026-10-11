import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { prefersScript } from './script-model';

/**
 * “正文 / 脚本” (DESIGN_SYSTEM §6.29): which of the two views of the same body a draft shows. Not board data (K1):
 * a per-viewer convenience kept in localStorage under its own key, by card id. Until the writer chooses, a draft that
 * reads as a script (prefersScript) opens in 脚本, everything else in 正文. That first guess is fixed for the session,
 * so the view never flips while someone is typing.
 */
export type DraftView = 'body' | 'script';

const KEY = 'field-draft-view-v1';
const LIMIT = 200;
let memory: Record<string, DraftView> | null = null;
const sessionDefaults = new Map<string, DraftView>();
const listeners = new Set<() => void>();

function load(): Record<string, DraftView> {
  if (memory) return memory;
  memory = {};
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) if (value === 'body' || value === 'script') memory[id] = value;
    }
  } catch { /* Blocked or damaged storage: every draft starts from its default view. */ }
  return memory;
}

export function storedDraftView(id: string): DraftView | undefined { return load()[id]; }

export function setDraftView(id: string, view: DraftView): void {
  const next = { ...load() };
  delete next[id];
  next[id] = view;
  const ids = Object.keys(next);
  for (const old of ids.slice(0, Math.max(0, ids.length - LIMIT))) delete next[old];
  memory = next;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)); } catch { /* The choice lasts for this visit only. */ }
  for (const listener of listeners) listener();
}

/** The default for a draft nobody switched yet; computed once per card per session. */
export function defaultDraftView(id: string, body: string): DraftView {
  const known = sessionDefaults.get(id);
  if (known) return known;
  const view: DraftView = prefersScript(body) ? 'script' : 'body';
  if (id) sessionDefaults.set(id, view);
  return view;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The current view of a draft and a setter that remembers the choice. Server rendering uses the default. */
export function useDraftView(id: string | null | undefined, body: string): [DraftView, (view: DraftView) => void] {
  const key = id ?? '';
  const stored = useSyncExternalStore(subscribe, () => (key ? load()[key] : undefined), () => undefined);
  // Without a card id (should not happen) the choice lives in this component only.
  const [local, setLocal] = useState<DraftView>();
  // After the first call for this card the default no longer follows the body (defaultDraftView caches it).
  const fallback = useMemo(() => defaultDraftView(key, body), [key, body]);
  const set = useCallback((view: DraftView) => { if (key) setDraftView(key, view); else setLocal(view); }, [key]);
  return [stored ?? local ?? fallback, set];
}

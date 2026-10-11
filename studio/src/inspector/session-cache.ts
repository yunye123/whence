import type { DraftEditorState } from '../draft-navigation';

export type InspectorSession = {
  editor: DraftEditorState;
  reading: boolean;
  readingExpanded: boolean;
  readingScrollTop?: number;
  editingScrollTop?: number;
};

// A short-lived visit cache keeps a creator's place when they close a panel or
// switch cards. It contains no source body and never changes persisted data.
export const inspectorSessions = new Map<string, InspectorSession>();
export function rememberInspectorSession(id: string, session: InspectorSession) {
  inspectorSessions.delete(id);
  inspectorSessions.set(id, session);
  if (inspectorSessions.size > 100) inspectorSessions.delete(inspectorSessions.keys().next().value!);
}

/**
 * Where a draft's view stood when the writer left it for a source (INSP-08): the document position of the line at
 * the top of the panel and how far that line sat from the top. The navigation token keeps its nine fields (K9-18);
 * this only lets the return trip put the same line back in the same place, because CodeMirror estimates the height
 * of lines it has not drawn and the same pixel scrollTop lands on another paragraph once the panel re-mounts.
 */
export const draftScrollAnchors = new Map<string, { pos: number; offset: number }>();

/**
 * Panels currently mounted. A new panel that renders while another is still mounted is a card switch inside an
 * open panel, so it skips the opening motion (§7 animates opening, not every selection change).
 */
export const inspectorPresence = { mounted: 0 };

/**
 * Docked panel width (DESIGN_SYSTEM §6.18.1): 400 by default, dragged between 360 and 560. A per-viewer
 * convenience kept in localStorage under a new key; it never enters board data, and storage that is blocked
 * or empty simply yields the default.
 */
export const PANEL_WIDTH = { default: 400, min: 360, max: 560, step: 16 } as const;
const PANEL_WIDTH_KEY = 'field-inspector-width-v1';
export function clampPanelWidth(value: number): number {
  return Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, Number.isFinite(value) ? value : PANEL_WIDTH.default)));
}
export function readPanelWidth(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(PANEL_WIDTH_KEY));
    return stored ? clampPanelWidth(stored) : PANEL_WIDTH.default;
  } catch { return PANEL_WIDTH.default; }
}
export function writePanelWidth(value: number): void {
  try {
    if (clampPanelWidth(value) === PANEL_WIDTH.default) globalThis.localStorage?.removeItem(PANEL_WIDTH_KEY);
    else globalThis.localStorage?.setItem(PANEL_WIDTH_KEY, String(clampPanelWidth(value)));
  } catch { /* Storage unavailable: the width lasts for this visit only. */ }
}

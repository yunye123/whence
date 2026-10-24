import type { CardKind } from '../model';

/** Which card each column is showing. A draft, once opened, stays in `pinned` until its own close. */
export interface PanelSlots {
  pinned: string | null;
  companion: string | null;
  solo: string | null;
  watch: string | null;
  focused: string | null;
}

export const emptyPanels = (): PanelSlots => ({ pinned: null, companion: null, solo: null, watch: null, focused: null });

/** Notes, excerpts, pictures, links — and a group, so it never takes the draft's place. */
const LEFT_COLUMN: ReadonlySet<CardKind> = new Set(['note', 'quote', 'image', 'link', 'frame']);

/**
 * Open `card`. A draft pins on the right and clears the watch page. With a draft pinned, a note, excerpt,
 * picture or link replaces only the left column. A video covers the window and leaves both columns mounted.
 * Without a draft, the card is the single right-hand panel.
 */
export function placeOpenedCard(slots: PanelSlots, card: { id: string; kind: CardKind }, soloKind?: CardKind | null): PanelSlots {
  if (card.kind === 'draft') {
    const carried = slots.solo && slots.solo !== card.id && soloKind && LEFT_COLUMN.has(soloKind) ? slots.solo : null;
    const companion = slots.companion && slots.companion !== card.id ? slots.companion : carried;
    return { pinned: card.id, companion, solo: null, watch: null, focused: card.id };
  }
  if (card.kind === 'video' && slots.pinned) return { ...slots, watch: card.id, focused: card.id };
  if (slots.pinned && LEFT_COLUMN.has(card.kind)) return { ...slots, companion: card.id, focused: card.id };
  return { pinned: null, companion: null, solo: card.id, watch: null, focused: card.id };
}

/** Esc closes the watch page, otherwise the left column, otherwise a panel that is not a pinned draft. */
export function dismissEscape(slots: PanelSlots): PanelSlots {
  if (slots.watch) return { ...slots, watch: null, focused: slots.companion ?? slots.pinned ?? slots.solo };
  if (slots.companion) return { ...slots, companion: null, focused: slots.pinned ?? slots.solo };
  if (slots.solo) return { ...slots, solo: null, focused: slots.pinned };
  return slots;
}

/** The draft's own close. A left-hand card becomes the single right-hand panel. */
export function closeDraft(slots: PanelSlots): PanelSlots {
  if (slots.watch) return { pinned: null, companion: null, solo: slots.watch, watch: null, focused: slots.watch };
  if (slots.companion) return { pinned: null, companion: null, solo: slots.companion, watch: null, focused: slots.companion };
  return { pinned: null, companion: null, solo: slots.solo, watch: null, focused: slots.solo };
}

/** Drop ids that were deleted. A missing draft promotes the left column, same as closing it. */
export function releaseIds(slots: PanelSlots, ids: readonly string[], pinnedRemains: boolean): PanelSlots {
  const gone = new Set(ids);
  let next: PanelSlots = {
    ...slots,
    watch: slots.watch && gone.has(slots.watch) ? null : slots.watch,
    companion: slots.companion && gone.has(slots.companion) ? null : slots.companion,
    solo: slots.solo && gone.has(slots.solo) ? null : slots.solo,
  };
  if (slots.pinned && (gone.has(slots.pinned) || !pinnedRemains)) next = closeDraft(next);
  const visible = next.watch ?? next.companion ?? next.solo ?? next.pinned;
  if (next.focused !== visible) next = { ...next, focused: visible };
  return next;
}

export function escapeCloses(slots: PanelSlots): boolean {
  return Boolean(slots.watch || slots.companion || slots.solo);
}

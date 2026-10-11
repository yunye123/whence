import { createContext, createElement, useContext } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Globe } from 'lucide-react';
import type { CardData, CardKind, TranscriptLine } from '../model';
import { ArticleIcon, DraftIcon, GroupIcon, ImageIcon, NoteIcon, QuoteIcon, VideoIcon, XLogoIcon } from '../icons/field-icons';

/**
 * The four inspector layouts (DESIGN_SYSTEM §6.18). Exactly one applies at a time:
 * - `docked`  §6.18.1 right panel beside the canvas (note, quote, image, link, draft; text sources while not expanded)
 * - `video`   §6.18.2 watching workbench, the whole window (every video card)
 * - `reading` §6.18.3 text source picked up from the right; the canvas stays visible as a strip on the left
 * - `writing` §6.18.4 focus writing, the whole window; sidebar, top bar, canvas and HUD are hidden
 */
export type InspectorLayout = 'docked' | 'video' | 'reading' | 'writing';

export function inspectorLayoutFor(kind: CardKind, writingExpanded: boolean, readingExpanded: boolean): InspectorLayout {
  if (kind === 'video') return 'video';
  if (kind === 'draft' && writingExpanded) return 'writing';
  if ((kind === 'note' || kind === 'link') && readingExpanded) return 'reading';
  return 'docked';
}

/**
 * Named regions the shell keeps empty for the mode components (see docs/redesign/integration/inspector-shell.md):
 * - `header-meta`    header, after the title: platform, length, reading progress, draft round…
 * - `header-actions` header, before the shell's own expand / close buttons: mode commands (export, versions…)
 * - `lead`           reading: left column (table of contents, quotes taken from this text); writing: left page margin
 * - `margin`         writing: spine groove + source margin (cards hanging on the spine)
 */
export type InspectorSlotName = 'header-meta' | 'header-actions' | 'lead' | 'margin';
export type InspectorSlotTargets = Partial<Record<InspectorSlotName, HTMLElement | null>>;
export interface InspectorShellContextValue { layout: InspectorLayout; slots: InspectorSlotTargets }
export const InspectorShellContext = createContext<InspectorShellContextValue>({ layout: 'docked', slots: {} });
/** Current layout for mode components that need to branch in script (CSS should prefer `.inspector--<layout>`). */
export function useInspectorLayout(): InspectorLayout { return useContext(InspectorShellContext).layout; }

/**
 * Render `children` into a shell region. Before the shell has mounted the region (server rendering, tests,
 * first client render) or in a layout that does not show it, `fallback` renders in place instead.
 */
export function InspectorSlot({ name, children, fallback = null }: { name: InspectorSlotName; children: ReactNode; fallback?: ReactNode }) {
  const target = useContext(InspectorShellContext).slots[name];
  return target ? createPortal(children, target) : fallback;
}

export type ImageSize = { width: number; height: number };
export type TextRange = { from: number; to: number };
export type TextSelection = TextRange & { bodySnapshot: string };
export type SourceReveal = { nodeId: string; quoteNodeId?: string; quoteText?: string; token: number };
export type ReplaceAction = 'subtitles' | 'transcribe';
export type EditingTranscriptLine = { nodeId: string; line: TranscriptLine; revision: string };
export type MediaStatus = 'loading' | 'ready' | 'missing' | 'error' | undefined;
export type PatchCard = (value: Partial<CardData>) => boolean;

export function safeWebUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export function directVideoUrl(value?: string): string | undefined {
  const safe = safeWebUrl(value);
  if (!safe) return undefined;
  return /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(new URL(safe).pathname) ? safe : undefined;
}

const isXPostUrl = (data: Pick<CardData, 'url' | 'sourceUrl'>) => /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i.test(data.url ?? data.sourceUrl ?? '');

/**
 * The kind icon of the panel header: the same custom icons (§9.1) the sidebar list shows for the same card, so the
 * kind reads the same after the card opens (INSP-24). Keep in step with `KindIcon` in src/shell/MaterialsLibrary.tsx.
 */
export function PanelKindIcon({ data, size = 16 }: { data: Pick<CardData, 'kind' | 'tags' | 'url' | 'sourceUrl'>; size?: number }) {
  if (data.kind === 'note' && data.tags?.includes('文字资料')) return createElement(ArticleIcon, { size });
  if (data.kind === 'link' && isXPostUrl(data)) return createElement(XLogoIcon, { size });
  switch (data.kind) {
    case 'video': return createElement(VideoIcon, { size });
    case 'image': return createElement(ImageIcon, { size });
    case 'quote': return createElement(QuoteIcon, { size });
    case 'draft': return createElement(DraftIcon, { size });
    case 'frame': return createElement(GroupIcon, { size });
    case 'link': return createElement(Globe, { size, strokeWidth: 1.75, 'aria-hidden': true });
    default: return createElement(NoteIcon, { size });
  }
}

/** Focusable form controls whose own Escape means "leave this field" before the panel reacts (KB-M1). */
export function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && !!target.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
}

/** Toolbar presses must not steal focus or selection from the editor (contract D17). */
export function keepEditorFocus(event: PointerEvent) {
  if (event.button === 0) event.preventDefault();
}

/** Escape closes an open menu without leaking to the canvas, but never while an IME is composing. */
export function closeDetailsOnEscape(event: KeyboardEvent<HTMLDetailsElement>) {
  if (event.key === 'Escape' && event.currentTarget.open && !event.nativeEvent.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector('summary')?.focus();
  }
}

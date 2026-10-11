import type { MouseEvent } from 'react';
import type { CardActions } from '../board-context';
import type { CardData } from '../model';

/**
 * Runs a card control's action only when the canvas allows activation
 * (select tool, no Shift multiselect, not already consumed, not a double-click's second click).
 */
export type CardActivate = (event: MouseEvent, action: () => void) => void;

/** Props every kind body receives from CanvasCard. */
export interface CardBodyProps {
  id: string;
  data: CardData;
  board: CardActions;
  activate: CardActivate;
  openCard: () => void;
  /** Outer card width in CSS px from the existing node geometry, never read on mount.
   * A material subtracts its own insets before text planning; absent in isolated legacy renders. */
  previewWidth?: number;
  /** Stored explicit text-card height only; automatic measured height is never a planning input. */
  previewHeight?: number;
}

/** Resolved media for the card; owned by CanvasCard so the overview layer shares the same error state. */
export interface CardMedia {
  source?: string;
  poster?: string;
  mediaError: boolean;
  loadingMedia: boolean;
  unavailableMedia: boolean;
  mediaStateMessage: string;
  setMediaError: (value: boolean) => void;
  setPosterError: (value: boolean) => void;
}

/** One excerpt taken from a source card: a time span (video) or a UTF-16 range of the LF body (text). */
export interface ExcerptMark { quoteId?: string; start?: number; end?: number; from?: number; to?: number }

/** Interface-only stationery roles, never stored as a CardKind. */
export type StationeryKind = 'print' | 'folder' | 'index' | 'manuscript' | 'note' | 'photo' | 'lighttable';

/** Discrete zoom tier the card subscribes to (K9-7: an enum, never the continuous viewport). */
export type CardLod = 'full' | 'simple' | 'far';

/**
 * Optional card capabilities that App provides once the cards integration request lands
 * (docs/redesign/integration/cards.md). Until then every field is absent and the card falls back:
 * no excerpt marks on rails, “原文” on text tags, no fresh-placement ring, no lit source outline.
 * After integration these fields move into `CardActions` (board-context.tsx) and this cast becomes a no-op.
 */
export interface CardExtras {
  /** “第 N 段” of a text source at a UTF-16 offset (paragraphIndexAt on the source body). */
  sourceParagraph?(nodeId: string, offset: number): number | undefined;
  /** Tag text of a quote card (“01:12–01:26” / “第 3 段”), used by draft footnotes. */
  quoteLocation?(quoteNodeId: string): string | undefined;
  /** Excerpts taken from this source card, for the video sentence rail and the text length rail. */
  excerptMarks?(nodeId: string): readonly ExcerptMark[];
  /** Cards created, imported or excerpted in the last ~1.2 s (new-placement ring, §6.8). */
  freshCardIds?: ReadonlySet<string>;
  /** Source cards of the selected excerpt (1.5px source-line outline, §6.8). */
  litSourceIds?: ReadonlySet<string>;
  /** Ordinary cards wholly inside a frame, for the tray label count (“4 张”). */
  frameMemberCount?(frameId: string): number | undefined;
  /**
   * Swap the picture or film of a card whose file cannot be shown (CORE-08): pick a file of the same kind,
   * decode-check it like an import, store it and point the card at it in one undo step
   * (docs/redesign/integration/round3-fix-canvas.md). Absent → the card offers “检查素材” instead.
   */
  replaceMedia?(nodeId: string): void;
}

export type CardBoard = CardActions & CardExtras;

/** Read the optional capabilities without widening `CardActions` before integration. */
export function cardExtras(board: CardActions): CardExtras {
  return board as CardBoard;
}

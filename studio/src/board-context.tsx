import { createContext, useContext } from 'react';
import type { BoardEdge, BoardNode, CardData, TranscriptLine } from './model';
import type { TraceOrigin } from './canvas/trace';
import type { VideoPlaybackSnapshot, VideoPlayerSurface } from './video-playback';
import type { DraftReturnInfo, DraftRestoreRequest, DraftSourceRequest, TripWriteMode } from './draft-navigation';
import type { TranscriptScript } from './transcript-tools';
export interface BoardActions {
  updateCard(id: string, patch: Partial<CardData>): boolean;
  openCard(id: string): void;
  readXPost?(id: string): void;
  xPostLoading?(id: string): boolean;
  xPostError?(id: string): string | undefined;
  deleteCard(id: string): void;
  duplicateCard(id: string): void;
  addQuote(nodeId: string, lines: TranscriptLine[], position?: { x: number; y: number }, script?: TranscriptScript): boolean;
  addTextQuote(nodeId: string, range: { from: number; to: number; bodySnapshot?: string }): boolean;
  /** Return to a source; with a canvas in view the trace (§6.17) plays first. `origin` names the draft/footnote it started from. */
  focusSource(nodeId: string, time?: number, keepDraftReturn?: boolean, quoteNodeId?: string, origin?: TraceOrigin): void;
  sourceTextReveal?: { nodeId: string; quoteNodeId?: string; quoteText?: string; token: number } | null;
  completeSourceTextReveal?(token: number): void;
  openDraftSource(request: DraftSourceRequest): boolean;
  draftReturn: DraftReturnInfo | null;
  returnToDraft(): boolean;
  draftRestore: DraftRestoreRequest | null;
  completeDraftRestore(token: number): void;
  getMediaUrl(mediaId?: string): string | undefined;
  getMediaStatus?(mediaId: string): 'loading' | 'ready' | 'missing' | 'error';
  retryMedia?(mediaId: string): void;
  activeVideo: string | null;
  inspectedId: string | null;
  playVideo(id: string | null, time?: number): void;
  videoPlaybackVersion: number;
  getVideoPlayback(id: string): VideoPlaybackSnapshot;
  bindVideoPlayer(id: string, surface: VideoPlayerSurface, player: HTMLVideoElement | null): void;
  captureVideoPlayback(id: string, surface: VideoPlayerSurface, player: HTMLVideoElement): void;
  restoreVideoPlayback(id: string, surface: VideoPlayerSurface, player: HTMLVideoElement): void;
  setPendingTranscriptEdit(id: string, dirty: boolean): void;
  cancelVideoImport(id: string): void;
  retryVideoImport(id: string): void;
  videoImportAvailable: boolean;
  videoImportActionPending(id: string): boolean;
  transcribeVideo?(id: string): void;
  transcriptionMessage?(id: string): string;
  nativeTranscribeAvailable?: boolean;
  readOnly?: boolean;
  tool?: 'select' | 'hand';
  nodes: BoardNode[];
  // Optional capabilities added by the redesign (K2: every new field is optional; tests write complete objects).
  /** Pan the canvas so this card is in the visible area and select it; the inspector stays as it is. */
  revealCard?(id: string): void;
  /** Excerpt like addQuote, then open the new quote with “我的理解” focused (watching workbench §6.18.2). */
  addQuoteAndAnnotate?(nodeId: string, lines: TranscriptLine[], script?: TranscriptScript): boolean;
  /** The board's connections, read-only (the writing margin pins notes connected to the draft, §6.18.4). */
  edges?: BoardEdge[];
  /** Save state for the focus-writing status band (the top bar is covered there). */
  saveStatus?: 'loading' | 'saved' | 'saving' | 'error' | 'readonly';
  saveStatusText?: string;
  retrySave?(): void;
  /** Why the last save failed, and the canvas banner's other ways out, for whole-window layouts that cover it (FD-02). */
  saveError?: string;
  /** Present only when a board lives in a folder that can be reconnected (desktop). */
  reconnectFolder?(): void;
  exportBackup?(): void;
  /** “第 N 段” of a text source at a UTF-16 offset of its LF body. */
  sourceParagraph?(nodeId: string, offset: number): number | undefined;
  /** Tag text of a quote (“01:12–01:26” / “第 3 段”). */
  quoteLocation?(quoteNodeId: string): string | undefined;
  /** Excerpts taken from this source card (video sentence rail, text length rail). */
  excerptMarks?(nodeId: string): readonly { quoteId?: string; start?: number; end?: number; from?: number; to?: number }[];
  /** Cards placed in the last ~1.2 s (new-placement ring, §6.8). */
  freshCardIds?: ReadonlySet<string>;
  /** Source cards of the one selected excerpt (§6.8). */
  litSourceIds?: ReadonlySet<string>;
  /** Ordinary cards wholly inside a frame (tray label count). */
  frameMemberCount?(frameId: string): number | undefined;
  /**
   * “写进文稿” (§6.6): append this excerpt's citation to the draft written last on the board (or a new one) and open it.
   * On a “补一个镜头” trip it goes to the trip's script line instead, as `mode` says (default “配给这一行”, §6.29).
   */
  writeToDraft?(quoteId: string, mode?: TripWriteMode): void;
  /**
   * On a “补一个镜头” trip (§6.29): excerpt these sentences and give them to the trip's script line as its picture
   * (`shot`, the default, “配给这一行”) or write them in after it (`line`, “另起一行写进原话”).
   */
  writeLinesToDraft?(nodeId: string, lines: TranscriptLine[], mode?: TripWriteMode): boolean;
}
export const BoardContext = createContext<BoardActions | null>(null);
export function useBoard() { const value = useContext(BoardContext); if (!value) throw new Error('Board context unavailable'); return value; }

// Canvas cards do not subscribe to board text, positions or draft navigation.
export type CardActions = Pick<BoardActions,
  | 'updateCard' | 'openCard' | 'deleteCard' | 'duplicateCard' | 'addQuote' | 'focusSource'
  | 'getMediaUrl' | 'getMediaStatus' | 'retryMedia' | 'activeVideo' | 'inspectedId' | 'playVideo'
  | 'videoPlaybackVersion' | 'getVideoPlayback' | 'bindVideoPlayer'
  | 'captureVideoPlayback' | 'restoreVideoPlayback'
  | 'cancelVideoImport' | 'retryVideoImport' | 'videoImportAvailable'
  | 'videoImportActionPending' | 'transcribeVideo' | 'transcriptionMessage'
  | 'nativeTranscribeAvailable' | 'readOnly' | 'tool'
  | 'sourceParagraph' | 'quoteLocation' | 'excerptMarks' | 'freshCardIds' | 'litSourceIds' | 'frameMemberCount'
> & { sourceNodeIds: ReadonlySet<string> };
export const CardContext = createContext<CardActions | null>(null);
export function useCard() { const value = useContext(CardContext); if (!value) throw new Error('Card context unavailable'); return value; }

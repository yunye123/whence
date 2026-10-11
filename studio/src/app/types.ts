import type { Board, BoardNode, VideoImportState } from '../model';

export type SaveStatus = 'loading' | 'saving' | 'saved' | 'error' | 'readonly';
export type Modal = 'new' | 'search' | 'export' | 'help' | 'import' | 'imports' | null;
export type CanvasView = 'canvas' | 'outline';
export type CanvasTool = 'select' | 'hand';
export type LibraryFilter = 'all' | 'video' | 'image' | 'note' | 'quote' | 'draft' | 'link';
export type LinkMode = 'video' | 'web' | 'x';
export type ResolvedTheme = 'light' | 'dark';

/** One video import task, addressed by the board and card that created it. */
export interface ImportEntry { board: Board; node: BoardNode; task: VideoImportState }

/** A pending viewport follow (DESIGN_SYSTEM §5.5), applied two frames later so the layout (inspector width) has settled. */
export type CanvasRevealRequest = { boardId: string; ids: string[]; instant: boolean; whenInspected?: string; focus?: boolean };

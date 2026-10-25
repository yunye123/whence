export type CardKind = 'video' | 'image' | 'note' | 'quote' | 'draft' | 'link' | 'frame';
export type CardTone = 'paper' | 'butter' | 'mint' | 'lavender' | 'blue';
export interface TranscriptLine { id: string; start: number; end: number; text: string; originalText?: string; translation?: string }
/** UTF-16 offsets and context refer to the source body after CRLF/CR normalization to LF. */
export interface TextAnchor { from: number; to: number; prefix: string; suffix: string }
export interface Citation { nodeId: string; title: string; start?: number; end?: number; text?: string; transcriptRevision?: string; textAnchor?: TextAnchor }
export type VideoImportStatus = 'queued' | 'downloading' | 'transcribing' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface VideoImportState {
  attemptId: string; url: string; originalText: string; status: VideoImportStatus;
  progress?: number; message: string; error?: string; mediaReady: boolean;
  createdAt: string; updatedAt: string;
}
export interface CardData extends Record<string, unknown> {
  kind: CardKind; title: string; body: string; tone?: CardTone;
  mediaId?: string; poster?: string; url?: string; duration?: number;
  transcript?: TranscriptLine[]; transcriptRevision?: string; citation?: Citation; tags?: string[];
  draftVersions?: { id: string; title: string; body: string; createdAt: string }[];
  nativeAssetId?: string; nativeProjectId?: string; nativeDirectory?: string;
  nativeImportJobId?: string; videoImport?: VideoImportState;
  sourceUrl?: string; sourceOriginalText?: string;
  sourceStatus?: string; sourceAuthor?: string; sourceTitle?: string;
  /** English description from the video's info.json. Not a SQLite Source field. At most 20,000 characters. */
  sourceDescription?: string;
  /** When a source card (video, image, link, text material) was collected into its board, ISO UTC (INSP-21). */
  collectedAt?: string;
  /** Pictures that belong to this one note or link, in reading order. Shown with the card. */
  pictures?: string[];
  /** Simplified Chinese for an English note, excerpt, draft, link body, or video description. The source text stays put. */
  translation?: string;
  demo?: boolean;
}
export interface BoardNode { id: string; type: 'card'; position: { x: number; y: number }; data: CardData; style?: { width?: number; height?: number }; }
export interface BoardEdge { id: string; source: string; target: string; label?: string; type?: string; }
export interface Board {
  id: string; title: string; description: string; category: 'video' | 'writing' | 'design';
  createdAt: string; updatedAt: string; nodes: BoardNode[]; edges: BoardEdge[];
  viewport: { x: number; y: number; zoom: number }; cover?: string;
  groupId?: string; storage?: { id: string; directory: string };
}
export interface BoardGroup { id: string; title: string; collapsed?: boolean }
export interface Workspace { schema: 1; activeBoardId: string; boards: Board[]; groups?: BoardGroup[]; trash?: { board: Board; deletedAt: string }[] }
export interface MediaRecord { id: string; name: string; mime: string; blob: Blob; createdAt: string }
export type TemplateId = 'demo' | 'blank' | 'video' | 'writing' | 'design';
export const cardLabels: Record<CardKind, string> = { video: '视频参考', image: '画面参考', note: '灵感笔记', quote: '原文摘录', draft: '我的文稿', link: '链接资料', frame: '分组区域' };
export const uid = () => crypto.randomUUID();
/** `mm:ss`; from one hour on `H:MM:SS` (CORE-21: the sidebar, “回到原片”, search, export and headers match the tags). */
export function timecode(seconds = 0) {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (value: number) => value.toString().padStart(2, '0');
  return n < 3600 ? `${pad(Math.floor(n / 60))}:${pad(n % 60)}` : `${Math.floor(n / 3600)}:${pad(Math.floor((n % 3600) / 60))}:${pad(n % 60)}`;
}

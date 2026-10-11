export type NodeKind = 'video' | 'image' | 'excerpt' | 'draft' | 'source';
export interface CanvasItem { id: string; type: NodeKind; entityId: string; x: number; y: number; width: number; height: number; group: string; createdRevision?: number }
export interface Source { id: string; url: string; originalText: string; platform: string; title: string; author: string; contentId?: string; status: string; error?: string; createdAt: string }
export interface Asset { id: string; sourceId?: string; name: string; kind: 'video' | 'image'; path: string; hash: string; durationMs: number; hasAudio: boolean; width: number; height: number; poster?: string; thumbnails: string[]; proxy?: string; capture?: { assetId: string; timeMs: number }; createdAt: string; error?: string }
export interface AlignedWord { id: string; text: string; startMs: number; endMs: number; probability?: number }
export interface Segment { id: string; text: string; startMs: number; endMs: number; words: AlignedWord[] }
export interface Transcript { id: string; assetId: string; engine: string; createdAt: string; segments: Segment[]; rawSegments?: Segment[]; device: string; elapsedSeconds: number }
export interface Excerpt { id: string; assetId: string; transcriptId?: string; segmentIds: string[]; wordIds: string[]; quote: string; ranges: { startMs: number; endMs: number }[]; note: string; createdAt: string }
export interface Draft { id: string; title: string; html: string; kind: 'script' | 'publication'; versions: { id: string; createdAt: string; html: string; title: string }[] }
export interface Job { id: string; kind: 'import' | 'transcribe' | 'link' | 'preview'; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; progress: number; message: string; assetId?: string; sourceId?: string; input?: string; error?: string; createdAt: string }
export interface Content { nodes: CanvasItem[]; excerpts: Excerpt[]; drafts: Draft[]; corrections: Record<string, string>; imageNotes: Record<string, string>; viewport: { x: number; y: number; zoom: number } }
export interface ProjectState { schemaVersion: 1; id: string; name: string; directory: string; createdAt: string; updatedAt: string; revision: number; assets: Asset[]; sources: Source[]; transcripts: Transcript[]; jobs: Job[]; content: Content }
export interface Diagnostics { python: string; ffmpeg: string; ffprobe: string; model: string; downloader: boolean; checks: { name: string; ok: boolean; detail: string }[] }
export interface StudioAPI {
  getState(): Promise<ProjectState | null>;
  /** Select an existing parent directory and create a new child named after the project. */
  createProject(name: string, parentDirectory?: string): Promise<ProjectState | null>;
  openProject(directory?: string): Promise<ProjectState | null>;
  renameProject(name: string): Promise<ProjectState>;
  saveContent(content: Content, baseRevision?: number): Promise<ProjectState>;
  importFiles(paths?: string[], sourceId?: string): Promise<void>;
  importLink(text: string): Promise<void>;
  importClipboard(): Promise<void>;
  transcribe(assetId: string, cpu?: boolean): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  retryJob(jobId: string): Promise<void>;
  screenshot(assetId: string, timeMs: number): Promise<void>;
  exportDocument(kind: 'txt' | 'md' | 'srt', entityId: string, destination?: string): Promise<string | null>;
  exportProject(destination?: string): Promise<string | null>;
  restoreProject(archive?: string, destination?: string): Promise<ProjectState | null>;
  diagnostics(): Promise<Diagnostics>;
  mediaUrl(projectId: string, relativePath: string): string;
  filePath(file: File): string;
  openExternal(url: string): Promise<void>;
  onState(callback: (state: ProjectState) => void): () => void;
  onFlush(callback: () => Promise<void>): () => void;
}
declare global { interface Window { studio: StudioAPI } }

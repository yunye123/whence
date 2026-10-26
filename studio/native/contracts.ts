import type { ProjectState } from '../../shared/types';
import type { Board, BoardNode, CardData } from '../src/model';
import type { DirectoryChoice, StoredMedia, BoardOpenResult, BoardOpenedResult } from './board-storage';
import type { XImportResult, XImportRequest } from '../shared/x-import';
import type { EnglishTranslationRequest, EnglishTranslationResult } from '../src/english-translation';
import type { TranslationSettingsResponse, TranslationSettingsStatus } from './translation-settings';

export type VideoImportStage = 'queued' | 'downloading' | 'processing' | 'media-ready' | 'transcribing' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface VideoImportInput {
  url: string;
  originalText?: string;
  boardId: string;
  nodeId: string;
  existingNode?: BoardNode;
}
export interface VideoImportTask {
  id: string;
  boardId: string;
  nodeId: string;
  url: string;
  originalText: string;
  platform: string;
  status: VideoImportStage;
  progress: number;
  message: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  card?: Partial<CardData>;
  /** Further pictures from one image note. The first card stays on the original node. */
  companions?: { id: string; data: Partial<CardData> }[];
  assetId?: string;
  sourceId?: string;
  reused?: boolean;
  asr?: { engine: string; device: string; elapsedSeconds: number };
}
export interface VideoImportProgress {
  stage: VideoImportStage;
  progress: number;
  message: string;
  jobId: string;
  attempt: number;
}
export interface VideoImportOptions {
  signal?: AbortSignal;
  onProgress?: (event: VideoImportProgress) => void;
  onMediaReady?: (patch: Partial<CardData>) => void;
  onComplete?: (task: VideoImportTask) => void;
}
export interface FieldVideoImportsAPI {
  submit(input: VideoImportInput): Promise<VideoImportTask>;
  submitLocal(input: { boardId: string; nodeId: string; name: string; data: Uint8Array }): Promise<VideoImportTask>;
  list(): Promise<VideoImportTask[]>;
  cancel(taskId: string, expectedAttempt?: number): Promise<VideoImportTask>;
  retry(taskId: string): Promise<VideoImportTask>;
  libraryState(): Promise<ProjectState>;
  onTask(callback: (task: VideoImportTask) => void): () => void;
}
export interface FieldBoardStorageAPI {
  chooseDirectory(): Promise<DirectoryChoice | null>;
  create(choiceId: string, board: Board, media?: StoredMedia[]): Promise<DirectoryChoice>;
  save(id: string, board: Board, media: StoredMedia[]): Promise<Board>;
  open(existing?: { id: string; directory?: string }[]): Promise<BoardOpenResult | null>;
  recoverPrevious(recoveryId: string): Promise<BoardOpenedResult | null>;
  exportDirectory(board: Board, media: StoredMedia[]): Promise<{ status: 'saved'; directory: string } | { status: 'cancelled' }>;
  readMedia(id: string, mediaId: string): Promise<Uint8Array>;
  reveal(id: string): Promise<void>;
}
export interface FieldLocalFilesAPI { readClipboard(): Promise<{ files: { name: string; mime: string; data: Uint8Array }[]; text: string; failures: string[] }> }
export interface FieldFileExportAPI {
  save(input: { format: 'field-json' | 'markdown' | 'txt' | 'srt' | 'csv' | 'png' | 'pdf'; suggestedName: string; data: Uint8Array }): Promise<{ status: 'saved'; path: string } | { status: 'cancelled' }>;
}
/** Desktop PDF bridge (native/pdf-render.ts): one self-contained HTML document in, PDF bytes out (round 4, script PDF). */
export interface FieldPdfAPI { render(html: string, options: { pageSize: 'A4'; landscape: boolean }): Promise<Uint8Array> }
export interface FieldXImportsAPI {
  resolve(input: XImportRequest): Promise<XImportResult>;
  cancel(requestId: string): Promise<void>;
}
export interface FieldTranslateAPI {
  translate(input: EnglishTranslationRequest): Promise<EnglishTranslationResult>;
}
/** Desktop translation key. `read` and the save result never include the key. */
export interface FieldTranslationSettingsAPI {
  read(): Promise<TranslationSettingsStatus>;
  save(input: { apiKey: string; baseUrl: string; model: string }): Promise<TranslationSettingsResponse>;
  clear(): Promise<TranslationSettingsResponse>;
}
export interface FieldWebPageAPI {
  fetch(url: string): Promise<{ title: string; body: string } | null>;
}
export interface FieldAgentBoardRequest { boardId: string; method: 'GET' | 'PUT'; body: string }
export interface FieldAgentBoardAPI {
  onRequest(callback: (request: FieldAgentBoardRequest) => Promise<{ status: number; body: string }> | { status: number; body: string }): () => void;
}
declare global { interface Window { fieldVideoImports?: FieldVideoImportsAPI; fieldBoardStorage?: FieldBoardStorageAPI; fieldLocalFiles?: FieldLocalFilesAPI; fieldFileExport?: FieldFileExportAPI; fieldXImports?: FieldXImportsAPI; fieldPdf?: FieldPdfAPI; fieldTranslate?: FieldTranslateAPI; fieldTranslationSettings?: FieldTranslationSettingsAPI; fieldWebPage?: FieldWebPageAPI; fieldAgentBoard?: FieldAgentBoardAPI } }

export const VIDEO_IMPORT_TERMINAL: ReadonlySet<VideoImportStage> = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

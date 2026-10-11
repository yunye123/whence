import type { BoardNode } from '../model';

/** Release 2 adds cover here; release 1 deliberately has no visible cover option. */
export type ExportFormat = 'script' | 'markdown' | 'moodboard' | 'package' | 'directory';
export const EXPORT_FORMAT_KEY = 'field.export-format.v1';
export const EXPORT_FORMATS: readonly { id: ExportFormat; title: string; label: string; detail: string }[] = [
  { id: 'script', title: '分镜脚本', label: 'PDF', detail: '画面缩略图、时间码、旁白与来源，可直接打印交付。' },
  { id: 'markdown', title: '文稿与参考资料', label: 'Markdown', detail: '文稿、笔记和摘录；每处引用的出处写成脚注，适合交付和归档。' },
  { id: 'moodboard', title: '灵感板', label: 'PNG · PDF', detail: '把一个分组里的图片按原比例排成一张图或一页 PDF。' },
  { id: 'package', title: '便携画布文件', label: '.field.json', detail: '布局、连线、原文、版本和较小的素材文件，可以重新导入继续编辑。' },
  { id: 'directory', title: '另存完整画布目录', label: '文件夹', detail: '独立副本，包含大视频和全部素材文件，日后直接打开。' },
];
/** D4 suggested copy; waiting/empty/busy messages stay in one place. */
export const EXPORT_COPY = {
  noDraft: '本画布没有文稿。先添加一篇文稿，再导出分镜脚本。',
  noImages: '本画布没有图片。',
  desktop: '需要桌面版',
  preparingScript: '正在准备分镜脚本…',
  preparingMoodboard: '正在读取图片…',
  busy: '正在导出…',
  printOpened: '已打开打印窗口：选“另存为 PDF”即可保存',
  scriptSaved: '已保存分镜脚本 PDF',
  noPreview: '此格式不提供预览，导出时包含以下内容。',
} as const;
export type FormatMemory = Partial<Record<string, ExportFormat>>;
const isFormat = (value: unknown): value is ExportFormat => EXPORT_FORMATS.some(format => format.id === value);

export function parseFormatMemory(raw: string | null): FormatMemory {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, format]) => isFormat(format)));
  } catch { return {}; }
}
export function formatMemoryValue(memory: FormatMemory, boardId: string, format: ExportFormat): string {
  return JSON.stringify({ ...memory, [boardId]: format });
}
export function defaultExportFormat(boardId: string, memory: FormatMemory, available: readonly ExportFormat[], initialView?: 'list' | 'moodboard'): ExportFormat {
  if (initialView === 'moodboard' && available.includes('moodboard')) return 'moodboard';
  const saved = Object.hasOwn(memory, boardId) ? memory[boardId] : undefined;
  return saved && available.includes(saved) ? saved : 'markdown';
}
export function moveExportFormat(current: ExportFormat, key: string, available: readonly ExportFormat[]): ExportFormat | undefined {
  if (!available.length) return undefined;
  if (key === 'Home') return available[0];
  if (key === 'End') return available.at(-1);
  const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 0;
  if (!step) return undefined;
  return available[(Math.max(0, available.indexOf(current)) + step + available.length) % available.length];
}
/** No per-card edit timestamp exists in stored data. Integration can pass its session's most recently edited id. */
export function defaultScriptDraft(nodes: readonly BoardNode[], currentDraftId?: string | null, lastModifiedDraftId?: string): BoardNode | undefined {
  const drafts = nodes.filter(node => node.data.kind === 'draft');
  const current = drafts.find(node => node.id === currentDraftId) ?? drafts.find(node => node.id === lastModifiedDraftId);
  if (current) return current;
  const time = (node: BoardNode) => Math.max(0, ...(node.data.draftVersions ?? []).map(version => Date.parse(version.createdAt) || 0));
  return drafts.reduce<BoardNode | undefined>((recent, node) => !recent || time(node) > time(recent) ? node : recent, undefined);
}
export function exportFilename(title: string, format: ExportFormat): string {
  const fallback = format === 'script' ? '未命名文稿' : format === 'markdown' ? '文稿' : '画布';
  const safe = (title || fallback).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/[. ]+$/g, '').trim() || fallback;
  return format === 'script' ? `${safe.slice(0, 90)}-分镜脚本.pdf` : `${safe}${format === 'markdown' ? '.md' : format === 'package' ? '.field.json' : ''}`;
}

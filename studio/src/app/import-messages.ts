import { storableMediaType } from '../storage';
import { errorMessage } from './utils';

/**
 * What a file import says about each file (CORE-07, CORE-08): the reason in plain words and what to do next, in the
 * file's own name. Technical wording (MIME types, “媒体格式”) never reaches the toast.
 */
export type ImportKind = 'image' | 'video' | 'svg' | 'mkv' | 'video-format' | 'image-format' | 'other';

/** A refusal the import already worded for the user. */
export class ImportRefusal extends Error {}

export function importKind(file: File): ImportKind {
  const type = file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (type === 'image/svg+xml' || extension === 'svg') return 'svg';
  const storable = storableMediaType(file);
  if (storable?.startsWith('image/')) return 'image';
  if (storable?.startsWith('video/')) return 'video';
  if (type === 'video/x-matroska' || extension === 'mkv') return 'mkv';
  if (type.startsWith('video/') || ['avi', 'wmv', 'flv', 'ts', 'mts', '3gp'].includes(extension)) return 'video-format';
  if (type.startsWith('image/') || ['heic', 'heif', 'tif', 'tiff', 'bmp', 'psd', 'raw'].includes(extension)) return 'image-format';
  return 'other';
}

export function importRefusal(file: File, kind: ImportKind): string {
  const name = `「${file.name}」`;
  switch (kind) {
    case 'svg': return `${name}是 SVG，来处还不能直接放进画布。存为 PNG 或 JPG 后再导入`;
    case 'mkv': return `来处还不能播放 MKV。在剪辑软件或 OBS 里把${name}改存为 MP4 后再导入`;
    case 'video-format': return `来处还不能播放${name}的格式。改存为 MP4 后再导入`;
    case 'image-format': return `来处还不能显示${name}的格式。存为 JPG 或 PNG 后再导入`;
    default: return `${name}不是来处能读的文件。可以导入 TXT、Markdown、图片和视频`;
  }
}

/** Any other failure of one file, worded from the error the reader or storage raised. */
export function importFailure(file: File, error: unknown): string {
  const name = `「${file.name}」`;
  const message = errorMessage(error);
  if (/没有可导入的正文/.test(message)) return `${name}里没有文字。换一个文件再试`;
  if (/为空或无效/.test(message)) return `${name}是空文件。换一个文件再试`;
  if (/最大为 64 MiB/.test(message)) return `${name}超过 64 MB。压缩或裁剪后再导入`;
  if (/暂不支持此媒体格式/.test(message)) return importRefusal(file, importKind(file) === 'image' ? 'image-format' : importKind(file) === 'video' ? 'video-format' : importKind(file));
  return `${name}：${message.replace(/[。.]$/, '')}`;
}

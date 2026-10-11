import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** CORE-30: the moodboard export (png, pdf) saves through the same native dialog as the text formats. */
export type FileExportFormat = 'field-json' | 'markdown' | 'txt' | 'srt' | 'csv' | 'png' | 'pdf';
export interface FileExportInput { format: FileExportFormat; suggestedName: string; data: Uint8Array }
export interface SavedFileExport { status: 'saved'; path: string }
export type NativeFileExportResult = SavedFileExport | { status: 'cancelled' };
export const FILE_EXPORT_LIMITS: Readonly<Record<FileExportFormat, number>> = {
  'field-json': 96 * 1024 * 1024, markdown: 96 * 1024 * 1024,
  txt: 4 * 1024 * 1024, srt: 4 * 1024 * 1024, csv: 4 * 1024 * 1024,
  png: 64 * 1024 * 1024, pdf: 96 * 1024 * 1024,
};
const extensions: Record<FileExportFormat, string> = { 'field-json': '.field.json', markdown: '.md', txt: '.txt', srt: '.srt', csv: '.csv', png: '.png', pdf: '.pdf' };
/** Binary formats must start with their own signature, so a mislabelled payload never lands under a .png or .pdf name. */
const SIGNATURES: Partial<Record<FileExportFormat, number[]>> = { png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pdf: [0x25, 0x50, 0x44, 0x46, 0x2d] };
class ExportValidationError extends Error {}
class ExportPublicError extends Error {}

/** This is a filename suggestion only; it can never authorize a renderer path. */
function exportName(value: string, format: FileExportFormat): string {
  const extension = extensions[format];
  let name = value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/[. ]+$/g, '').trim();
  if (name.toLowerCase().endsWith(extension)) name = name.slice(0, -extension.length);
  name = name.slice(0, 160).replace(/[. ]+$/g, '').trim() || '来处作品';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `来处-${name}`;
  return `${name}${extension}`;
}

/** Validate before displaying the native save dialog; take ownership of its bytes. */
export function validateFileExportInput(value: unknown): FileExportInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExportValidationError('导出内容格式不正确。');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['format', 'suggestedName', 'data'].includes(key))) throw new ExportValidationError('导出内容包含不支持的字段。');
  if (typeof input.format !== 'string' || !Object.hasOwn(extensions, input.format)) throw new ExportValidationError('导出格式不受支持。');
  if (typeof input.suggestedName !== 'string' || input.suggestedName.length > 500) throw new ExportValidationError('导出文件名称过长或格式不正确。');
  const format = input.format as FileExportFormat;
  if (!(input.data instanceof Uint8Array) || input.data.byteLength > FILE_EXPORT_LIMITS[format]) throw new ExportValidationError(`导出文件超过 ${FILE_EXPORT_LIMITS[format] / 1024 / 1024} MiB 或内容格式不正确。`);
  if (format === 'field-json' && !input.data.byteLength) throw new ExportValidationError('便携画布文件不能为空。');
  const signature = SIGNATURES[format];
  if (signature && !signature.every((byte, index) => input.data instanceof Uint8Array && input.data[index] === byte)) throw new ExportValidationError(`导出的${format.toUpperCase()}内容不完整，请重新导出。`);
  return { format, suggestedName: exportName(input.suggestedName, format), data: new Uint8Array(input.data) };
}

/** Never disclose filesystem paths or native stacks in the renderer's error notice. */
export function fileExportError(error: unknown): Error {
  if (error instanceof ExportValidationError || error instanceof ExportPublicError) return new ExportPublicError(error.message);
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    ENOSPC: '保存位置空间不足，请选择其他位置。',
    EACCES: '无法写入保存位置，请选择有写入权限的文件夹。',
    EPERM: '无法写入保存位置，文件可能正在使用，请关闭文件或选择其他位置。',
    EBUSY: '文件正在使用，请关闭文件或选择其他位置。',
    ENOENT: '保存位置已不存在，请重新选择文件夹。',
    ENOTDIR: '保存位置不可用，请重新选择文件夹。',
    EISDIR: '所选位置是文件夹，请选择文件名称。',
  };
  return new ExportPublicError(messages[code] ?? '文件未保存，请检查保存位置后重试。');
}

/** selectedPath is trusted ONLY when it came from the main process save dialog. */
export async function writeSelectedExport(selectedPath: string, input: FileExportInput): Promise<SavedFileExport> {
  const checked = validateFileExportInput(input);
  if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath) || selectedPath.includes('\u0000')) throw new ExportValidationError('请通过保存窗口选择文件位置。');
  const destination = path.resolve(selectedPath);
  const temporary = path.join(path.dirname(destination), `.field-export-${randomUUID()}.tmp`);
  let created = false;
  try {
    const file = await fs.open(temporary, 'wx', 0o600); created = true;
    try { await file.writeFile(checked.data); await file.sync(); } finally { await file.close(); }
    await fs.rename(temporary, destination); created = false;
    return { status: 'saved', path: destination };
  } catch (error) {
    // This exact file was created by this call; never touch another file or the destination.
    if (created) await fs.unlink(temporary).catch(() => {});
    throw fileExportError(error);
  }
}

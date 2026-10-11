import type { FileExportFormat, FileExportInput, NativeFileExportResult } from '../native/file-export';

export type { FileExportFormat, FileExportInput } from '../native/file-export';
export type FileExportResult = NativeFileExportResult | { status: 'download-started' };
const mime: Record<FileExportFormat, string> = {
  'field-json': 'application/json', markdown: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8', srt: 'application/x-subrip;charset=utf-8', csv: 'text/csv;charset=utf-8',
  png: 'image/png', pdf: 'application/pdf',
};
const extension: Record<FileExportFormat, string> = { 'field-json': '.field.json', markdown: '.md', txt: '.txt', srt: '.srt', csv: '.csv', png: '.png', pdf: '.pdf' };
const DOWNLOAD_URL_LIFETIME = 60_000;
const limits: Record<FileExportFormat, number> = { 'field-json': 96 * 1024 * 1024, markdown: 96 * 1024 * 1024, txt: 4 * 1024 * 1024, srt: 4 * 1024 * 1024, csv: 4 * 1024 * 1024, png: 64 * 1024 * 1024, pdf: 96 * 1024 * 1024 };

/** Desktop resolves only after the bytes are saved. Browsers cannot confirm completion. */
export async function saveExport(input: FileExportInput): Promise<FileExportResult> {
  if (window.fieldFileExport) return window.fieldFileExport.save(input);
  if (!Object.hasOwn(mime, input.format) || !(input.data instanceof Uint8Array) || typeof input.suggestedName !== 'string' || input.suggestedName.length > 500) throw new Error('导出格式或内容不正确。');
  if (input.data.byteLength > limits[input.format]) throw new Error(`导出文件超过 ${limits[input.format] / 1024 / 1024} MiB，请分段导出。`);
  if (input.format === 'field-json' && !input.data.byteLength) throw new Error('便携画布文件不能为空。');
  const blob = new Blob([new Uint8Array(input.data)], { type: mime[input.format] });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const suffix = extension[input.format];
  const name = input.suggestedName.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/[. ]+$/g, '').trim() || '来处作品';
  anchor.href = url;
  anchor.download = name.toLowerCase().endsWith(suffix) ? name : `${name}${suffix}`;
  try { document.body.append(anchor); anchor.click(); }
  finally {
    anchor.remove();
    // Revoking synchronously can interrupt the browser's consumption of the Blob URL.
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME);
  }
  return { status: 'download-started' };
}

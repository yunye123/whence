import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ClipboardReader { read?: () => Promise<{ types: string[]; getType(type: string): Promise<Blob> }[]>; readText(): string | Promise<string>; availableFormats?: () => string[]; readBuffer?: (format: string) => Buffer; readImage?: () => { isEmpty(): boolean; toPNG(): Buffer } }
export interface PastedFile { name: string; mime: string; data: Uint8Array }
const types: Record<string, string> = { '.mp4':'video/mp4', '.mov':'video/quicktime', '.webm':'video/webm', '.m4v':'video/x-m4v', '.ogv':'video/ogg', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.avif':'image/avif', '.txt':'text/plain', '.md':'text/markdown' };
export function dropFilePaths(buffer: Buffer): string[] {
  if (buffer.length < 22) return []; const offset = buffer.readUInt32LE(0);
  if (offset < 20 || offset >= buffer.length) return [];
  return buffer.subarray(offset).toString(buffer.readUInt32LE(16) ? 'utf16le' : 'latin1').split('\0').filter(Boolean).slice(0, 21);
}
/** Only invoked by a user's paste gesture; paths come from the native clipboard, never renderer strings. */
export async function readClipboardFiles(clipboard: ClipboardReader): Promise<{ files: PastedFile[]; text: string; failures: string[] }> {
  const paths: string[] = []; let image: Uint8Array | undefined;
  if (clipboard.read) {
    for (const item of await clipboard.read()) for (const type of item.types) {
      if (/CF_HDROP|FileDrop|format="15"/i.test(type)) paths.push(...dropFilePaths(Buffer.from(await (await item.getType(type)).arrayBuffer())));
      if (type === 'text/uri-list') for (const value of (await (await item.getType(type)).text()).split(/\r?\n/).slice(0, 21)) { try { const url = new URL(value); if (url.protocol === 'file:') paths.push(fileURLToPath(url)); } catch {} }
      if (type === 'image/png' && !image) image = new Uint8Array(await (await item.getType(type)).arrayBuffer());
    }
  } else {
    for (const format of clipboard.availableFormats?.() ?? []) if (/CF_HDROP|FileDrop/i.test(format)) paths.push(...dropFilePaths(clipboard.readBuffer!(format)));
    const native = clipboard.readImage?.(); if (native && !native.isEmpty()) image = new Uint8Array(native.toPNG());
  }
  const files: PastedFile[] = [], failures: string[] = [];
  if (paths.length > 20) throw new Error('一次最多粘贴 20 个文件，请分批粘贴。');
  for (const file of [...new Set(paths)]) {
    const name = path.basename(file); const mime = types[path.extname(name).toLowerCase()];
    try { if (!mime) throw new Error('暂不支持这个文件格式'); const stat = await fs.stat(file); if (!stat.isFile() || stat.size < 1 || stat.size > (mime.startsWith('text/') ? 4 : 64) * 1024 * 1024) throw new Error('文件为空或超过大小限制'); files.push({ name, mime, data: new Uint8Array(await fs.readFile(file)) }); }
    catch (error) { failures.push(`${name}：${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!paths.length && image && image.byteLength <= 64 * 1024 * 1024) files.push({ name: '剪贴板图片.png', mime: 'image/png', data: image });
  const text = String(await clipboard.readText()); if (text.length > 300_000) throw new Error('剪贴板文字超过 300,000 字符，请分段粘贴。');
  return { files, text, failures };
}

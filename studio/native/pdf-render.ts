import type { BrowserWindow as BrowserWindowType, Session } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Desktop PDF bridge for the script view's “分镜脚本 PDF” (round 4, integration/round4-script-edit.md C1): the renderer
 * hands over one self-contained HTML document (styles inline, every picture a data: URL, fonts at absolute URLs of the
 * app itself) and gets PDF bytes back; saving still goes through the verified export (saveExport → field-export).
 *
 * The page is printed in a hidden, sandboxed window with scripts off, in a throw-away in-memory session that can only
 * load data: URLs, the document and the app's own files (the loopback dev origin, or the folder of the offline build) —
 * nothing from the network, no permissions, no navigation, no new windows. The document is served from memory at an
 * address beside the app (`/__field-print/<id>.html`), so the app's fonts are same-origin and a long script full of
 * thumbnails is not cut at Chromium's 2 MB data: URL limit. Electron objects are passed in (no runtime import; testable).
 */

export const PDF_HTML_LIMIT = 64 * 1024 * 1024;
export interface PdfRenderOptions { pageSize: 'A4'; landscape: boolean }
export interface PdfRenderDeps {
  BrowserWindow: typeof BrowserWindowType;
  fromPartition(partition: string, options?: { cache: boolean }): Session;
  /** Electron's net.fetch. */
  fetch(input: Request, init?: { bypassCustomProtocolHandlers?: boolean }): Promise<Response>;
}

/** Checks what the renderer sent; only A4 is offered, landscape unless asked otherwise. */
export function validatePdfRequest(html: unknown, options: unknown): { html: string; options: PdfRenderOptions } {
  if (typeof html !== 'string' || !html.trim() || html.length > PDF_HTML_LIMIT) throw new Error('打印内容不正确或超过 64 MB。');
  const raw = options && typeof options === 'object' ? options as Record<string, unknown> : {};
  if (raw.pageSize !== undefined && raw.pageSize !== 'A4') throw new Error('只支持 A4 纸。');
  return { html, options: { pageSize: 'A4', landscape: raw.landscape !== false } };
}

/** The loopback dev origin of `base`, or null. */
function loopback(base: URL): boolean {
  return base.protocol === 'http:' && base.hostname === '127.0.0.1' && !!base.port && !base.username && !base.password;
}

/** Where the print document is served: beside the app (same origin as its fonts). Null when `base` is neither. */
export function printDocumentUrl(base: string, id: string): string | null {
  let origin: URL;
  try { origin = new URL(base); } catch { return null; }
  if (loopback(origin)) return `${origin.origin}/__field-print/${id}.html`;
  if (origin.protocol === 'file:') {
    try { return pathToFileURL(path.join(path.dirname(fileURLToPath(origin)), `__field-print-${id}.html`)).href; } catch { return null; }
  }
  return null;
}

/**
 * Whether the print page may load `url`: data: URLs and the app's own files — the loopback origin of `base`
 * (http://127.0.0.1:<port>, the dev frontend) or files inside the folder of a file:// `base` (the offline build).
 */
export function pdfRequestAllowed(url: string, base: string): boolean {
  if (url.startsWith('data:')) return true;
  let target: URL, origin: URL;
  try { target = new URL(url); origin = new URL(base); } catch { return false; }
  if (loopback(origin)) return target.origin === origin.origin;
  if (origin.protocol === 'file:' && target.protocol === 'file:') {
    try {
      const root = path.dirname(fileURLToPath(origin)), file = path.resolve(fileURLToPath(target));
      return file.toLowerCase().startsWith((root + path.sep).toLowerCase());
    } catch { return false; }
  }
  return false;
}

const PDF_SIGNATURE = Buffer.from('%PDF-');

export async function renderHtmlToPdf(deps: PdfRenderDeps, html: unknown, options: unknown, base: string): Promise<Uint8Array> {
  const checked = validatePdfRequest(html, options);
  const id = randomUUID();
  const documentUrl = printDocumentUrl(base, id);
  if (!documentUrl) throw new Error('当前窗口不能生成 PDF。');
  const scheme = new URL(documentUrl).protocol.slice(0, -1);
  // No "persist:" prefix: the session lives in memory and goes away with the window.
  const session = deps.fromPartition(`field-pdf-${id}`, { cache: false });
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== documentUrl && !pdfRequestAllowed(details.url, base) }));
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.protocol.handle(scheme, request => {
    if (request.url === documentUrl) return new Response(checked.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (!pdfRequestAllowed(request.url, base)) return new Response('', { status: 403 });
    return deps.fetch(request, { bypassCustomProtocolHandlers: true });
  });
  const window = new deps.BrowserWindow({
    show: false, width: 1123, height: 794,
    webPreferences: { session, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webgl: false, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  try {
    await window.loadURL(documentUrl);
    const data = await window.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, landscape: checked.options.landscape, pageSize: checked.options.pageSize });
    if (!Buffer.from(data.subarray(0, PDF_SIGNATURE.length)).equals(PDF_SIGNATURE)) throw new Error('PDF 生成失败。');
    return new Uint8Array(data);
  } finally {
    window.destroy();
    session.protocol.unhandle(scheme);
  }
}

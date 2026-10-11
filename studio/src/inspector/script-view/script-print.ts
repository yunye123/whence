import type { BoardNode } from '../../model';
import { saveExport } from '../../file-export';
import type { FileExportFormat } from '../../file-export';
import { frameFor, playableUrl } from './ShotFrame';
import { PRINT_FONTS_FALLBACK, PRINT_PALETTE_FALLBACK, scriptPrintHtml, scriptSource } from './script-export';
import type { PrintFonts, PrintPalette } from './script-export';
import { isScriptLine } from './script-model';

/**
 * 带缩略图的 PDF（§6.29 导出）：准备打印文档（每个镜头起点那一帧、浅色令牌、页面自己的字体），再交给打印。
 * - 桌面版有原生 PDF 打印桥（`window.fieldPdf`，见 integration/round4-script-edit.md）时：直接得到 PDF 字节，经现有的
 *   保存窗口（saveExport，pdf 签名校验）存到本机。
 * - 否则（浏览器、桥未接上的桌面版）：把同一份文档放进隐藏 iframe 调起打印，在打印窗口里选“另存为 PDF”。
 */

/** Optional desktop bridge: renders a self-contained HTML page to PDF bytes (Electron webContents.printToPDF). */
interface FieldPdfBridge { render(html: string, options: { pageSize: 'A4'; landscape: boolean }): Promise<Uint8Array> }
const pdfBridge = (): FieldPdfBridge | undefined => (window as unknown as { fieldPdf?: FieldPdfBridge }).fieldPdf;

/** Dedicated, theme-independent print tokens: a dark desk still exports white paper. */
export function printPalette(): PrintPalette {
  if (typeof document === 'undefined') return PRINT_PALETTE_FALLBACK;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;color-scheme:light';
  document.body.append(probe);
  const read = (token: string, fallback: string) => { probe.style.color = ''; probe.style.color = `var(${token})`; return getComputedStyle(probe).color || fallback; };
  const palette: PrintPalette = {
    ink: read('--print-ink', PRINT_PALETTE_FALLBACK.ink), ink2: read('--print-ink-2', PRINT_PALETTE_FALLBACK.ink2), ink3: read('--print-ink-3', PRINT_PALETTE_FALLBACK.ink3),
    rule: read('--print-rule', PRINT_PALETTE_FALLBACK.rule), ruleStrong: read('--print-rule-strong', PRINT_PALETTE_FALLBACK.ruleStrong),
    source: read('--print-ink-2', PRINT_PALETTE_FALLBACK.source), tag: read('--print-zhu', PRINT_PALETTE_FALLBACK.tag), tagOn: read('--print-ink', PRINT_PALETTE_FALLBACK.tagOn),
    paper: read('--print-paper', PRINT_PALETTE_FALLBACK.paper), sunken: read('--print-sunken', PRINT_PALETTE_FALLBACK.sunken),
  };
  probe.remove();
  return palette;
}

export function printFonts(): PrintFonts {
  if (typeof document === 'undefined') return PRINT_FONTS_FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const read = (token: string, fallback: string) => style.getPropertyValue(token).trim() || fallback;
  return { serif: read('--font-read', PRINT_FONTS_FALLBACK.serif), sans: read('--font-ui', PRINT_FONTS_FALLBACK.sans), num: read('--font-num', PRINT_FONTS_FALLBACK.num) };
}

/** The page's @font-face rules with absolute URLs (resolved against their own stylesheet), for the print document. */
export function pageFontFaces(): string {
  if (typeof document === 'undefined') return '';
  const rules: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    const base = sheet.href ?? document.baseURI;
    const visit = (items: CSSRuleList) => {
      for (const rule of [...items]) {
        if (rule instanceof CSSFontFaceRule) rules.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote: string, value: string) => {
          if (/^(?:data|blob):/i.test(value)) return match;
          try { return `url("${new URL(value, base).href}")`; } catch { return match; }
        }));
        else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    visit(list);
  }
  return rules.join('\n');
}

/** An image URL as a data URL (posters may be page paths or blob URLs, which another window cannot read). */
async function asDataUrl(url: string): Promise<string | undefined> {
  if (/^data:image\//i.test(url)) return url;
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return undefined;
    return await new Promise<string | undefined>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

/** The picture of every shot: the frame at its start (as on screen), else the source's poster. */
export async function shotPictures(body: string, nodes: readonly BoardNode[], getMediaUrl: (mediaId?: string) => string | undefined): Promise<Map<number, string>> {
  const { model, references } = scriptSource(body, nodes);
  const byIndex = new Map(references.map(reference => [reference.index, reference]));
  const shots = model.scenes.flatMap(scene => scene.rows.filter(isScriptLine)).flatMap(line => line.shots);
  const pictures = new Map<number, string>();
  const posters = new Map<string, Promise<string | undefined>>();
  await Promise.all(shots.map(async shot => {
    const source = byIndex.get(shot.reference)?.source;
    if (!source) return;
    const url = playableUrl(getMediaUrl(source.data.mediaId) || source.data.url);
    if (url && shot.start !== undefined) {
      const frame = await frameFor(url, shot.start, shot.end);
      if (frame !== 'live' && frame !== 'failed') { pictures.set(shot.reference, frame); return; }
    }
    const poster = source.data.poster;
    if (!poster) return;
    if (!posters.has(poster)) posters.set(poster, asDataUrl(poster));
    const data = await posters.get(poster);
    if (data) pictures.set(shot.reference, data);
  }));
  return pictures;
}

export function printDate(now = new Date()): string {
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
}

/** The whole print document of a draft's script. */
export async function scriptPrintDocument(title: string, body: string, nodes: readonly BoardNode[], getMediaUrl: (mediaId?: string) => string | undefined): Promise<string> {
  const { model, references } = scriptSource(body, nodes);
  const pictures = await shotPictures(body, nodes, getMediaUrl);
  return scriptPrintHtml({ title, model, references, pictures, date: printDate(), base: document.baseURI, fontFaces: pageFontFaces(), palette: printPalette(), fonts: printFonts() });
}

/** Print a self-contained HTML document from a hidden frame (the browser's print window offers “另存为 PDF”). */
async function printInFrame(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.className = 'script-print-frame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  const view = frame.contentWindow, doc = frame.contentDocument;
  if (!view || !doc) { frame.remove(); throw new Error('打印窗口没有打开。'); }
  await doc.fonts?.ready;
  await Promise.all([...doc.images].map(image => image.decode().catch(() => undefined)));
  const remove = () => window.setTimeout(() => frame.remove(), 400);
  view.addEventListener('afterprint', remove, { once: true });
  view.focus();
  view.print();
  // Some print windows return before afterprint; the frame never outlives a minute.
  window.setTimeout(() => frame.remove(), 60_000);
}

export type ScriptPdfResult = 'saved' | 'cancelled' | 'print-opened';

/** Export the script as a PDF: the desktop's own PDF printer when available, the print window otherwise. */
export async function exportScriptPdf(title: string, body: string, nodes: readonly BoardNode[], getMediaUrl: (mediaId?: string) => string | undefined): Promise<ScriptPdfResult> {
  const html = await scriptPrintDocument(title, body, nodes, getMediaUrl);
  const bridge = pdfBridge();
  const safeTitle = (title || '未命名文稿').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 90);
  if (bridge) {
    const data = await bridge.render(html, { pageSize: 'A4', landscape: true });
    const result = await saveExport({ format: 'pdf' as FileExportFormat, suggestedName: `${safeTitle}-分镜脚本.pdf`, data });
    return result.status === 'cancelled' ? 'cancelled' : 'saved';
  }
  await printInFrame(html);
  return 'print-opened';
}

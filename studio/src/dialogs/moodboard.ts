/**
 * 灵感板导出（DESIGN_SYSTEM §6.20.1，FD-M3）：把一个分组里的图片按原比例排成一张图（PNG 2x）或一页 PDF。
 * 版式与绘制分开：`layoutMoodboard` 是纯函数（可测试），`renderMoodboard` 把同一份版式画到 canvas 上，
 * 预览与导出用同一套坐标。图片一律不裁切、不加滤镜：成行版式按原比例，网格与瀑布用 contain + 底色留白。
 *
 * 版面（DLG-07、DLG-17）：标题在顶部（22/600），图片在中间，出处在底部（12px）；序号写在图片下方，不压画面。
 * PDF 是固定页面，图片块在剩余区域里上下左右居中；PNG 没有固定页面，版心按内容收紧，四周只留所选边距。
 */
import type { Board, BoardNode } from '../model';
import { frameContainsCard, getCardBounds, type CardMeasurements } from '../card-placement';

export type MoodLayout = 'rows' | 'grid' | 'masonry';
export type MoodBackground = 'canvas' | 'white' | 'dark';
export type MoodCaption = 'none' | 'filename' | 'note';
export type MoodFormat = 'png' | 'pdf-a4' | 'pdf-a3';
export interface MoodOptions { layout: MoodLayout; background: MoodBackground; margin: 0 | 24 | 48; caption: MoodCaption; footer: boolean; format: MoodFormat }
export const DEFAULT_MOOD_OPTIONS: MoodOptions = { layout: 'rows', background: 'canvas', margin: 24, caption: 'none', footer: true, format: 'png' };

export interface MoodItem { id: string; title: string; note: string; source: string; src?: string; ratio: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** `caption`：图片下方那一行（文件名、画面笔记，或只有序号），左缘对齐图片、在图片底边下方 CAPTION_GAP。 */
export interface MoodTile { item: MoodItem; cell: Rect; image: Rect; caption?: Rect }
export interface MoodSheet { width: number; height: number; scale: number }
/** `sheet`：这次实际输出的版心（PDF 等于页面；PNG 按内容收紧）。`footerLines`：页脚每行的文字。 */
export interface MoodLayoutResult { tiles: MoodTile[]; footer?: Rect; footerLines: string[]; footerColumns: number; title: Rect; sheet: { width: number; height: number } }

const GAP = 12;
const CAPTION_H = 22;
/** 只写序号时，图片下方那一行的高度。 */
const NUMBER_H = 18;
const CAPTION_GAP = 6;
export const TITLE_SIZE = 22;
const TITLE_H = 30;
const TITLE_GAP = 16;
const FOOTER_LINE = 16;
const FOOTER_COLUMN = 480;
/** 文字离纸边至少这么远：选“无”边距时图片可以贴边，标题和出处不贴。 */
const TEXT_MARGIN = 16;
/** PNG 收紧后的最小宽度：只有一两张竖图时，标题和出处仍有地方写。 */
const MIN_PNG_WIDTH = 640;

/** 逻辑尺寸（版式坐标）与输出倍率：PNG 最大 1920×1200 @2x = 3840×2400（按内容收紧）；PDF 用 A 系列横版比例。 */
export function sheetFor(format: MoodFormat): MoodSheet {
  if (format === 'pdf-a4') return { width: 1684, height: 1191, scale: 2 };
  if (format === 'pdf-a3') return { width: 2382, height: 1684, scale: 2 };
  return { width: 1920, height: 1200, scale: 2 };
}

/** 页脚的出处行：写了文件名就只列出处；出处相同的图合成一行（“1–5　来处示例素材”）。 */
export function footerEntries(items: readonly Pick<MoodItem, 'title' | 'source'>[], caption: MoodCaption): string[] {
  if (caption !== 'filename') return items.map((item, index) => `${index + 1}　${item.title} · ${item.source}`);
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => groups.set(item.source, [...(groups.get(item.source) ?? []), index + 1]));
  const span = (numbers: number[]) => {
    const parts: string[] = [];
    for (let start = 0; start < numbers.length;) {
      let end = start;
      while (end + 1 < numbers.length && numbers[end + 1] === numbers[end] + 1) end++;
      parts.push(end > start + 1 ? `${numbers[start]}–${numbers[end]}` : numbers.slice(start, end + 1).join('、'));
      start = end + 1;
    }
    return parts.join('、');
  };
  return [...groups].map(([source, numbers]) => `${span(numbers)}　${source}`);
}

export function footerColumns(width: number): number { return Math.max(1, Math.min(3, Math.floor(width / FOOTER_COLUMN))); }
export function footerLines(count: number, columns = 3): number { return Math.ceil(count / columns); }

function contain(cell: Rect, ratio: number): Rect {
  const cellRatio = cell.w / cell.h;
  if (ratio >= cellRatio) { const h = cell.w / ratio; return { x: cell.x, y: cell.y + (cell.h - h) / 2, w: cell.w, h }; }
  const w = cell.h * ratio;
  return { x: cell.x + (cell.w - w) / 2, y: cell.y, w, h: cell.h };
}

const captionUnder = (image: Rect, right: number, caption: number): Rect | undefined => caption ? { x: image.x, y: image.y + image.h + CAPTION_GAP, w: Math.max(0, right - image.x), h: caption - CAPTION_GAP } : undefined;

function rowsLayout(items: MoodItem[], area: Rect, caption: number): MoodTile[] {
  const build = (target: number) => {
    const rows: { items: MoodItem[]; height: number }[] = [];
    let current: MoodItem[] = [];
    for (const item of items) {
      current.push(item);
      const width = current.reduce((sum, value) => sum + value.ratio * target, 0) + GAP * (current.length - 1);
      if (width >= area.w) {
        const height = (area.w - GAP * (current.length - 1)) / current.reduce((sum, value) => sum + value.ratio, 0);
        rows.push({ items: current, height });
        current = [];
      }
    }
    if (current.length) rows.push({ items: current, height: target });
    const total = rows.reduce((sum, row) => sum + row.height + caption, 0) + GAP * Math.max(0, rows.length - 1);
    return { rows, total };
  };
  // 二分找最大的目标行高，使全部行放得进版心。
  let low = 16, high = area.h, best = build(low);
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2, attempt = build(middle);
    if (attempt.total <= area.h) { best = attempt; low = middle; } else high = middle;
  }
  const tiles: MoodTile[] = [];
  let y = area.y + Math.max(0, (area.h - best.total) / 2);
  for (const row of best.rows) {
    const width = row.items.reduce((sum, item) => sum + item.ratio * row.height, 0) + GAP * (row.items.length - 1);
    let x = area.x + Math.max(0, (area.w - width) / 2);
    for (const item of row.items) {
      const w = item.ratio * row.height;
      const image = { x, y, w, h: row.height };
      tiles.push({ item, cell: image, image, caption: captionUnder(image, x + w, caption) });
      x += w + GAP;
    }
    y += row.height + caption + GAP;
  }
  return tiles;
}

function gridLayout(items: MoodItem[], area: Rect, caption: number): MoodTile[] {
  const n = items.length;
  let best = { columns: 1, size: 0 };
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns);
    const cellW = (area.w - GAP * (columns - 1)) / columns;
    const cellH = (area.h - GAP * (rows - 1)) / rows - caption;
    const size = Math.min(cellW, cellH / .75);
    if (cellH > 0 && size > best.size) best = { columns, size };
  }
  const columns = best.columns, rows = Math.ceil(n / columns);
  const cellW = (area.w - GAP * (columns - 1)) / columns;
  const cellH = Math.min((area.h - GAP * (rows - 1)) / rows - caption, cellW * .75);
  const totalH = rows * (cellH + caption) + GAP * (rows - 1);
  const top = area.y + (area.h - totalH) / 2;
  return items.map((item, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const cell = { x: area.x + column * (cellW + GAP), y: top + row * (cellH + caption + GAP), w: cellW, h: cellH };
    const fitted = contain(cell, item.ratio);
    // 有说明时图片贴格子底边，一行的说明落在同一条线上；没有说明时上下居中。
    const image = caption ? { ...fitted, y: cell.y + cell.h - fitted.h } : fitted;
    // 说明以图片左缘为准，写在图片底边下方（竖图在格子里居中时，说明不会偏到格子左缘去）。
    return { item, cell, image, caption: captionUnder(image, cell.x + cell.w, caption) };
  });
}

function masonryLayout(items: MoodItem[], area: Rect, caption: number): MoodTile[] {
  // 放置顺序：按画布顺序，或者先放最高的（各列更齐）。tiles 仍按画布顺序编号，序号写在每张图下方。
  const byHeight = items.map((item, index) => index).sort((a, b) => items[a].ratio - items[b].ratio);
  const orders = [items.map((item, index) => index), byHeight];
  const place = (columns: number, width: number, order: number[]) => {
    const heights = new Array<number>(columns).fill(0);
    const placed: { column: number; y: number; h: number }[] = new Array(items.length);
    for (const index of order) {
      const column = heights.indexOf(Math.min(...heights));
      const h = width / items[index].ratio;
      placed[index] = { column, y: heights[column], h };
      heights[column] += h + caption + GAP;
    }
    return { placed, height: Math.max(...heights) - GAP };
  };
  // 列数与放置顺序按“图片铺得满”选（DLG-07）：放得下的前提下，图片面积 × 占满程度最大；
  // 只比列宽（旧做法）会留下一整列的空洞。
  let chosen: { columns: number; width: number; result: ReturnType<typeof place>; score: number } | undefined;
  for (let columns = 2; columns <= Math.max(2, Math.min(6, items.length)); columns++) {
    const fullWidth = (area.w - GAP * (columns - 1)) / columns;
    for (const order of orders) {
      let low = 8, high = fullWidth, fit = place(columns, low, order), fitWidth = low;
      for (let step = 0; step < 24; step++) {
        const middle = (low + high) / 2, attempt = place(columns, middle, order);
        if (attempt.height <= area.h) { fit = attempt; fitWidth = middle; low = middle; } else high = middle;
      }
      const imageArea = items.reduce((sum, item) => sum + fitWidth * fitWidth / item.ratio, 0);
      const boxArea = (columns * fitWidth + GAP * (columns - 1)) * Math.max(1, fit.height);
      const score = imageArea * (imageArea / boxArea) ** 2;
      if (!chosen || score > chosen.score + 1e-6) chosen = { columns, width: fitWidth, result: fit, score };
    }
  }
  const { columns, width, result } = chosen!;
  const totalW = columns * width + GAP * (columns - 1);
  const left = area.x + (area.w - totalW) / 2, top = area.y + (area.h - result.height) / 2;
  return items.map((item, index) => {
    const spot = result.placed[index];
    const cell = { x: left + spot.column * (width + GAP), y: top + spot.y, w: width, h: spot.h };
    return { item, cell, image: cell, caption: captionUnder(cell, cell.x + width, caption) };
  });
}

const bottomOf = (tile: MoodTile) => tile.caption ? tile.caption.y + tile.caption.h : tile.image.y + tile.image.h;

export function layoutMoodboard(items: readonly MoodItem[], sheet: Pick<MoodSheet, 'width' | 'height'>, options: Pick<MoodOptions, 'layout' | 'margin' | 'caption' | 'footer'> & { format?: MoodFormat }): MoodLayoutResult {
  const text = Math.max(options.margin, TEXT_MARGIN);
  const usable = items.filter(item => Number.isFinite(item.ratio) && item.ratio > 0);
  const lines = options.footer && usable.length ? footerEntries(usable, options.caption) : [];
  const columns = footerColumns(sheet.width - text * 2);
  const footerH = lines.length ? 12 + footerLines(lines.length, columns) * FOOTER_LINE : 0;
  const title = { x: text, y: text, w: sheet.width - text * 2, h: TITLE_H };
  const top = title.y + title.h + TITLE_GAP;
  const bottomReserve = footerH ? GAP + footerH + text : options.margin;
  const area = { x: options.margin, y: top, w: sheet.width - options.margin * 2, h: sheet.height - top - bottomReserve };
  // 页脚列出处、图下又不写字时，图下只写序号，不再把序号牌压在画面上（DLG-17）。
  const caption = options.caption !== 'none' ? CAPTION_H + CAPTION_GAP : lines.length ? NUMBER_H + CAPTION_GAP : 0;
  const tiles = !usable.length ? [] : options.layout === 'grid' ? gridLayout(usable, area, caption) : options.layout === 'masonry' ? masonryLayout(usable, area, caption) : rowsLayout(usable, area, caption);
  let size = { width: sheet.width, height: sheet.height };
  let footerCols = columns, finalFooterH = footerH;
  if (options.format === 'png' && tiles.length) {
    // PNG 没有固定页面：按图片块收紧版心，四周只留所选边距（标题、出处离边至少 16），不再上下大片留白（DLG-07）。
    const rects = (tile: MoodTile) => [...new Set([tile.cell, tile.image, tile.caption].filter((rect): rect is Rect => !!rect))];
    const left = Math.min(...tiles.map(tile => Math.min(tile.cell.x, tile.image.x)));
    const right = Math.max(...tiles.map(tile => Math.max(tile.cell.x + tile.cell.w, tile.image.x + tile.image.w)));
    const upper = Math.min(...tiles.map(tile => Math.min(tile.cell.y, tile.image.y)));
    const lower = Math.max(...tiles.map(bottomOf));
    const contentW = right - left + options.margin * 2;
    const width = Math.round(Math.max(contentW, MIN_PNG_WIDTH));
    // 内容比最小宽度窄时整体居中。
    const dx = left - options.margin - (width - contentW) / 2, dy = upper - top;
    for (const tile of tiles) for (const rect of rects(tile)) { rect.x -= dx; rect.y -= dy; }
    footerCols = footerColumns(width - text * 2);
    finalFooterH = lines.length ? 12 + footerLines(lines.length, footerCols) * FOOTER_LINE : 0;
    const height = Math.round(top + (lower - upper) + (finalFooterH ? GAP + finalFooterH + text : options.margin));
    size = { width, height };
    title.w = width - text * 2;
  }
  // 瀑布按版面阅读顺序（先上后下、先左后右）编号，页脚跟着同一个顺序；成行与网格本来就是这个顺序。
  if (options.layout === 'masonry') tiles.sort((a, b) => a.image.y - b.image.y || a.image.x - b.image.x);
  // 选“无”边距时图片可以贴边，图下的序号和说明不贴边。
  for (const tile of tiles) if (tile.caption && tile.caption.x < TEXT_MARGIN) { tile.caption.w -= TEXT_MARGIN - tile.caption.x; tile.caption.x = TEXT_MARGIN; }
  const footerText = options.layout === 'masonry' && lines.length ? footerEntries(tiles.map(tile => tile.item), options.caption) : lines;
  const footer = finalFooterH ? { x: text, y: size.height - text - finalFooterH, w: size.width - text * 2, h: finalFooterH } : undefined;
  return { tiles, footer, footerLines: footerText, footerColumns: footerCols, title, sheet: size };
}

// ---------- 从画布里取分组与图片 ----------

export interface MoodGroup { id: string; title: string; items: MoodItem[] }
type MediaResolver = (mediaId?: string) => string | undefined;
const webUrl = (value?: string) => { try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } };
const byPosition = (a: BoardNode, b: BoardNode) => a.position.y - b.position.y || a.position.x - b.position.x;

export function moodItemFromNode(node: BoardNode, getMediaUrl?: MediaResolver, measurements?: CardMeasurements): MoodItem {
  const box = getCardBounds(node, measurements);
  const source = node.data.sourceUrl || webUrl(node.data.url) || (node.data.demo ? '来处示例素材' : '本机导入');
  return {
    id: node.id, title: node.data.title || '未命名图片', note: node.data.body?.trim() ?? '', source,
    src: getMediaUrl?.(node.data.mediaId) || node.data.poster || webUrl(node.data.url) || (node.data.url?.startsWith('/assets/') ? node.data.url : undefined),
    ratio: box.width / box.height,
  };
}

/**
 * 分组成员就是画布托盘标签数的那一份：`frameContainsCard`（完全包含，与拖动分组带动卡片同一规则，K9-6）
 * 加画布实测尺寸。没存高度的图片在画布上按原图比例显示，只有实测知道它多高（FC-01）。
 * 画布上没有分组时退回“全部图片”。
 */
export function moodGroups(board: Board, getMediaUrl?: MediaResolver, measurements: CardMeasurements = {}): MoodGroup[] {
  const images = board.nodes.filter(node => node.data.kind === 'image');
  const item = (node: BoardNode) => moodItemFromNode(node, getMediaUrl, measurements);
  const groups: MoodGroup[] = [];
  for (const frame of board.nodes.filter(node => node.data.kind === 'frame')) {
    const inside = images.filter(node => frameContainsCard(frame, node, measurements)).sort(byPosition);
    if (inside.length) groups.push({ id: frame.id, title: frame.data.title || '未命名分组', items: inside.map(item) });
  }
  if (images.length) groups.push({ id: 'all', title: '全部图片', items: [...images].sort(byPosition).map(item) });
  return groups;
}

// ---------- 绘制与导出（只在浏览器里调用） ----------

export interface MoodPalette { background: string; fg: string; fg2: string; rule: string; placeholder: string; chip: string; chipFg: string }

/** 颜色取自令牌：在一个强制浅色（或暗场）的探针元素上读计算值，导出文件不随当前界面主题变化。 */
export function moodPalette(background: MoodBackground): MoodPalette {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;color-scheme:light';
  document.body.append(probe);
  const read = (token: string) => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
  const chips = { chip: read('--media-chip'), chipFg: read('--media-fg') };
  const palette = background === 'dark'
    ? { background: read('--export-bg-dark'), fg: read('--viewer-fg'), fg2: read('--viewer-fg-2'), rule: read('--viewer-rule'), placeholder: read('--viewer-bar'), ...chips }
    : { background: read(background === 'white' ? '--export-bg-white' : '--export-bg-desk'), fg: read('--fg-1'), fg2: read('--fg-3'), rule: read('--border-hair'), placeholder: read('--rail-tick'), ...chips };
  probe.remove();
  return palette;
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadMoodImage(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  let pending = imageCache.get(src);
  if (!pending) {
    pending = new Promise(resolve => {
      const image = new Image();
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
    imageCache.set(src, pending);
  }
  return pending;
}

function fitText(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > width) result = result.slice(0, -1);
  return `${result}…`;
}

export interface RenderInput { items: readonly MoodItem[]; images: ReadonlyMap<string, HTMLImageElement | null>; options: MoodOptions; title: string; palette: MoodPalette; fontFamily: string }

/** 图片读到以后按原图比例排版（画布上的比例只在文件读到之前用）。 */
export function moodItemsWithImages(items: readonly MoodItem[], images: ReadonlyMap<string, HTMLImageElement | null>): MoodItem[] {
  return items.map(item => { const image = images.get(item.id); return image?.naturalWidth && image.naturalHeight ? { ...item, ratio: image.naturalWidth / image.naturalHeight } : item; });
}

/** 预览与导出共用的版式：PDF 是固定页面，PNG 按内容收紧（result.sheet）。 */
export function moodboardLayout(input: Pick<RenderInput, 'items' | 'images' | 'options'>): MoodLayoutResult {
  return layoutMoodboard(moodItemsWithImages(input.items, input.images), sheetFor(input.options.format), input.options);
}

/** 在给定倍率下画整张灵感板；预览用小倍率、导出用 sheet.scale。 */
export function renderMoodboard(canvas: HTMLCanvasElement, input: RenderInput, pixelScale: number): MoodLayoutResult {
  const result = moodboardLayout(input);
  const sheet = result.sheet;
  canvas.width = Math.round(sheet.width * pixelScale);
  canvas.height = Math.round(sheet.height * pixelScale);
  const context = canvas.getContext('2d');
  if (!context) return result;
  context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  context.fillStyle = input.palette.background;
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.imageSmoothingQuality = 'high';
  // 标题在顶部，比出处大一级（DLG-17）。
  context.font = `600 ${TITLE_SIZE}px ${input.fontFamily}`;
  context.fillStyle = input.palette.fg;
  context.textBaseline = 'middle';
  context.textAlign = 'start';
  context.fillText(fitText(context, input.title, result.title.w), result.title.x, result.title.y + result.title.h / 2);
  result.tiles.forEach((tile, index) => {
    const image = input.images.get(tile.item.id);
    if (image) context.drawImage(image, tile.image.x, tile.image.y, tile.image.w, tile.image.h);
    else { context.fillStyle = input.palette.placeholder; context.fillRect(tile.image.x, tile.image.y, tile.image.w, tile.image.h); }
    if (!tile.caption) return;
    // 序号与说明写在图片下方、左缘对齐图片，不压住画面（DLG-17）。
    const number = input.options.footer ? `${index + 1}` : '';
    const text = input.options.caption === 'note' ? tile.item.note.replace(/\s+/g, ' ') : input.options.caption === 'filename' ? tile.item.title : '';
    const y = tile.caption.y + tile.caption.h / 2;
    context.textBaseline = 'middle';
    let x = tile.caption.x;
    if (number) {
      context.font = `600 12px ${input.fontFamily}`;
      context.fillStyle = input.palette.fg2;
      context.fillText(number, x, y);
      x += context.measureText(number).width + 8;
    }
    if (text) {
      context.font = `450 13px ${input.fontFamily}`;
      context.fillStyle = input.options.caption === 'note' ? input.palette.fg : input.palette.fg2;
      context.fillText(fitText(context, text, Math.max(0, tile.caption.x + tile.caption.w - x)), x, y);
    }
  });
  if (result.footer) {
    context.fillStyle = input.palette.rule;
    context.fillRect(result.footer.x, result.footer.y, result.footer.w, 1);
    context.font = `450 12px ${input.fontFamily}`;
    context.fillStyle = input.palette.fg2;
    context.textBaseline = 'top';
    const columns = result.footerColumns, columnW = result.footer.w / columns;
    result.footerLines.forEach((line, index) => {
      const column = index % columns, row = Math.floor(index / columns);
      context.fillText(fitText(context, line, columnW - 16), result.footer!.x + column * columnW, result.footer!.y + 10 + row * FOOTER_LINE);
    });
  }
  return result;
}

/** 单页 PDF：整页一张 JPEG（DCTDecode），页面尺寸是 A4 / A3 横版的 pt 值。 */
export function jpegToPdf(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number, format: Exclude<MoodFormat, 'png'>): Uint8Array {
  const [pageW, pageH] = format === 'pdf-a3' ? [1190.55, 841.89] : [841.89, 595.28];
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => { const bytes = typeof part === 'string' ? encoder.encode(part) : part; chunks.push(bytes); length += bytes.length; };
  const object = (id: number, body: string) => { offsets[id] = length; push(`${id} 0 obj\n${body}\nendobj\n`); };
  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').trim() || '灵感板';
  try { document.body.append(anchor); anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

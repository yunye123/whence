import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { ChevronLeft, ChevronRight, Expand, Info, Minus, Plus } from 'lucide-react';
import InspectorDialog from '../InspectorDialog';
import { BoardContext } from '../board-context';
import type { BoardNode } from '../model';
import { frameContainsCard } from '../card-placement';
import { useCanvasMeasurements } from '../dialogs/canvas-measurements';
import { safeWebUrl, type ImageSize } from './shared';

/** One image the viewer can step to (same group as the opened card, §6.19). */
interface ViewerItem { id: string; title: string; src: string; note: string; source: string; group?: string }

const MAX_ZOOM = 4;
const STEP = 1.25;
/** “适应窗口”时图片上下各留的空（§6.19、DLG-18）：不贴住标题行，也不压到底部工具条。 */
const FIT_GAP = 24;
const isVector = (src: string) => /^data:image\/svg|\.svg(?:[?#]|$)/i.test(src);

function useViewerItems(fallback: ViewerItem): { items: ViewerItem[]; start: number } {
  const board = useContext(BoardContext);
  const measure = useCanvasMeasurements();
  return useMemo(() => {
    const current = board?.nodes.find(node => node.id === board.inspectedId && node.data.kind === 'image');
    if (!board || !current) return { items: [fallback], start: 0 };
    // The same group as the tray label on the canvas: whole-card rule plus measured sizes (FC-01).
    const measurements = measure();
    const frame = board.nodes.find(node => frameContainsCard(node, current, measurements));
    const inFrame = (node: BoardNode) => !frame || frameContainsCard(frame, node, measurements);
    const items = board.nodes.filter(node => node.data.kind === 'image' && inFrame(node))
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .flatMap(node => {
        const src = node.id === current.id ? fallback.src : board.getMediaUrl(node.data.mediaId) || node.data.poster || safeWebUrl(node.data.url) || (node.data.url?.startsWith('/assets/') ? node.data.url : undefined);
        if (!src) return [];
        return [{ id: node.id, title: node.data.title || '未命名图片', src, note: node.data.body?.trim() ?? '', group: frame?.data.title,
          source: node.data.sourceUrl || safeWebUrl(node.data.url) || (node.data.demo ? '来处示例素材' : '本机导入') }];
      });
    const start = items.findIndex(item => item.id === current.id);
    return start < 0 ? { items: [fallback], start: 0 } : { items, start };
  }, [board, fallback, measure]);
}

/** 主色：缩小到 48×48 采样，按 4 位量化计数，取占比最高且彼此不太接近的 5 个。跨域图片读不到像素时返回空。 */
function dominantColors(image: HTMLImageElement): string[] {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 48; canvas.height = 48;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(image, 0, 0, 48, 48);
    const data = context.getImageData(0, 0, 48, 48).data;
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 128) continue;
      const key = (data[index] >> 4) << 8 | (data[index + 1] >> 4) << 4 | data[index + 2] >> 4;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++; bucket.r += data[index]; bucket.g += data[index + 1]; bucket.b += data[index + 2];
      buckets.set(key, bucket);
    }
    const ranked = [...buckets.values()].sort((a, b) => b.count - a.count).map(bucket => [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count]);
    const picked: number[][] = [];
    for (const color of ranked) {
      if (picked.every(other => Math.hypot(color[0] - other[0], color[1] - other[1], color[2] - other[2]) > 36)) picked.push(color);
      if (picked.length === 5) break;
    }
    return picked.sort((a, b) => (a[0] * .3 + a[1] * .59 + a[2] * .11) - (b[0] * .3 + b[1] * .59 + b[2] * .11))
      .map(color => `#${color.map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`);
  } catch { return []; }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 原图查看器（§6.19，PS-M2）：整窗看片暗场，不随主题；位图“适应窗口”不超过 100%；
 * 滚轮与捏合以指针为中心缩放，拖动平移；+ − 0 1 与 ← → 切换同组图片；Esc 回到画布。
 */
export default function ImagePreviewDialog({ src, title, initialSize, onClose }: {
  src: string;
  title: string;
  initialSize: ImageSize | null;
  onClose: () => void;
}) {
  const fallback = useMemo<ViewerItem>(() => ({ id: 'current', title: title || '原图', src, note: '', source: '' }), [src, title]);
  const { items, start } = useViewerItems(fallback);
  const [index, setIndex] = useState(start);
  const item = items[Math.min(index, items.length - 1)] ?? fallback;
  const [sizes, setSizes] = useState<Record<string, ImageSize>>(() => initialSize ? { [item.id]: initialSize } : {});
  const natural = sizes[item.id] ?? null;
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [infoOpen, setInfoOpen] = useState(true);
  const [details, setDetails] = useState<Record<string, { bytes?: number; type?: string; colors?: string[] }>>({});
  const [copied, setCopied] = useState('');
  // 查看区的焦点框只在用 Tab 进入时显示（DLG-18）：按 1、0、←、→ 这些键不应该把照片框起来。
  const [tabFocus, setTabFocus] = useState(false);
  const tabbing = useRef(false);
  const [stripFade, setStripFade] = useState({ start: false, end: false });
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ ix: number; iy: number; vx: number; vy: number } | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const flipped = useRef(false);
  const isFailed = !!failed[item.id];
  const zoomOff = !natural || isFailed;
  const cap = isVector(item.src) ? MAX_ZOOM : 1;
  const fit = natural && viewport.width && viewport.height ? Math.min(cap, viewport.width / natural.width, Math.max(1, viewport.height - FIT_GAP * 2) / natural.height) : 1;
  const minZoom = Math.min(0.05, fit);
  const scale = zoom ?? fit;
  const imageWidth = (natural?.width ?? 0) * scale;
  const imageHeight = (natural?.height ?? 0) * scale;
  const canPan = !isFailed && (imageWidth > viewport.width + 1 || imageHeight > viewport.height + 1);
  const meta = details[item.id];

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 以某个视口点为锚缩放：缩放前记下锚点对应的图像坐标，缩放后把它放回同一个视口点。
  useLayoutEffect(() => {
    const element = viewportRef.current;
    const point = anchor.current;
    if (!element || !natural || !point) return;
    element.scrollLeft = point.ix * scale + Math.max(0, (element.clientWidth - imageWidth) / 2) - point.vx;
    element.scrollTop = point.iy * scale + Math.max(0, (element.clientHeight - imageHeight) / 2) - point.vy;
    anchor.current = null;
  }, [scale, imageWidth, imageHeight, natural, viewport]);

  // 切图后回到“适应窗口”，缩略图条把当前图滚进视野。
  useEffect(() => {
    setZoom(null);
    stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [item.id]);

  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Tab') tabbing.current = true; };
    const pointer = () => { tabbing.current = false; };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', pointer, true); };
  }, []);

  // 缩略图条放不下时，被截的一侧渐隐（DLG-11）。
  const updateStripFade = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const start = strip.scrollLeft > 1, end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setStripFade(current => current.start === start && current.end === end ? current : { start, end });
  };
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    updateStripFade();
    const observer = new ResizeObserver(updateStripFade);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [items.length, infoOpen]);

  // 快捷键挂在查看器里：焦点掉到页面上（FC-09）就回到查看区域，← → + − 0 1 继续有效。
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) viewportRef.current?.focus({ preventScroll: true });
  }, [item.id, isFailed, natural]);

  // 文件大小与类型只对本机（blob / 同源）图片读取，网络图片不额外请求。
  useEffect(() => {
    if (meta?.bytes !== undefined || !/^(blob:|\/|data:)/.test(item.src) && !item.src.startsWith(location.origin)) return;
    let cancelled = false;
    void fetch(item.src).then(response => response.blob()).then(blob => {
      if (!cancelled) setDetails(current => ({ ...current, [item.id]: { ...current[item.id], bytes: blob.size, type: blob.type } }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [item.id, item.src, meta?.bytes]);

  const changeZoom = (next: number | null, at?: { x: number; y: number }) => {
    const element = viewportRef.current;
    if (!natural || !element) return;
    const vx = at ? at.x : element.clientWidth / 2, vy = at ? at.y : element.clientHeight / 2;
    anchor.current = next === null ? { ix: natural.width / 2, iy: natural.height / 2, vx: element.clientWidth / 2, vy: element.clientHeight / 2 } : {
      ix: Math.max(0, Math.min(natural.width, (element.scrollLeft + vx - Math.max(0, (element.clientWidth - imageWidth) / 2)) / scale)),
      iy: Math.max(0, Math.min(natural.height, (element.scrollTop + vy - Math.max(0, (element.clientHeight - imageHeight) / 2)) / scale)),
      vx, vy,
    };
    setZoom(next === null ? null : Math.max(minZoom, Math.min(MAX_ZOOM, next)));
  };

  const go = (step: number) => { if (items.length > 1) setIndex(current => (current + step + items.length) % items.length); };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowLeft') { if (items.length > 1) { event.preventDefault(); go(key === 'ArrowRight' ? 1 : -1); } return; }
    if (key === '+' || key === '=') { event.preventDefault(); changeZoom(scale * STEP); }
    else if (key === '-' || key === '_') { event.preventDefault(); changeZoom(scale / STEP); }
    else if (key === '0') { event.preventDefault(); changeZoom(null); }
    else if (key === '1') { event.preventDefault(); changeZoom(1); }
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (!natural || isFailed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // 触控板捏合以 ctrlKey 滚轮事件到达，幅度小，放大系数加大。
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? .01 : .0018));
    changeZoom(scale * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  // 滚轮要能 preventDefault，React 的 onWheel 是被动监听，这里另挂一个非被动监听只负责拦住页面缩放与滚动。
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const block = (event: globalThis.WheelEvent) => event.preventDefault();
    element.addEventListener('wheel', block, { passive: false });
    return () => element.removeEventListener('wheel', block);
  }, []);

  function onLoad(image: HTMLImageElement) {
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    setSizes(current => current[item.id]?.width === size.width && current[item.id]?.height === size.height ? current : { ...current, [item.id]: size });
    if (!details[item.id]?.colors) setDetails(current => ({ ...current, [item.id]: { ...current[item.id], colors: dominantColors(image) } }));
  }

  // 打开时图像从画布卡片的位置放大到居中（FLIP，等比，260ms）；减少动效时只淡入。
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (flipped.current || !image || !natural || !viewport.width) return;
    flipped.current = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !image.animate) return;
    const card = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(items[start]?.id ?? '')}"] img`);
    if (!card) return;
    const from = card.getBoundingClientRect(), to = image.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const ratio = from.width / to.width;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
    image.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${ratio})`, opacity: .6 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.32,.72,0,1)' });
  }, [natural, viewport.width, items, start]);

  const pixels = natural ? `${natural.width.toLocaleString('zh-CN')} × ${natural.height.toLocaleString('zh-CN')}` : '';
  const type = meta?.type?.replace(/^image\//, '').replace('svg+xml', 'SVG').toUpperCase();

  return <InspectorDialog title={item.title || '查看原图'} className="inspector-dialog--image viewer" closeLabel="关闭原图" onCancel={onClose}>
    <div className={`viewer__layout${infoOpen ? ' has-info' : ''}`} onKeyDown={onKeyDown}>
      <section className="viewer__stage" aria-label="原图">
        <div className="viewer__top">
          <span className="viewer__name" title={item.title}>{item.title}</span>
          {item.group && <span className="viewer__where">{item.group}</span>}
          {items.length > 1 && <span className="viewer__count">{index + 1} / {items.length}</span>}
          <button type="button" className="viewer__btn viewer__info-toggle" aria-pressed={infoOpen} aria-label="图片信息" title="图片信息" onClick={() => setInfoOpen(open => !open)}><Info size={16} aria-hidden="true"/></button>
        </div>
        <div className="viewer__frame">
          <div
            ref={viewportRef}
            className={`viewer__viewport inspector-image-viewport${canPan ? ' can-pan' : ''}${tabFocus ? ' is-tab-focus' : ''}`}
            onFocus={() => setTabFocus(tabbing.current)}
            onBlur={() => setTabFocus(false)}
            tabIndex={0}
            data-autofocus
            role="region"
            aria-label="原图查看区域"
            aria-describedby="viewer-help"
            onWheel={onWheel}
            onDoubleClick={event => {
              if (!natural || isFailed) return;
              const rect = event.currentTarget.getBoundingClientRect();
              changeZoom(zoom === null && fit < 1 ? 1 : null, { x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
            onPointerDown={event => {
              if (!canPan || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              if (!drag.current || drag.current.pointer !== event.pointerId) return;
              drag.current.moved = true;
              event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
              event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
            }}
            onPointerUp={event => {
              if (drag.current?.pointer !== event.pointerId) return;
              drag.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { drag.current = null; }}
          >
            {isFailed
              // A local file that does not decode will not come back by waiting (CORE-08: the card offers another file).
              ? <p className="viewer__error" role="alert">{/^(?:blob:|field-media:|media:)/.test(src) ? '这张图片无法显示。文件可能已损坏或格式不受支持，关闭后在卡片上换一张图片。' : '原图暂时无法显示。关闭后检查来源链接，或重新导入图片。'}</p>
              : <div className="viewer__canvas" style={{ width: Math.max(viewport.width, imageWidth), height: Math.max(viewport.height, imageHeight) }}>
                <img
                  ref={imageRef}
                  key={item.id}
                  src={item.src}
                  alt={item.title || '原图'}
                  draggable={false}
                  style={natural ? { width: imageWidth, height: imageHeight } : { visibility: 'hidden' }}
                  onLoad={event => onLoad(event.currentTarget)}
                  onError={() => setFailed(current => ({ ...current, [item.id]: true }))}
                />
              </div>}
          </div>
          {items.length > 1 && <>
            <button type="button" className="viewer__nav viewer__nav--prev" aria-label="上一张" title="上一张（←）" onClick={() => go(-1)}><ChevronLeft size={18} aria-hidden="true"/></button>
            <button type="button" className="viewer__nav viewer__nav--next" aria-label="下一张" title="下一张（→）" onClick={() => go(1)}><ChevronRight size={18} aria-hidden="true"/></button>
          </>}
        </div>
        {/* aria-disabled, not disabled: a focused tool that turns unavailable (next image still loading, 400%
            reached) keeps focus, so the viewer's keys keep working (FC-09). */}
        <div className="viewer__tools" role="group" aria-label="图像缩放工具">
          <button type="button" className="viewer__tool" aria-disabled={zoomOff || undefined} aria-pressed={zoom === null} title="适应窗口（0）" onClick={() => { if (!zoomOff) changeZoom(null); }}>
            <Expand size={15} aria-hidden="true"/>适应窗口
          </button>
          {/* 写成“1:1”，不和右边的缩放读数挤成“100% − 100% +”；读屏名“100%”是 K4 契约。 */}
          <button type="button" className="viewer__tool viewer__tool--ratio" aria-label="100%" aria-disabled={zoomOff || undefined} aria-pressed={zoom === 1} title="原始大小 100%（1）" onClick={() => { if (!zoomOff) changeZoom(1); }}>1:1</button>
          <span className="viewer__rule" aria-hidden="true"/>
          <button type="button" className="viewer__tool viewer__tool--icon" aria-label="缩小图像" title="缩小（−）" aria-disabled={zoomOff || scale <= minZoom || undefined} onClick={() => { if (!zoomOff && scale > minZoom) changeZoom(scale / STEP); }}><Minus size={15} aria-hidden="true"/></button>
          <output className="viewer__zoom" aria-live="polite" data-testid="image-zoom-value">{Math.round(scale * 100)}%</output>
          <button type="button" className="viewer__tool viewer__tool--icon" aria-label="放大图像" title="放大（+）" aria-disabled={zoomOff || scale >= MAX_ZOOM || undefined} onClick={() => { if (!zoomOff && scale < MAX_ZOOM) changeZoom(scale * STEP); }}><Plus size={15} aria-hidden="true"/></button>
          <span className="viewer__rule" aria-hidden="true"/>
          <span className="viewer__px" data-testid="image-pixel-dimensions">{natural ? `${pixels} 像素` : '正在读取尺寸…'}</span>
        </div>
        {items.length > 1 && <div className={`viewer__strip${stripFade.start ? ' fade-start' : ''}${stripFade.end ? ' fade-end' : ''}`} ref={stripRef} aria-label="同组图片" onScroll={updateStripFade}>
          {items.map((entry, position) => <button type="button" key={entry.id} className="viewer__thumb" aria-current={position === index} aria-label={`第 ${position + 1} 张：${entry.title}`} onClick={() => setIndex(position)}>
            <img src={entry.src} alt="" loading="lazy" draggable={false}/>
          </button>)}
        </div>}
        <p id="viewer-help" className="viewer__help">滚轮缩放，拖动平移，← → 换图，Esc 回到画布</p>
      </section>
      {infoOpen && <aside className="viewer__info" aria-label="图片信息">
        <h3 className="viewer__info-title">信息</h3>
        <div className="viewer__field"><h4>尺寸</h4><p className="viewer__num">{pixels || '—'}{meta?.bytes !== undefined && <span className="viewer__dim">{formatBytes(meta.bytes)}</span>}{type && <span className="viewer__dim">{type}</span>}</p></div>
        {item.group && <div className="viewer__field"><h4>所在分组</h4><p>{item.group}</p></div>}
        {item.source && <div className="viewer__field"><h4>来源</h4><p className="viewer__dim viewer__source" lang={/^https?:/.test(item.source) ? 'en' : undefined}>{item.source}</p></div>}
        {!!meta?.colors?.length && <div className="viewer__field"><h4>主色</h4>
          <div className="viewer__swatches">{meta.colors.map(color => <button type="button" key={color} className="viewer__swatch" title={`复制 ${color}`} aria-label={`复制颜色 ${color}`}
            onClick={() => { void navigator.clipboard?.writeText(color).then(() => { setCopied(color); window.setTimeout(() => setCopied(''), 1600); }).catch(() => {}); }}>
            <i style={{ background: color }}/><span>{copied === color ? '已复制' : color}</span>
          </button>)}</div>
        </div>}
        <div className="viewer__field"><h4>画面笔记</h4>{item.note ? <p className="viewer__mine">{item.note}</p> : <p className="viewer__dim">还没有写画面笔记。关闭原图后，在资料面板里写下这张图要用在哪里。</p>}</div>
      </aside>}
    </div>
  </InspectorDialog>;
}

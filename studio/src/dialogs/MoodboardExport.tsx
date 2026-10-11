import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import type { Board } from '../model';
import { BoardContext } from '../board-context';
import {
  DEFAULT_MOOD_OPTIONS, downloadBlob, jpegToPdf, loadMoodImage, moodboardLayout, moodGroups, moodPalette, renderMoodboard, sheetFor,
  type MoodBackground, type MoodCaption, type MoodFormat, type MoodLayout, type MoodOptions,
} from './moodboard';
import { useCanvasMeasurements } from './canvas-measurements';
import { saveExport, type FileExportFormat } from '../file-export';
import { EXPORT_COPY } from './export-format';

export interface MoodboardParts {
  preview: ReactNode; options: ReactNode; summary: ReactNode; message: ReactNode;
  exporting: boolean; waiting: boolean; canExport: boolean; exportBoard: () => Promise<void>;
}

type Choice<T> = { value: T; label: string };
const LAYOUTS: Choice<MoodLayout>[] = [{ value: 'rows', label: '按原比例成行' }, { value: 'grid', label: '网格' }, { value: 'masonry', label: '瀑布' }];
const BACKGROUNDS: Choice<MoodBackground>[] = [{ value: 'canvas', label: '画布色' }, { value: 'white', label: '白' }, { value: 'dark', label: '暗场' }];
const MARGINS: Choice<MoodOptions['margin']>[] = [{ value: 0, label: '无' }, { value: 24, label: '24' }, { value: 48, label: '48' }];
const CAPTIONS: Choice<MoodCaption>[] = [{ value: 'none', label: '不写' }, { value: 'filename', label: '文件名' }, { value: 'note', label: '画面笔记' }];

/**
 * 本次会话里记住上次的选项（DLG-08）：再次打开不必重选。存在模块里，并写一份到 sessionStorage，
 * 刷新页面后仍在；读不到或格式不对就用默认值。
 */
const OPTIONS_KEY = 'field-moodboard-options';
let rememberedOptions: MoodOptions | undefined;
function readOptions(): MoodOptions {
  if (rememberedOptions) return rememberedOptions;
  try {
    const saved = JSON.parse(sessionStorage.getItem(OPTIONS_KEY) ?? 'null') as Partial<MoodOptions> | null;
    if (saved && typeof saved === 'object') {
      const pick = <K extends keyof MoodOptions>(key: K, allowed: readonly MoodOptions[K][]) => allowed.includes(saved[key] as MoodOptions[K]) ? saved[key] as MoodOptions[K] : DEFAULT_MOOD_OPTIONS[key];
      return rememberedOptions = {
        layout: pick('layout', LAYOUTS.map(item => item.value)), background: pick('background', BACKGROUNDS.map(item => item.value)),
        margin: pick('margin', MARGINS.map(item => item.value)), caption: pick('caption', CAPTIONS.map(item => item.value)),
        footer: typeof saved.footer === 'boolean' ? saved.footer : DEFAULT_MOOD_OPTIONS.footer, format: pick('format', FORMATS.map(item => item.value)),
      };
    }
  } catch { /* storage may be unavailable */ }
  return DEFAULT_MOOD_OPTIONS;
}
function rememberOptions(options: MoodOptions) {
  rememberedOptions = options;
  try { sessionStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch { /* storage may be unavailable */ }
}
const FORMATS: Choice<MoodFormat>[] = [{ value: 'png', label: 'PNG 2x' }, { value: 'pdf-a4', label: 'PDF A4 横' }, { value: 'pdf-a3', label: 'PDF A3 横' }];

function Segmented<T extends string | number>({ label, choices, value, onChange }: { label: string; choices: Choice<T>[]; value: T; onChange: (value: T) => void }) {
  const id = useId();
  return <div className="moodboard__option">
    <span className="dialog-label" id={id}>{label}</span>
    <div className="seg-ctl" role="radiogroup" aria-labelledby={id}>
      {choices.map((choice, index) => <button type="button" role="radio" key={String(choice.value)} aria-checked={choice.value === value} tabIndex={choice.value === value ? 0 : -1}
        onClick={() => onChange(choice.value)}
        onKeyDown={event => {
          const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          const next = choices[(index + step + choices.length) % choices.length];
          onChange(next.value);
          (event.currentTarget.parentElement?.children[(index + step + choices.length) % choices.length] as HTMLElement | undefined)?.focus();
        }}>
        {label === '底色' && <i className={`moodboard__swatch moodboard__swatch--${choice.value}`} aria-hidden="true"/>}<span className="seg-ctl__label" data-label={choice.label}>{choice.label}</span>
      </button>)}
    </div>
  </div>;
}

/** §6.20.1：左侧按所选版式真实排出的缩小图，右侧选项；页脚写清张数与输出像素。 */
/**
 * `onBack`：从通用“导出”列表进来时才有，页脚写“← 返回”；从分组操作条直接进来时页脚是“取消”（`onCancel`，§6.20.1）。
 */
export default function MoodboardExport({ board, initialGroupId, onBack, onCancel, onDone, notice = '', busy = false, onBusyChange, renderLayout }: { board: Board; initialGroupId?: string; onBack?: () => void; onCancel: () => void; onDone: (message: string) => void; notice?: string; busy?: boolean; onBusyChange?: (busy: boolean) => void; renderLayout?: (parts: MoodboardParts) => ReactNode }) {
  const actions = useContext(BoardContext);
  const measure = useCanvasMeasurements();
  // Same members as the tray label on the canvas (FC-01).
  const groups = useMemo(() => moodGroups(board, actions?.getMediaUrl, measure()), [board, actions, measure]);
  const [groupId, setGroupId] = useState(() => groups.find(group => group.id === initialGroupId)?.id ?? groups[0]?.id ?? '');
  const [options, setOptions] = useState<MoodOptions>(readOptions);
  useEffect(() => { rememberOptions(options); }, [options]);
  const [images, setImages] = useState<Map<string, HTMLImageElement | null>>(new Map());
  const [loadedGroup, setLoadedGroup] = useState<typeof groups[number]>();
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const [error, setError] = useState('');
  const preview = useRef<HTMLCanvasElement>(null);
  const scopeId = useId();
  const group = groups.find(item => item.id === groupId) ?? groups[0];
  const waiting = !!group && loadedGroup !== group;
  const sheet = sheetFor(options.format);
  // PNG 的版心按内容收紧（DLG-07），页脚写的像素以实际版式为准。
  const output = useMemo(() => group ? moodboardLayout({ items: group.items, images, options }).sheet : sheetFor(options.format), [group, images, options]);
  const set = <K extends keyof MoodOptions>(key: K) => (value: MoodOptions[K]) => setOptions(current => ({ ...current, [key]: value }));
  const title = group ? (group.id === 'all' ? board.title : group.title) : board.title;
  const fontFamily = typeof document === 'undefined' ? 'sans-serif' : getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';

  useEffect(() => {
    let cancelled = false;
    if (!group) return;
    void Promise.all(group.items.map(async item => [item.id, await loadMoodImage(item.src)] as const)).then(entries => { if (!cancelled) { setImages(new Map(entries)); setLoadedGroup(group); } });
    return () => { cancelled = true; };
  }, [group]);

  useEffect(() => {
    const canvas = preview.current;
    if (!canvas || !group) return;
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = canvas.parentElement?.getBoundingClientRect();
        const width = Math.max(1, (bounds?.width ?? 432) - 64), height = Math.max(1, (bounds?.height ?? 300) - 64);
        const scale = Math.min(width / output.width, height / output.height) * (window.devicePixelRatio || 1);
        renderMoodboard(canvas, { items: group.items, images, options, title, palette: moodPalette(options.background), fontFamily }, scale);
        canvas.style.width = `${canvas.width / (window.devicePixelRatio || 1)}px`;
        canvas.style.height = `${canvas.height / (window.devicePixelRatio || 1)}px`;
      });
    };
    paint();
    const observer = new ResizeObserver(paint);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [group, images, options, title, output.width, output.height, fontFamily]);

  async function exportBoard() {
    if (!group || busy || waiting || exportingRef.current) return;
    exportingRef.current = true; setExporting(true); onBusyChange?.(true); setError('');
    try {
      const canvas = document.createElement('canvas');
      renderMoodboard(canvas, { items: group.items, images, options, title, palette: moodPalette(options.background), fontFamily }, sheet.scale);
      const type = options.format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, .92));
      if (!blob) throw new Error('浏览器没能生成图片。');
      const name = `${title} 灵感板`;
      const raster = new Uint8Array(await blob.arrayBuffer());
      const bytes = options.format === 'png' ? raster : jpegToPdf(raster, canvas.width, canvas.height, options.format);
      if (window.fieldFileExport) {
        // 桌面版走系统保存框，写完才返回，提示写清存到了哪里（DLG-09）；取消保存时对话框留着，什么也不提示。
        // 导出通道的 png、pdf 格式由 CORE-30 加进 FileExportFormat；经 string 转一次，两边先后合入都能编译。
        const result = await saveExport({ format: (options.format === 'png' ? 'png' : 'pdf') as string as FileExportFormat, suggestedName: name, data: bytes });
        if (result.status === 'saved') onDone(`灵感板已保存到 ${result.path}`);
        return;
      }
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: options.format === 'png' ? 'image/png' : 'application/pdf' }), `${name}.${options.format === 'png' ? 'png' : 'pdf'}`);
      onDone(`灵感板已开始下载：${name}`);
    } catch (reason) {
      const message = reason instanceof DOMException && reason.name === 'SecurityError'
        ? '有网络图片不允许写进导出文件。把它们下载到本机再导入画布，或换一个分组。'
        : `导出没有完成：${reason instanceof Error ? reason.message : String(reason)}`;
      setError(message);
    } finally { exportingRef.current = false; setExporting(false); onBusyChange?.(false); }
  }

  const footerButton = onBack
    ? <button type="button" className="btn btn--line" onClick={onBack}><ArrowLeft size={15} aria-hidden="true"/>返回</button>
    : <button type="button" className="btn btn--line" onClick={onCancel}>取消</button>;
  if (!group) {
    if (renderLayout) return renderLayout({ preview: <p className="moodboard__empty">{EXPORT_COPY.noImages}</p>, options: null, summary: EXPORT_COPY.noImages, message: null, exporting: false, waiting: false, canExport: false, exportBoard });
    return <div className="moodboard moodboard--empty">
      <header className="modal-header"><h2 id="modal-title" className="modal-title">导出灵感板</h2></header>
      <div className="modal-body"><p className="moodboard__empty">本画布没有图片。把图片拖进画布、圈进一个分组，再回来导出。</p></div>
      <footer className="modal-footer">{footerButton}</footer>
    </div>;
  }
  const missing = group.items.filter(item => images.has(item.id) && !images.get(item.id)).length;
  const previewContent = <div className="moodboard__preview" aria-label={`预览：${title}，${group.items.length} 张图片`} role="img" aria-busy={waiting}>
        <canvas ref={preview}/>
        {waiting && <span className="moodboard__waiting" role="status">{EXPORT_COPY.preparingMoodboard}</span>}
      </div>;
  const optionsContent = <fieldset className="moodboard__options" disabled={busy || exporting}>
        <legend className="sr-only">灵感板选项</legend>
        <div className="moodboard__option">
          <span className="dialog-label" id={scopeId}>范围</span>
          {groups.length > 1
            ? <select className="moodboard__select" aria-labelledby={scopeId} value={group.id} onChange={event => setGroupId(event.target.value)}>
              {groups.map(item => <option key={item.id} value={item.id}>{item.id === 'all' ? `全部图片（${item.items.length} 张）` : `分组“${item.title}”（${item.items.length} 张）`}</option>)}
            </select>
            : <span className="moodboard__scope">{group.id === 'all' ? '全部图片' : `分组“${group.title}”`}，{group.items.length} 张</span>}
        </div>
        <Segmented label="版式" choices={LAYOUTS} value={options.layout} onChange={set('layout')}/>
        <Segmented label="底色" choices={BACKGROUNDS} value={options.background} onChange={set('background')}/>
        <div className="moodboard__pair">
          <Segmented label="边距" choices={MARGINS} value={options.margin} onChange={set('margin')}/>
          <Segmented label="图片下方" choices={CAPTIONS} value={options.caption} onChange={set('caption')}/>
        </div>
        <label className="dialog-check"><input type="checkbox" checked={options.footer} onChange={event => set('footer')(event.target.checked)}/>页脚列出每张图的来源</label>
        <Segmented label="格式" choices={FORMATS} value={options.format} onChange={set('format')}/>
      </fieldset>;
  const summary = <span className="modal-footer-hint moodboard__summary" role="status">
        共 {group.items.length} 张，导出 <span className="moodboard__px">{(output.width * sheet.scale).toLocaleString('en-US')} × {(output.height * sheet.scale).toLocaleString('en-US')}</span>
        {missing > 0 && <span className="moodboard__warn">，{missing} 张读不到，导出时画成空位</span>}
      </span>;
  const message = <>{error && <span className="dialog-error moodboard__error" role="alert">{error}</span>}{!error && notice && <span className="moodboard__done" role="status">{notice}</span>}</>;
  if (renderLayout) return renderLayout({ preview: previewContent, options: optionsContent, summary, message, exporting, waiting, canExport: !busy && !waiting && !exporting && !!group.items.length, exportBoard });
  return <div className="moodboard">
    <header className="modal-header"><h2 id="modal-title" className="modal-title">导出灵感板</h2></header>
    <div className="modal-body moodboard__body">{previewContent}{optionsContent}</div>
    <footer className="modal-footer">{summary}{message}
      {footerButton}
      <button type="button" className="btn btn--primary" disabled={busy || exporting || waiting || !group.items.length} onClick={() => void exportBoard()}>
        {exporting && <LoaderCircle className="spin" size={15} aria-hidden="true"/>}{exporting ? '正在导出…' : '导出'}
      </button>
    </footer>
  </div>;
}

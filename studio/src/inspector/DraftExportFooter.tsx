import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowDownToLine, ChevronDown, CircleAlert, Eye, LoaderCircle, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BoardNode } from '../model';
import { useBoard } from '../board-context';
import type { BoardActions } from '../board-context';
import { saveExport } from '../file-export';
import { exportDraftMarkdown } from '../draft-export';
import { closeDetailsOnEscape, InspectorSlot, useInspectorLayout } from './shared';
import { draftStats, formatCount } from './draft-text';
import { DRAFT_SAVE_EVENT } from './draft-editor/panel';
import { buildScript, formatDuration, scriptTimeResolver } from './script-view/script-model';
import type { ScriptModel } from './script-view/script-model';
import { exportScriptCsv, exportScriptMarkdown } from './script-view/script-export';
import { exportScriptPdf } from './script-view/script-print';
import { useDraftView } from './script-view/view-mode';

type SaveStatus = 'saved' | 'saving' | 'error' | 'readonly';
/** Optional App fields (integration request inspector-writing): the save state for the status band. */
type SaveAwareBoard = BoardActions & { saveStatus?: SaveStatus; saveStatusText?: string; retrySave?: () => void };

/**
 * The status band needs the top bar's save state while focus writing hides the top bar (§6.18.4). With the optional
 * `saveStatus` / `retrySave` board fields it reads them directly; until App provides them it mirrors the top bar's
 * `save-status` element (same words, same state) and its “重试” button.
 */
function useSaveStatus(): { status: SaveStatus; text: string; retry?: () => void } | null {
  const board = useBoard() as SaveAwareBoard;
  const [mirror, setMirror] = useState<{ status: SaveStatus; text: string } | null>(null);
  useEffect(() => {
    if (board.saveStatus) return;
    let observed: Element | null = null;
    const observer = new MutationObserver(() => read());
    const read = () => {
      const element = document.querySelector('[data-testid="save-status"]');
      if (element !== observed) {
        observer.disconnect();
        observed = element;
        if (element?.parentElement) observer.observe(element.parentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
      }
      if (!element) { setMirror(null); return; }
      const status = (['saving', 'error', 'readonly'] as const).find(name => element.classList.contains(`is-${name}`)) ?? 'saved';
      const text = (element.querySelector('.save-status__text')?.textContent ?? element.textContent ?? '').replace('重试', '').trim();
      setMirror(previous => previous?.status === status && previous.text === text ? previous : { status, text });
    };
    read();
    return () => observer.disconnect();
  }, [board.saveStatus]);
  if (board.saveStatus) {
    const fallback = { saved: '已保存到本机', saving: '保存中', error: '保存失败', readonly: '只读窗口' }[board.saveStatus];
    return { status: board.saveStatus, text: board.saveStatusText ?? fallback, retry: board.retrySave };
  }
  if (!mirror) return null;
  // The top bar only reports the failure now (polish round 4 P7): its one retry is the canvas banner's “重试保存”.
  return { ...mirror, retry: () => [...document.querySelectorAll<HTMLButtonElement>('.save-recovery-banner button')].find(button => button.textContent?.trim() === '重试保存')?.click() };
}

function SaveState({ state, flash }: { state: NonNullable<ReturnType<typeof useSaveStatus>>; flash: boolean }) {
  const icon = state.status === 'saving' ? <LoaderCircle size={12} className="draft-band__spin" aria-hidden="true" />
    : state.status === 'error' ? <CircleAlert size={14} aria-hidden="true" />
      : state.status === 'readonly' ? <Eye size={14} aria-hidden="true" />
        : <span className="draft-band__dot" aria-hidden="true" />;
  return <span className={`draft-band__save is-${state.status}${flash ? ' is-flash' : ''}`}>
    {icon}<span>{state.text}</span>
    {state.status === 'error' && state.retry && <button type="button" className="btn btn--line btn--sm" onClick={state.retry}>重试</button>}
  </span>;
}

/** “共 3 场 9 行，成片约 2:20” (§6.29) with the numbers in tabular figures; no “口播” anywhere (K11). */
function ScriptSummary({ model }: { model: ScriptModel }) {
  const lines = <><b className="tabular">{model.lineCount}</b> 行</>;
  const head: ReactNode = model.sceneCount ? <>共 <b className="tabular">{model.sceneCount}</b> 场 {lines}</> : <>{lines}，还没有分场</>;
  const total: ReactNode = model.total === undefined ? (model.sceneCount ? '，成片时长未定' : null)
    : <>，成片约 <b className="tabular">{formatDuration(model.total)}</b>{model.untimedScenes ? `（${model.untimedScenes} 场未定）` : ''}</>;
  return <span className="draft-band__script">{head}{total}</span>;
}

/**
 * Draft footer. Docked: “正文 N 字 预计阅读 N 分钟” and the export menu. Focus writing: the 40px status band
 * (§6.18.4): save state, counts and reading time; it fades out while typing and never while saving failed; the
 * export menu moves to the header. Counting reads only the prose (draftStats = draftCharacterCount, PW-B2); “预计阅读” stays (K11, C12).
 * In 脚本 (§6.29) the counts become the script's: “共 N 场 M 行，成片约 m:ss”, and the export menu leads with the script:
 * the storyboard PDF (frames, time codes, sources), the CSV table, the Markdown table.
 */
export default function DraftExportFooter({ node, exporting, setExporting, onNotify }: {
  node: BoardNode;
  exporting: boolean;
  setExporting: Dispatch<SetStateAction<boolean>>;
  onNotify: (message: string) => void;
}) {
  const board = useBoard();
  const layout = useInspectorLayout();
  const { data } = node;
  const footerRef = useRef<HTMLElement>(null);
  const { count, quoted, minutes } = useMemo(() => draftStats(data.body), [data.body]);
  const [view] = useDraftView(node.id, data.body);
  const script = view === 'script';
  const scriptModel = useMemo(() => script ? buildScript(data.body, scriptTimeResolver(board.nodes)) : null, [script, data.body, board.nodes]);
  const save = useSaveStatus();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const root = footerRef.current?.closest('aside.inspector');
    if (!root) return;
    let timer = 0;
    const onSave = () => { setFlash(true); window.clearTimeout(timer); timer = window.setTimeout(() => setFlash(false), 1600); };
    root.addEventListener(DRAFT_SAVE_EVENT, onSave);
    return () => { root.removeEventListener(DRAFT_SAVE_EVENT, onSave); window.clearTimeout(timer); };
  }, [layout]);
  const exportMarkdown = async (includeSources: boolean) => {
    if (exporting) return;
    setExporting(true);
    try {
      const content = exportDraftMarkdown(node, board.nodes, includeSources);
      const safeTitle = (data.title || '未命名文稿').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 90);
      const result = await saveExport({ format: 'markdown', suggestedName: `${safeTitle}${includeSources ? '-带来源' : ''}.md`, data: new TextEncoder().encode(content) });
      onNotify(result.status === 'saved'
        ? `已保存${includeSources ? '带来源文稿' : '纯稿'}`
        : result.status === 'cancelled' ? '导出已取消' : `已开始下载${includeSources ? '带来源文稿' : '纯稿'}`);
    } catch (error) { onNotify(`文稿导出未完成：${error instanceof Error ? error.message : String(error)}`); }
    finally { setExporting(false); }
  };
  const exportScript = async (format: 'markdown' | 'csv' | 'pdf') => {
    if (exporting) return;
    setExporting(true);
    try {
      if (format === 'pdf') {
        const result = await exportScriptPdf(data.title, data.body, board.nodes, board.getMediaUrl);
        onNotify(result === 'saved' ? '已保存分镜脚本 PDF' : result === 'cancelled' ? '导出已取消' : '已打开打印窗口：选“另存为 PDF”即可保存');
        return;
      }
      const content = format === 'csv' ? exportScriptCsv(data.body, board.nodes) : exportScriptMarkdown(data.title, data.body, board.nodes);
      const safeTitle = (data.title || '未命名文稿').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 90);
      const result = await saveExport({ format, suggestedName: `${safeTitle}-脚本.${format === 'csv' ? 'csv' : 'md'}`, data: new TextEncoder().encode(content) });
      const name = format === 'csv' ? '脚本表格 CSV' : '脚本表格';
      onNotify(result.status === 'saved' ? `已保存${name}` : result.status === 'cancelled' ? '导出已取消' : `已开始下载${name}`);
    } catch (error) { onNotify(`脚本导出未完成：${error instanceof Error ? error.message : String(error)}`); }
    finally { setExporting(false); }
  };
  const writing = layout === 'writing';
  /** A choice closes the menu and gives focus back to its button, like any menu. */
  const closeMenu = (button: HTMLElement) => {
    const details = button.closest('details');
    if (!details) return;
    details.open = false;
    details.querySelector('summary')?.focus({ preventScroll: true });
  };
  const exportMenu = <details className={`inspector-draft-export draft-export${writing ? ' draft-export--header' : ''}`} onKeyDown={closeDetailsOnEscape}>
    <summary className={writing ? 'inspector-head-button inspector-head-button--text draft-head-button draft-head-button--line' : 'btn btn--line btn--sm'}>
      {exporting ? <LoaderCircle size={14} className="draft-band__spin" aria-hidden="true" /> : writing ? <Upload size={15} aria-hidden="true" /> : <ArrowDownToLine size={14} aria-hidden="true" />}
      {writing || script ? '导出' : '导出正文'}<ChevronDown size={12} aria-hidden="true" />
    </summary>
    <div className="draft-export__menu" role="group" aria-label="导出正文">
      {script && <>
        <button type="button" disabled={exporting} aria-label="导出分镜脚本 PDF" onClick={event => { closeMenu(event.currentTarget); void exportScript('pdf'); }}>
          <strong>分镜脚本 PDF</strong><small>带画面缩略图、时间码与来源，可直接打印交付</small>
        </button>
        <button type="button" disabled={exporting} aria-label="导出脚本表格 CSV" onClick={event => { closeMenu(event.currentTarget); void exportScript('csv'); }}>
          <strong>脚本表格 CSV</strong><small>每行一个镜头，表格软件可直接打开</small>
        </button>
        <button type="button" disabled={exporting} aria-label="导出脚本表格 Markdown" onClick={event => { closeMenu(event.currentTarget); void exportScript('markdown'); }}>
          <strong>脚本表格 Markdown</strong><small>每场一张表：画面、旁白、时长，带来源与时间码</small>
        </button>
        <span className="draft-export__rule" role="separator" />
      </>}
      <button type="button" disabled={exporting} aria-label="导出纯稿 Markdown" onClick={event => { closeMenu(event.currentTarget); void exportMarkdown(false); }}>
        <strong>纯稿 Markdown</strong><small>保留正文与引文，移除画布内部链接</small>
      </button>
      <button type="button" disabled={exporting} aria-label="导出带来源 Markdown" onClick={event => { closeMenu(event.currentTarget); void exportMarkdown(true); }}>
        <strong>带来源 Markdown</strong><small>正文附来源注释，便于交付与核对</small>
      </button>
    </div>
  </details>;
  // §8.3 #25: “正文” is the writer's own words, “含引文” the whole text with the quotations (the number the card
  // rounds); an empty draft has no reading time to state.
  const own = Math.max(0, count - quoted);
  const reading = count <= 0 ? null : minutes < 1
    ? <span>预计阅读不到 <b className="tabular">1</b> 分钟</span>
    : <span>预计阅读 <b className="tabular">{Math.round(minutes)}</b> 分钟</span>;
  const withQuotes = quoted > 0 ? <span title="正文加上引用的原文">含引文 <b className="tabular">{formatCount(count)}</b> 字</span> : null;
  if (writing) {
    return <footer ref={footerRef} className={`inspector-footer draft-band${save?.status === 'error' ? ' is-error' : ''}`}>
      {save && <SaveState state={save} flash={flash} />}
      {scriptModel ? <ScriptSummary model={scriptModel} /> : <>
        <span>正文 <b className="tabular">{formatCount(own)}</b> 字</span>
        {withQuotes}
        {reading}
      </>}
      <InspectorSlot name="header-actions" fallback={<span className="draft-band__end">{exportMenu}</span>}>{exportMenu}</InspectorSlot>
    </footer>;
  }
  return <footer ref={footerRef} className="inspector-footer draft-footer">
    <span className="draft-footer__stats">
      {flash && save ? <SaveState state={save} flash /> : scriptModel ? <ScriptSummary model={scriptModel} /> : <>
        <span>正文 <b className="tabular">{formatCount(own)}</b> 字</span>
        {/* When the docked panel is too narrow for all three, the last one drops out: 预计阅读 (K11) outranks 含引文. */}
        {reading}
        {withQuotes}
      </>}
    </span>
    {exportMenu}
  </footer>;
}

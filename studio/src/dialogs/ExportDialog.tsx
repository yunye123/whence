import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, FolderOpen, LoaderCircle } from 'lucide-react';
import type { Board } from '../model';
import { BoardContext } from '../board-context';
import { DraftIcon, ImageIcon } from '../icons/field-icons';
import { draftStage } from '../cards/card-utils';
import { draftCharacterCount } from '../source-location';
import { exportBoardScript } from '../app/export-actions';
import { useModalControls } from '../shell/ModalShell';
import MoodboardExport from './MoodboardExport';
import { moodGroups } from './moodboard';
import { useCanvasMeasurements } from './canvas-measurements';
import { EXPORT_COPY, EXPORT_FORMATS, EXPORT_FORMAT_KEY, defaultExportFormat, defaultScriptDraft, exportFilename, formatMemoryValue, moveExportFormat, parseFormatMemory, type ExportFormat } from './export-format';

export interface ExportDialogProps {
  board: Board;
  busy: boolean;
  directoryAvailable: boolean;
  onExportPackage: () => void;
  onExportDirectory: () => void;
  onExportMarkdown: () => void;
  initialView?: 'list' | 'moodboard';
  initialGroupId?: string;
  onNotify?: (message: string) => void;
  /** Optional integration hints; old callbacks and contract fixtures stay valid. */
  currentDraftId?: string | null;
  lastModifiedDraftId?: string;
  /** Lets App disable its close/Esc controls while the internal PDF or moodboard operation is busy. */
  onBusyChange?: (message: string) => void;
  /** Successful internal exports can close while user close controls remain locked. */
  onExportComplete?: () => void;
}

function PackageIcon() {
  return <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3.5" y="4.5" width="17" height="15" rx="2"/><rect x="6.5" y="7.5" width="5" height="4" rx=".5"/><rect x="13" y="7.5" width="4.5" height="9" rx=".5"/><path d="M6.5 14.5h5"/>
  </svg>;
}
const formatIcon = (format: ExportFormat, size = 22) => format === 'script' ? <FileText size={size} aria-hidden="true"/> : format === 'markdown' ? <DraftIcon size={size}/> : format === 'moodboard' ? <ImageIcon size={size}/> : format === 'directory' ? <FolderOpen size={size} aria-hidden="true"/> : <PackageIcon/>;
function readMemory() { try { return parseFormatMemory(sessionStorage.getItem(EXPORT_FORMAT_KEY)); } catch { return {}; } }

/** Release 1 shell. Selection only changes the view; the shared footer performs every export. */
export default function ExportDialog({ board, busy, directoryAvailable, onExportPackage, onExportDirectory, onExportMarkdown, initialView = 'list', initialGroupId, onNotify, currentDraftId, lastModifiedDraftId, onBusyChange, onExportComplete }: ExportDialogProps) {
  const actions = useContext(BoardContext), modal = useModalControls();
  const measure = useCanvasMeasurements();
  const groups = useMemo(() => moodGroups(board, actions?.getMediaUrl, measure()), [board, actions, measure]);
  const imageCount = groups.find(group => group.id === 'all')?.items.length ?? 0;
  const drafts = board.nodes.filter(node => node.data.kind === 'draft');
  const reason = (id: ExportFormat) => id === 'directory' && !directoryAvailable ? EXPORT_COPY.desktop : id === 'moodboard' && !imageCount ? EXPORT_COPY.noImages : id === 'script' && !drafts.length ? EXPORT_COPY.noDraft : '';
  const available = EXPORT_FORMATS.filter(format => !reason(format.id)).map(format => format.id);
  const [selection, setSelection] = useState(() => ({ boardId: board.id, format: defaultExportFormat(board.id, readMemory(), available, initialView) }));
  const format = selection.boardId === board.id && available.includes(selection.format) ? selection.format : defaultExportFormat(board.id, readMemory(), available, initialView);
  useEffect(() => {
    try { sessionStorage.setItem(EXPORT_FORMAT_KEY, formatMemoryValue(readMemory(), board.id, format)); } catch { /* optional session memory */ }
  }, [board.id, format]);
  const [draftChoice, setDraftChoice] = useState<{ boardId: string; id: string }>();
  const draft = drafts.find(node => draftChoice?.boardId === board.id && node.id === draftChoice.id) ?? defaultScriptDraft(board.nodes, currentDraftId ?? actions?.inspectedId, lastModifiedDraftId);
  const [internalBusy, setInternalBusy] = useState('');
  const pending = useRef(false);
  const [notice, setNotice] = useState('');
  const blocked = busy || !!internalBusy;
  const formatsRef = useRef<HTMLDivElement>(null);
  const keyboardTarget = useRef<ExportFormat | undefined>(undefined);
  useEffect(() => {
    if (keyboardTarget.current) { formatsRef.current?.querySelector<HTMLButtonElement>('[data-export-format="' + keyboardTarget.current + '"]')?.focus(); keyboardTarget.current = undefined; }
  }, [format]);
  const ids = useId();
  const active = EXPORT_FORMATS.find(item => item.id === format)!;
  const updateBusy = useCallback((message: string) => { setInternalBusy(message); onBusyChange?.(message); }, [onBusyChange]);
  const moodBusy = useCallback((value: boolean) => updateBusy(value ? EXPORT_COPY.busy : ''), [updateBusy]);
  const notify = (message: string) => { setNotice(message); onNotify?.(message); };
  const select = (next: ExportFormat) => { if (!blocked) { setSelection({ boardId: board.id, format: next }); setNotice(''); } };
  const options = <div className="export-options" role="radiogroup" aria-label="导出格式" ref={formatsRef}>
    {EXPORT_FORMATS.map(item => <button key={item.id} type="button" role="radio" data-export-format={item.id} aria-checked={format === item.id} tabIndex={format === item.id ? 0 : -1}
      disabled={blocked || !!reason(item.id)} className={reason(item.id) ? 'is-unavailable' : undefined}
      aria-labelledby={ids + '-' + item.id + '-t'} aria-describedby={ids + '-' + item.id + '-f ' + ids + '-' + item.id + '-d'}
      onClick={() => select(item.id)} onKeyDown={event => {
        if (event.nativeEvent.isComposing || blocked) return;
        const next = moveExportFormat(item.id, event.key, available);
        if (next) { event.preventDefault(); keyboardTarget.current = next; select(next); formatsRef.current?.querySelector<HTMLButtonElement>('[data-export-format="' + next + '"]')?.focus(); }
      }}>
      <span className="exp-icon">{formatIcon(item.id)}</span>
      <span className="exp-copy"><strong id={ids + '-' + item.id + '-t'}>{item.title}</strong><small id={ids + '-' + item.id + '-f'} className="exp-format">{reason(item.id) || item.label}</small><span className="sr-only" id={ids + '-' + item.id + '-d'}>{item.detail}</span></span>
    </button>)}
  </div>;

  const frame = ({ preview, controls, summary, message, canExport = true, onExport, waiting = false }: { preview: ReactNode; controls: ReactNode; summary: ReactNode; message?: ReactNode; canExport?: boolean; onExport: () => void; waiting?: boolean }) => <>
    <header className="modal-header"><h2 id="modal-title" className="modal-title">导出</h2><p className="modal-subtitle">「{board.title || '未命名画布'}」共 {board.nodes.filter(node => node.data.kind !== 'frame').length.toLocaleString('en-US')} 张卡片</p></header>
    <div className="modal-body export-dialog__body" aria-busy={blocked}>
      {options}<section className="export-dialog__stage" aria-label={format === 'moodboard' ? '灵感板预览' : '导出说明'}>{preview}</section>
      <section className="export-dialog__settings" aria-label="导出选项">{controls}</section>
    </div>
    <footer className="modal-footer export-dialog__footer"><div className="export-dialog__summary">{summary}{message}{format !== 'moodboard' && notice && <span role="status">{notice}</span>}{internalBusy && <span role="status">{internalBusy}</span>}</div>
      <button type="button" className="btn btn--line" disabled={blocked} onClick={() => modal?.close()}>取消</button>
      <button type="button" className="btn btn--primary" disabled={blocked || !canExport || waiting} onClick={onExport}>{blocked && <LoaderCircle className="spin" size={15} aria-hidden="true"/>}{blocked ? EXPORT_COPY.busy : '导出'}</button>
    </footer>
  </>;

  if (format === 'moodboard') return <MoodboardExport key={board.id} board={board} initialGroupId={initialGroupId} busy={busy} onBusyChange={moodBusy} onCancel={() => modal?.close()} onDone={message => { notify(message); if (onNotify) modal?.close(); }} notice={notice}
    renderLayout={parts => frame({ preview: parts.preview, controls: parts.options, summary: parts.summary, message: parts.message, canExport: parts.canExport, waiting: parts.waiting, onExport: () => void parts.exportBoard() })}/>;

  const filename = exportFilename(format === 'script' ? draft?.data.title ?? '' : board.title, format);
  const explanation = <article className="export-dialog__explanation">
    <span className="export-dialog__format-icon">{formatIcon(format, 32)}</span><h3>{active.title}</h3><p className="export-dialog__no-preview">{EXPORT_COPY.noPreview}</p><p>{active.detail}</p>
    <div className="export-dialog__filename"><span>文件名</span><strong>{filename}</strong></div>
  </article>;
  const controls = format === 'script' ? <fieldset className="export-dialog__drafts" disabled={blocked}><legend>选择文稿</legend>{drafts.map(node => <label className="export-dialog__draft" key={node.id}><input type="radio" name={ids + '-draft'} checked={draft?.id === node.id} onChange={() => setDraftChoice({ boardId: board.id, id: node.id })}/><span><strong>{node.data.title || '未命名文稿'}</strong><small>{draftStage(node.data.draftVersions?.length ?? 0)} · {draftCharacterCount(node.data.body).toLocaleString('en-US')} 字</small></span></label>)}</fieldset>
    : <div className="export-dialog__details"><h3>包含内容</h3><p>{active.detail}</p><p className="export-dialog__format-label">{active.label}</p></div>;
  const exportSelected = async () => {
    if (blocked || pending.current || reason(format)) return;
    pending.current = true;
    try {
      if (format === 'script' && draft) await exportBoardScript(board, draft, actions?.getMediaUrl ?? (() => undefined), { setBusy: updateBusy, notify, close: () => { if (onExportComplete) onExportComplete(); else if (onNotify) modal?.close(); } });
      else if (format === 'markdown') onExportMarkdown();
      else if (format === 'package') onExportPackage();
      else if (format === 'directory') onExportDirectory();
    } finally { pending.current = false; }
  };
  return frame({ preview: explanation, controls, summary: <span>{active.label}{format === 'script' ? ' · A4 横向' : ''}</span>, canExport: !reason(format), onExport: () => void exportSelected() });
}

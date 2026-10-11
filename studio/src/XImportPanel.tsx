import { useId, useMemo, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowDownToLine, HardDrive, LoaderCircle, ShieldCheck } from 'lucide-react';
import { extractXLinks } from '../shared/x-import';

export interface XImportPanelProps {
  value: string;
  onChange: (value: string) => void;
  onImport: () => void;
  onCancel: () => void;
  available: boolean;
  busy: boolean;
  committing?: boolean;
  progress?: string;
  error?: string;
  readOnly?: boolean;
}

const batchLimit = 10;

export default function XImportPanel({
  value, onChange, onImport, onCancel, available, busy,
  committing = false, progress, error, readOnly = false,
}: XImportPanelProps) {
  const id = useId();
  const detected = useMemo(() => {
    try { return { count: extractXLinks(value).length, error: '' }; }
    catch (reason) { return { count: 0, error: reason instanceof Error ? reason.message : '未能识别推文链接，请检查后重试。' }; }
  }, [value]);
  const pending = busy || committing;
  const validationError = detected.count > batchLimit
    ? `一次最多导入 ${batchLimit} 条推文，请分批粘贴。`
    : detected.error;
  const shownError = error || validationError;
  const canImport = available && !readOnly && !pending && !validationError && detected.count > 0;
  const status = committing ? '正在保存到画布…' : progress || '正在读取正文与素材…';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canImport) onImport();
  }

  function shortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canImport) onImport();
    }
  }

  return <form className="x-import-panel" aria-label="X 推文导入" aria-busy={pending} onSubmit={submit}>
    <label className="x-import-panel__label dialog-label" htmlFor={`${id}-links`}>X 推文链接或分享文案</label>
    <textarea
      id={`${id}-links`}
      className="x-import-panel__input"
      autoFocus={available && !readOnly}
      aria-label="X 推文链接或分享文案"
      aria-describedby={`${id}-detected ${id}-help${shownError ? ` ${id}-error` : ''}`}
      aria-invalid={shownError ? true : undefined}
      placeholder={'https://x.com/.../status/...\n文章请粘贴文章所在推文链接'}
      value={value}
      maxLength={12000}
      readOnly={readOnly}
      disabled={pending || !available}
      onChange={event => onChange(event.target.value)}
      onKeyDown={shortcut}
    />
    <p id={`${id}-detected`} className="x-import-panel__detected" role="status" aria-live="polite" aria-atomic="true">
      {detected.count ? `识别到 ${detected.count} 条推文` : value.trim() && !validationError ? '请粘贴具体推文的完整链接' : '一次最多 10 条，同一条推文会自动去重'}
    </p>
    {!available && <p className="x-import-panel__notice"><HardDrive size={16} aria-hidden="true" />请在来处桌面版导入</p>}
    {readOnly && available && <p className="x-import-panel__notice">当前窗口只读，请在正在编辑的窗口导入。</p>}
    <p id={`${id}-help`} className="x-import-panel__help">
      视频、图文、长推文与文章，保留作者和原链接。长文正文若不完整，会明确标注。
    </p>
    {shownError && <p id={`${id}-error`} className="x-import-panel__error" role="alert">{shownError}</p>}
    {pending && <p className="x-import-panel__progress" role="status" aria-live="polite" aria-atomic="true">
      <LoaderCircle size={16} className="x-import-panel__spinner" aria-hidden="true" /><span>{status}</span>
    </p>}
    <div className="x-import-panel__actions">
      <p className="x-import-panel__source"><ShieldCheck size={14} aria-hidden="true" /><span>通过第三方公开接口读取内容。私密、已删除或付费受限的内容无法导入。</span></p>
      {!committing && <button type="button" className="btn btn--line x-import-panel__cancel" onClick={onCancel}>{busy ? '取消导入' : '取消'}</button>}
      <button type="submit" className="btn btn--primary x-import-panel__submit" disabled={!canImport}>
        {!pending && <ArrowDownToLine size={15} aria-hidden="true" />}
        {committing ? '正在保存…' : busy ? '正在导入…' : '导入正文与素材'}
      </button>
    </div>
  </form>;
}

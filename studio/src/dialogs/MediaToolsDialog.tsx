import { useEffect, useId, useState } from 'react';
import { toolCheckLabel, toolRemedy } from '../../native/transcription-readiness';
import { useModalControls } from '../shell/ModalShell';

type ToolKey = 'python' | 'ffmpeg' | 'ffprobe' | 'model';
type ToolPaths = Record<ToolKey, string>;

interface ToolsStatus {
  settings: ToolPaths;
  defaults: ToolPaths;
  fromEnvironment: Record<ToolKey, boolean>;
}

interface ToolCheck { name: string; ok: boolean; detail: string }

const EMPTY: ToolPaths = { python: '', ffmpeg: '', ffprobe: '', model: '' };
const FIELDS: { key: ToolKey; label: string; hint: string }[] = [
  { key: 'python', label: 'Python', hint: '用来下载链接和转写' },
  { key: 'ffmpeg', label: 'FFmpeg', hint: '处理视频' },
  { key: 'ffprobe', label: 'ffprobe', hint: '读取视频信息，和 FFmpeg 放在一起' },
  { key: 'model', label: '语音模型', hint: 'faster-whisper 的模型目录，里面要有 model.bin' },
];

function toolsBridge() {
  return globalThis.window?.fieldMediaTools;
}

/**
 * Where a person points 来处 at Python, FFmpeg and the speech model on this computer.
 * Blank fields keep the default location. The page never starts those programs itself.
 */
export default function MediaToolsDialog() {
  const modal = useModalControls();
  const baseId = useId();
  const desktop = !!toolsBridge();
  const [status, setStatus] = useState<ToolsStatus | null>(null);
  const [paths, setPaths] = useState<ToolPaths>(EMPTY);
  const [checks, setChecks] = useState<ToolCheck[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'save' | 'check' | 'restore' | ''>('');
  const [loaded, setLoaded] = useState(!desktop);

  useEffect(() => {
    const bridge = toolsBridge();
    if (!bridge) return;
    let alive = true;
    void bridge.read().then(value => {
      if (!alive) return;
      setStatus(value);
      setPaths(value.settings);
      setLoaded(true);
    }).catch(cause => {
      if (!alive) return;
      setError(cause instanceof Error && cause.message ? cause.message : '没有读到这台电脑上的工具位置。');
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  const apply = (next: ToolsStatus, message: string) => {
    setStatus(next);
    setPaths(next.settings);
    setChecks(null);
    setNotice(message);
  };

  const save = async () => {
    const bridge = toolsBridge();
    if (!bridge) return;
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const result = await bridge.save(paths);
      if (!result.ok) { setError(result.error); return; }
      apply(result.status, '已保存。下载和转写会用这些位置。');
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '没有把本机工具保存到这台电脑。');
    } finally { setBusy(''); }
  };

  const restore = async () => {
    const bridge = toolsBridge();
    if (!bridge) return;
    setBusy('restore');
    setError('');
    setNotice('');
    try {
      const result = await bridge.clear();
      if (!result.ok) { setError(result.error); return; }
      apply(result.status, '已恢复这台电脑的默认位置。');
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '没有恢复这台电脑的默认位置。');
    } finally { setBusy(''); }
  };

  const check = async () => {
    const bridge = toolsBridge();
    if (!bridge) return;
    setBusy('check');
    setError('');
    setNotice('');
    setChecks(null);
    try {
      const result = await bridge.check(paths);
      if (!result.ok) { setError(result.error); return; }
      setChecks(result.checks);
      setNotice(result.checks.every(item => item.ok) ? '这台电脑上的工具都能找到。' : '有几项还没找到。对照下面的说明改路径后再检查。');
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '没有检查成本机工具。');
    } finally { setBusy(''); }
  };

  const saved = FIELDS.some(field => status?.settings[field.key]);
  const usingEnvironment = FIELDS.some(field => status?.fromEnvironment[field.key]);
  return (
    <form className="modal-form" noValidate onSubmit={event => { event.preventDefault(); if (desktop && loaded && !busy) void save(); }}>
      <header className="modal-header">
        <h2 id="modal-title" className="modal-title">本机工具</h2>
        <p className="modal-subtitle">只用于从链接下载视频，以及在这台电脑上转写。</p>
      </header>
      <div className="modal-body media-tools">
        <p className="dialog-hint">画布、笔记、文稿、摘录、把本地图片和视频放上画布、再导出，这些都已经在来处里，不用再安装。</p>
        <p className="dialog-hint">把英语译成中文，要在侧栏「翻译密钥」里填写你自己的接口密钥。</p>
        <p className="dialog-hint">只有从分享链接下载视频，或让来处在这台电脑上把视频转成逐字稿，才需要下面四项。用安装程序装好时，这四项和识图已经备好，留空即可。</p>
        {!desktop && <p className="dialog-hint" role="status">本机工具需要来处桌面版。浏览器里不能保存。</p>}
        {usingEnvironment && <p className="dialog-hint" role="status">有一项留空时，会使用启动前设置的环境变量。在这里填写并保存后，以这里的为准。</p>}
        {FIELDS.map(field => (
          <div className="dialog-field" key={field.key}>
            <label className="dialog-label" htmlFor={`${baseId}-${field.key}`}>{field.label}</label>
            <input
              id={`${baseId}-${field.key}`}
              aria-label={field.label}
              disabled={!desktop || !!busy}
              autoComplete="off"
              spellCheck={false}
              maxLength={1000}
              placeholder={status?.defaults[field.key] || '留空使用默认位置'}
              value={paths[field.key]}
              onChange={event => setPaths(current => ({ ...current, [field.key]: event.target.value }))}
            />
            <p className="dialog-hint">{field.hint}</p>
          </div>
        ))}
        {checks && (
          <ul className="media-tools__checks" aria-label="检查结果">
            {checks.map(item => {
              const note = item.ok ? item.detail : (toolRemedy(item.name) || '在侧栏「本机工具」里改这一项的位置，保存后再检查。');
              return (
              <li key={item.name} className={item.ok ? 'is-ok' : 'is-missing'}>
                <span>{item.ok ? '已找到' : '没找到'} {toolCheckLabel(item.name)}</span>
                {note && <small>{note}</small>}
              </li>
              );
            })}
          </ul>
        )}
        {notice && <p className="dialog-hint" role="status">{notice}</p>}
        {error && <p className="media-tools__error" role="alert">{error}</p>}
      </div>
      <footer className="modal-footer">
        <span className="modal-footer-hint">保存后立刻生效，不用重新启动</span>
        <button type="button" className="btn btn--line" disabled={!desktop || !loaded || !!busy} onClick={() => void check()}>{busy === 'check' ? '正在检查…' : '检查'}</button>
        {saved && <button type="button" className="btn btn--line" disabled={!desktop || !!busy} onClick={() => void restore()}>恢复默认</button>}
        {modal && <button type="button" className="btn btn--line" disabled={modal.locked || !!busy} onClick={modal.close}>取消</button>}
        <button type="submit" className="btn btn--primary" disabled={!desktop || !loaded || !!busy}>{busy === 'save' ? '正在保存…' : '保存'}</button>
      </footer>
    </form>
  );
}

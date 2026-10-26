import { useEffect, useId, useState } from 'react';
import { useModalControls } from '../shell/ModalShell';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';

interface SettingsStatus {
  saved: boolean;
  fromEnvironment: boolean;
  unreadable: boolean;
  baseUrl: string;
  model: string;
}

function settingsBridge() {
  return globalThis.window?.fieldTranslationSettings;
}

/**
 * Where a person types the key used to translate English into Chinese.
 * The field starts empty: a saved key is never sent back to the page.
 */
export default function TranslationSettingsDialog() {
  const modal = useModalControls();
  const keyId = useId();
  const urlId = useId();
  const modelId = useId();
  const desktop = !!settingsBridge();
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!desktop);

  useEffect(() => {
    const bridge = settingsBridge();
    if (!bridge) return;
    let alive = true;
    void bridge.read().then(value => {
      if (!alive) return;
      setStatus(value);
      setBaseUrl(value.baseUrl);
      setModel(value.model);
      setLoaded(true);
    }).catch(cause => {
      if (!alive) return;
      setError(cause instanceof Error && cause.message ? cause.message : '没有读到翻译设置。');
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  const apply = (value: SettingsStatus, message: string) => {
    setStatus(value);
    setBaseUrl(value.baseUrl);
    setModel(value.model);
    setApiKey('');
    setVisible(false);
    setError('');
    setNotice(message);
  };

  const save = async () => {
    const bridge = settingsBridge();
    if (!bridge) { setError('翻译密钥需要来处桌面版。浏览器里不能保存。'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await bridge.save({ apiKey, baseUrl, model });
      if (!result.ok) { setError(result.error); return; }
      apply(result.status, '已保存。');
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '没有把密钥保存到这台电脑。');
    } finally { setBusy(false); }
  };

  const clear = async () => {
    const bridge = settingsBridge();
    if (!bridge) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await bridge.clear();
      if (!result.ok) { setError(result.error); return; }
      apply(result.status, result.status.fromEnvironment ? '已清除本机保存的密钥。当前仍使用启动时的环境变量。' : '已清除本机保存的密钥。');
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '没有清除这台电脑上的翻译密钥。');
    } finally { setBusy(false); }
  };

  const saved = !!status?.saved;
  return (
    <form className="modal-form" noValidate onSubmit={event => { event.preventDefault(); if (desktop && loaded && !busy) void save(); }}>
      <header className="modal-header">
        <h2 id="modal-title" className="modal-title">翻译密钥</h2>
        <p className="modal-subtitle">用来把英语译成简体中文。</p>
      </header>
      <div className="modal-body translation-settings">
        <p className="dialog-hint">密钥只保存在这台电脑上，用系统加密。不会写入画布，也不会出现在导出的文件里。</p>
        {!desktop && <p className="dialog-hint" role="status">翻译密钥需要来处桌面版。浏览器里不能保存。</p>}
        {status?.fromEnvironment && <p className="dialog-hint" role="status">启动时的环境变量里已有密钥。在这里保存后，以这里填写的为准。</p>}
        {status?.unreadable && <p className="dialog-hint" role="status">已保存的密钥读不出来，请重新填写。</p>}
        {saved && <p className="dialog-hint" role="status">已保存在这台电脑上，优先于启动时的环境变量。密钥留空再保存，会保持原密钥。</p>}
        <div className="dialog-field">
          <label className="dialog-label" htmlFor={keyId}>接口密钥</label>
          <span className="translation-settings__secret">
            <input
              id={keyId}
              aria-label="接口密钥"
              type={visible ? 'text' : 'password'}
              autoFocus={desktop}
              disabled={!desktop || busy}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={2000}
              placeholder={saved ? '已保存，留空则不更换' : '粘贴接口密钥'}
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
            />
            <button type="button" className="btn btn--line btn--sm" disabled={!desktop || busy} onClick={() => setVisible(value => !value)}>{visible ? '隐藏' : '显示'}</button>
          </span>
        </div>
        <div className="dialog-field">
          <label className="dialog-label" htmlFor={urlId}>接口地址</label>
          <input id={urlId} aria-label="接口地址" disabled={!desktop || busy} autoComplete="off" spellCheck={false} maxLength={300} placeholder={DEFAULT_BASE_URL} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} />
        </div>
        <div className="dialog-field">
          <label className="dialog-label" htmlFor={modelId}>模型</label>
          <input id={modelId} aria-label="模型" disabled={!desktop || busy} autoComplete="off" spellCheck={false} maxLength={120} placeholder={DEFAULT_MODEL} value={model} onChange={event => setModel(event.target.value)} />
        </div>
        {notice && <p className="dialog-hint" role="status">{notice}</p>}
        {error && <p className="translation-settings__error" role="alert">{error}</p>}
      </div>
      <footer className="modal-footer">
        <span className="modal-footer-hint">也可以在启动前设置环境变量，没在这里保存时才使用</span>
        {saved && <button type="button" className="btn btn--line" disabled={!desktop || busy} onClick={() => void clear()}>清除</button>}
        {modal && <button type="button" className="btn btn--line" disabled={modal.locked || busy} onClick={modal.close}>取消</button>}
        <button type="submit" className="btn btn--primary" disabled={!desktop || !loaded || busy}>{busy ? '正在保存…' : '保存'}</button>
      </footer>
    </form>
  );
}

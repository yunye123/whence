import { useState } from 'react';
import { MarkIcon, Wordmark } from '../icons/field-icons';

/** The brand row of the recovery pages (§9): the mark「原点」(ink paper + the zhu dot, --brand-dot) and the wordmark 来处. */
function RecoveryBrand() {
  return <span className="recovery-screen__brand" aria-hidden="true"><span className="recovery-screen__mark"><MarkIcon size={24}/></span><Wordmark height={17}/></span>;
}

/** The technical message, folded away: only needed when reporting the problem; it can be copied in one click. */
function ErrorDetails({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(message).then(() => setCopied(true), () => {}); };
  return (
    <details className="recovery-screen__details">
      <summary>错误信息</summary>
      <pre>{message}</pre>
      <button type="button" className="btn btn--sm btn--line" onClick={copy}>{copied ? '已复制' : '复制错误信息'}</button>
    </details>
  );
}

/** Shown when the local workspace cannot be read; nothing saved is replaced. */
export function LoadErrorScreen({ message }: { message: string }) {
  return (
    <main className="recovery-screen">
      <section className="recovery-screen__paper">
        <RecoveryBrand/>
        <h1>本机工作区暂时无法读取</h1>
        <p>已保存的内容没有被替换。重新载入再试一次；不要清除应用或浏览器数据。</p>
        <button type="button" className="btn btn--primary" onClick={()=>location.reload()}>重新载入</button>
        <ErrorDetails message={message}/>
      </section>
    </main>
  );
}

/**
 * The last line of defence (src/main.tsx ErrorBoundary, §8.2): what happened, that saved work is safe, one next step.
 * New brand and tokens; the old “f” block is gone. Saving happens continuously, so a reload resumes from the last save.
 */
export function CrashScreen({ message }: { message: string }) {
  return (
    <main className="recovery-screen" role="alert">
      <section className="recovery-screen__paper">
        <RecoveryBrand/>
        <h1>界面出了错</h1>
        <p>已保存到本机的内容不受影响。重新载入后，从上次保存的地方继续。</p>
        <button type="button" className="btn btn--primary" onClick={()=>location.reload()}>重新载入</button>
        <ErrorDetails message={message}/>
      </section>
    </main>
  );
}

/**
 * Cold start before the local workspace is read (CORE-23, §9): the mark「原点」(ink paper + zhu dot) with the wordmark on the canvas
 * ground, fading in only if the wait is noticeable. No spinner: the wait is usually under half a second.
 */
export function LoadingScreen() {
  return (
    <main className="recovery-screen boot-screen" aria-busy="true">
      <span className="boot-screen__brand" aria-hidden="true"><span className="boot-screen__mark"><MarkIcon size={28}/></span><Wordmark height={19}/></span>
      <p className="sr-only" role="status">正在打开来处</p>
    </main>
  );
}

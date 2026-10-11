import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { TranscriptLine } from '../model';
import { timeRangeLabel } from '../source-location';
import InspectorDialog from '../InspectorDialog';
import { corrections } from './video-watch';
import { chordKeys } from '../dialogs/shortcuts';

/**
 * Corrects one line's text only; its time range and id never change (contract B8 / K9-17).
 * PV-m2: the dialog stays a native modal (inert background, focus trap, Esc, unload guard all unchanged) but opens
 * right under its own sentence (CSS anchor positioning on the row marked `.is-editing`) over the shared v2 scrim.
 * Without anchor support it falls back to the centred panel.
 */
export default function TranscriptCorrectionDialog({ line, excerpted = false, busy, onSave, onCancel, onDirtyChange }: {
  line: TranscriptLine;
  /** An excerpt covers this sentence: only then does the dialog say that excerpts keep their words (INSP-29). */
  excerpted?: boolean;
  busy: boolean;
  onSave: (text: string) => string | void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [text, setText] = useState(line.text);
  const [error, setError] = useState('');
  const changed = text !== line.text;
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => () => dirtyCallback.current(false), []);
  // Mark the row this dialog belongs to; it becomes the anchor the dialog opens under.
  useLayoutEffect(() => {
    corrections.set('active', { lineId: line.id, dirty: false });
    return () => { if (corrections.get('active')?.lineId === line.id) corrections.delete('active'); };
  }, [line.id]);
  // Anchor positioning cannot follow a row that has left the window (position-try only flips around a visible
  // anchor): while the row is off screen the dialog becomes the centred sheet instead (INSP-01).
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const row = document.querySelector('.inspector--video .inspector-transcript-line.is-editing');
      const list = row?.closest('.watch-transcript');
      const rect = row?.getBoundingClientRect(), box = list?.getBoundingClientRect();
      const visible = !!rect && rect.height > 0 && rect.bottom > Math.max(0, box?.top ?? 0) && rect.top < Math.min(window.innerHeight, box?.bottom ?? window.innerHeight);
      setFloating(!visible);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };
    schedule();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => { window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); if (frame) cancelAnimationFrame(frame); };
  }, [line.id]);
  useEffect(() => {
    const current = corrections.get('active');
    if (current?.lineId === line.id && current.dirty !== changed) corrections.set('active', { lineId: line.id, dirty: changed });
  }, [changed, line.id]);
  const changeText = (value: string) => {
    onDirtyChange(value !== line.text);
    setText(value); setError('');
  };
  const cancel = () => { onDirtyChange(false); onCancel(); };
  const save = () => { const failure = onSave(text); if (failure) setError(failure); else onDirtyChange(false); };
  const range = timeRangeLabel(line.start, line.end) ?? '';
  return <InspectorDialog title="校对这一句" dirty={changed} className={`watch-correct-dialog${floating ? ' is-floating' : ''}`} onCancel={cancel}>
    <div className="watch-correct__body">
    <p className="inspector-dialog-description watch-correct__lead">
      <span className="watch-correct__time tabular">{range}</span>只修改文字，时间与来源保持不变。
    </p>
    <label className="watch-correct__field">
      <span>当前文字</span>
      <textarea aria-label="当前文字"
        data-autofocus
        value={text}
        maxLength={20000}
        disabled={busy}
        onChange={event => changeText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !busy && changed) { event.preventDefault(); save(); }
        }}
        aria-describedby={error ? 'transcript-correction-error' : 'transcript-correction-keys'}
      />
    </label>
    {line.originalText !== undefined && <div className="watch-correct__original">
      <h3>原始文字</h3>
      <blockquote>{line.originalText}</blockquote>
      <button type="button" className="btn btn--sm btn--line" disabled={busy || text === line.originalText} onClick={() => changeText(line.originalText!)}>
        <RotateCcw size={14} aria-hidden="true" />恢复原文
      </button>
      <small>恢复后点击保存，才会写回逐字稿。</small>
    </div>}
    {excerpted && <p className="watch-correct__note">这句已有摘录，摘录保留创建时的文字，不会跟着这次校对改变。</p>}
    {busy && <p className="watch-correct__error" role="status">当前正在处理逐字稿，请在任务完成后再保存校对。</p>}
    {error && <p id="transcript-correction-error" className="watch-correct__error" role="alert">{error}</p>}
    </div>
    <footer>
      <span id="transcript-correction-keys" className="watch-correct__keys">{chordKeys({ key: 'Enter', mod: true }).map(key => <kbd key={key}>{key}</kbd>)}保存　<kbd>Esc</kbd>取消</span>
      <button type="button" className="btn btn--line" onClick={cancel}>取消</button>
      <button type="button" className="btn btn--primary" disabled={busy || !changed} onClick={save}>保存校对</button>
    </footer>
  </InspectorDialog>;
}

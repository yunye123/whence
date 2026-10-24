import { useEffect, useRef, useState } from 'react';
import {
  applySurfaceTranslation, surfaceTranslation,
  type SurfaceTranslation, type TranslationSurface, type TranslationUpdate,
} from '../english-translation';
import type { CardData } from '../model';

/**
 * The one control that asks the desktop process to translate English into Chinese.
 * The request itself lives in english-translation.ts.
 */
export function EnglishTranslation({
  job, existing, readOnly = false, suspended = false, onTranslated,
}: {
  job: SurfaceTranslation | null;
  existing?: string;
  readOnly?: boolean;
  suspended?: boolean;
  onTranslated: (updates: TranslationUpdate[]) => void;
}) {
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  const latestSegments = useRef(job?.segments ?? []);
  const onTranslatedRef = useRef(onTranslated);
  latestSegments.current = job?.segments ?? [];
  onTranslatedRef.current = onTranslated;
  useEffect(() => () => { alive.current = false; }, []);
  if (!job) return null;

  const missing = job.segments.filter(segment => !job.translatedIds.includes(segment.id));
  const sending = missing.length ? missing : job.segments;
  const action = running ? '正在翻译…' : missing.length === 0 ? '重新翻译' : missing.length < job.segments.length ? '继续翻译' : '译成中文';
  const desktop = typeof window !== 'undefined' && !!window.fieldTranslate;
  const disabled = readOnly || suspended || running;
  const title = readOnly ? '此窗口只读'
    : suspended ? '请等当前任务结束后再翻译'
      : desktop ? '把这段英语译成简体中文，原文保留'
        : '翻译需要来处桌面版，并在启动前设置 CANVAS_TRANSLATE_API_KEY';

  const run = async () => {
    if (disabled) return;
    const bridge = typeof window === 'undefined' ? undefined : window.fieldTranslate;
    if (!bridge) {
      setStatus('翻译需要来处桌面版。请设置环境变量 CANVAS_TRANSLATE_API_KEY 后重新启动。');
      return;
    }
    const sent = sending.map(segment => ({ ...segment }));
    setRunning(true);
    setStatus(sent.length > 1 ? `正在翻译 ${sent.length} 段…` : '正在翻译…');
    try {
      const result = await bridge.translate({
        segments: sent,
        contentType: job.contentType,
        contextTitle: job.contextTitle,
        targetLanguage: 'zh',
      });
      if (!alive.current) return;
      const fresh = new Map(latestSegments.current.map(segment => [segment.id, segment.text]));
      const accepted: TranslationUpdate[] = [];
      let stale = 0;
      let tooLong = 0;
      for (const segment of result.segments) {
        const source = sent.find(item => item.id === segment.id);
        if (!segment.text || !source) continue;
        if (fresh.get(segment.id) !== source.text) { stale += 1; continue; }
        if (segment.text.length > job.maxLength) { tooLong += 1; continue; }
        accepted.push({ id: segment.id, text: segment.text, source: source.text });
      }
      if (accepted.length) onTranslatedRef.current(accepted);
      const failed = result.segments.filter(segment => !segment.text).length + stale + tooLong;
      if (!accepted.length) {
        setStatus(stale ? '原文已改变，没有写入过期译文。' : tooLong ? '译文超过可保存长度。' : (result.error || '没有得到可用的中文译文。'));
      } else if (failed) {
        setStatus(`已译出 ${accepted.length} 段，还有 ${failed} 段没有译出。${result.error || ''}`);
      } else {
        setStatus('已译成中文。原文仍保留。');
      }
    } catch (error) {
      if (alive.current) setStatus(error instanceof Error && error.message ? error.message : '翻译失败。');
    } finally {
      if (alive.current) setRunning(false);
    }
  };

  return <div className={`inspector-translation${job.surface === 'transcript' ? ' inspector-translation--transcript' : ''}`}>
    {existing?.trim() && <details className="inspector-translation__result" open>
      <summary>译文</summary>
      <div className="inspector-translation__text" lang="zh-CN">{existing}</div>
    </details>}
    <div className="inspector-translation__actions">
      <button type="button" className="btn btn--sm btn--line" disabled={disabled} title={title} aria-busy={running || undefined} onClick={() => void run()}>{action}</button>
      {!desktop && <span className="inspector-translation__hint">需在桌面版配置密钥</span>}
    </div>
    {status && <p className="inspector-translation__status" role="status">{status}</p>}
  </div>;
}

export function TranslationForCard({
  data, surface, nodeId, readOnly = false, suspended = false, update,
}: {
  data: CardData;
  surface: TranslationSurface;
  nodeId: string;
  readOnly?: boolean;
  suspended?: boolean;
  update: (id: string, patch: Partial<CardData>) => boolean;
}) {
  const dataRef = useRef(data);
  dataRef.current = data;
  return <EnglishTranslation
    job={surfaceTranslation(data, surface)}
    existing={surface === 'transcript' ? undefined : data.translation}
    readOnly={readOnly}
    suspended={suspended}
    onTranslated={updates => {
      const next = applySurfaceTranslation(dataRef.current, surface, updates);
      if (next) update(nodeId, next);
    }}
  />;
}

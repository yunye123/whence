import { useEffect, useRef, useState } from 'react';
import {
  acceptTranslationUpdates, applySurfaceTranslation, surfaceTranslation, translationNotice,
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
      const judged = acceptTranslationUpdates(sent, result, id => latestSegments.current.find(segment => segment.id === id)?.text, job.maxLength);
      if (judged.updates.length) onTranslatedRef.current(judged.updates);
      setStatus(translationNotice(judged.updates.length, judged.stale, judged.tooLong, judged.empty, result.error));
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
  data, surface, nodeId, readOnly = false, suspended = false, showExisting = true, update,
}: {
  data: CardData;
  surface: TranslationSurface;
  nodeId: string;
  readOnly?: boolean;
  suspended?: boolean;
  /** The watch page already shows a description's Chinese in 简介. */
  showExisting?: boolean;
  update: (id: string, patch: Partial<CardData>) => boolean;
}) {
  const dataRef = useRef(data);
  dataRef.current = data;
  return <EnglishTranslation
    job={surfaceTranslation(data, surface)}
    existing={showExisting && surface !== 'transcript' ? data.translation : undefined}
    readOnly={readOnly}
    suspended={suspended}
    onTranslated={updates => {
      const next = applySurfaceTranslation(dataRef.current, surface, updates);
      if (next) update(nodeId, next);
    }}
  />;
}

import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, History, RotateCcw, X } from 'lucide-react';
import type { CardData } from '../model';
import { uid } from '../model';
import { useBoard } from '../board-context';
import { draftCharacterCount } from '../source-location';
import { formatCount, versionParagraphs } from './draft-text';
import { draftStage } from '../cards/card-utils';
import type { PatchCard } from './shared';

type Version = NonNullable<CardData['draftVersions']>[number];

function versionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return sameDay ? `今天 ${time}` : `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`;
}

/** Read-only preview of a version before restoring it (PW-m1); paragraphs that differ from the current body are marked. */
function VersionPreview({ version, currentBody }: { version: Version; currentBody: string }) {
  const paragraphs = useMemo(() => versionParagraphs(version.body), [version.body]);
  const currentParagraphs = useMemo(() => versionParagraphs(currentBody), [currentBody]);
  const current = useMemo(() => new Set(currentParagraphs), [currentParagraphs]);
  const changed = paragraphs.filter(paragraph => !current.has(paragraph)).length;
  const saved = new Set(paragraphs);
  const added = currentParagraphs.filter(paragraph => !saved.has(paragraph)).length;
  const summary = [
    changed ? `有 ${changed} 段与当前不同（已标出）` : '',
    added ? `当前多出 ${added} 段` : '',
  ].filter(Boolean).join('，') || '与当前正文相同';
  return <div className="draft-version__preview" aria-label={`${version.title || '未命名文稿'} 的正文预览`}>
    <p className="draft-version__summary">{summary}</p>
    {paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index} className={current.has(paragraph) ? undefined : 'is-changed'}>{paragraph}</p>)
      : <p className="draft-empty-copy">这个版本没有正文。</p>}
  </div>;
}

/**
 * Saved draft versions (max 100). Restoring always keeps the current body as a new version first.
 * - `section`: the docked panel's block (保存版本 + “N 个历史版本” toggle + list); also the server-rendered fallback.
 * - `drawer`:  focus writing's version drawer, opened by the header's “版本” button, which carries the toggle name.
 */
export default function DraftVersions({ data, patch, onNotify, showVersions, setShowVersions, mode = 'section' }: {
  data: CardData;
  patch: PatchCard;
  onNotify: (message: string) => void;
  showVersions: boolean;
  setShowVersions: Dispatch<SetStateAction<boolean>>;
  mode?: 'section' | 'drawer';
}) {
  const board = useBoard();
  const versions = data.draftVersions || [];
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Saving answers next to the button (§6.22): saving a version is what moves the draft to its next stage (INSP-10).
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(null), 6000);
    return () => window.clearTimeout(timer);
  }, [saved]);
  const saveVersion = () => {
    if (versions.length >= 100) { onNotify('已达 100 个版本上限，暂时无法保存新版本。先从“导出 → 便携画布文件”另存一份；现有版本会完整保留。'); return; }
    if (versions[0]?.body === data.body && versions[0]?.title === data.title) { setSaved('正文没有变化，这一稿已经保存过'); return; }
    if (patch({ draftVersions: [{ id: uid(), title: data.title, body: data.body, createdAt: new Date().toISOString() }, ...versions] })) {
      setSaved(`已保存${draftStage(versions.length)}，现在写的是${draftStage(versions.length + 1)}`);
    }
  };
  const restoreVersion = (version: Version) => {
    if (versions.length >= 100) { onNotify('已达 100 个版本上限，暂时无法为恢复前的正文留存版本。先从“导出 → 便携画布文件”另存一份；当前正文与现有版本均未改变。'); return; }
    const changed = version.body !== data.body || version.title !== data.title;
    if (!changed) { onNotify('这就是当前正文'); return; }
    const previous = { id: uid(), title: data.title, body: data.body, createdAt: new Date().toISOString() };
    if (patch({ title: version.title, body: version.body, draftVersions: [previous, ...versions] })) { setPreviewId(null); onNotify('已恢复版本，恢复前的正文也已留存'); }
  };
  const list = <div className="draft-version-list inspector-version-list">
    {versions.length ? versions.map(version => {
      const previewing = previewId === version.id;
      return <div key={version.id} className={`draft-version${previewing ? ' is-previewing' : ''}`}>
        <div className="draft-version__row">
          <div className="draft-version__text">
            <strong>{version.title || '未命名文稿'}</strong>
            <span><time dateTime={version.createdAt}>{versionTime(version.createdAt)}</time>　<span className="tabular">{formatCount(draftCharacterCount(version.body))}</span> 字</span>
          </div>
          <button type="button" className="btn btn--sm draft-version__preview-toggle" aria-expanded={previewing} onClick={() => setPreviewId(previewing ? null : version.id)}>{previewing ? '收起' : '预览'}</button>
          <button type="button" className="btn btn--line btn--sm" disabled={board.readOnly} onClick={() => restoreVersion(version)} title="恢复此版本，同时保留当前正文"><RotateCcw size={13} aria-hidden="true" />恢复</button>
        </div>
        {previewing && <VersionPreview version={version} currentBody={data.body} />}
      </div>;
    }) : <p className="draft-empty-copy">正文会随画布自动保存到本机。点“保存版本”，为重要修改留下一个可恢复的节点。</p>}
  </div>;
  const save = <button type="button" className="btn btn--soft btn--sm" disabled={board.readOnly} onClick={saveVersion} title="为当前标题与正文留一个可恢复的版本"><History size={14} aria-hidden="true" />保存版本</button>;
  const status = <p className="draft-versions__status" role="status">{saved}</p>;
  if (mode === 'drawer') {
    return <section className="draft-versions draft-versions--drawer" aria-label="文稿版本"
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setShowVersions(false); } }}
    >
      <div className="draft-picker__head">
        <h3>版本</h3>
        <span className="draft-picker__count tabular">{versions.length}</span>
        <button type="button" className="icon-btn draft-picker__close" onClick={() => setShowVersions(false)} aria-label="收起版本" title="收起 (Esc)"><X size={15} aria-hidden="true" /></button>
      </div>
      <div className="draft-versions__save">{save}<span>保存当前标题与正文，恢复时会先留存当时的正文。</span></div>
      {status}
      {list}
    </section>;
  }
  return <section className="inspector-section draft-versions">
    <div className="draft-versions__actions">
      {save}
      <button type="button" className="btn btn--sm draft-versions__toggle" onClick={() => setShowVersions(value => !value)} aria-expanded={showVersions}>
        <span>{versions.length} 个历史版本</span><ChevronDown size={14} aria-hidden="true" className={showVersions ? 'is-open' : ''} />
      </button>
    </div>
    {status}
    {showVersions && list}
  </section>;
}

/** Focus writing's header button: the same “N 个历史版本” toggle name as the docked panel (scripts find it by name). */
export function DraftVersionsButton({ count, open, onToggle }: { count: number; open: boolean; onToggle: (detail: number) => void }) {
  return <button type="button" className={`inspector-head-button inspector-head-button--text draft-head-button${open ? ' is-pressed' : ''}`} aria-label={`${count} 个历史版本`} aria-expanded={open} title="版本" onClick={event => onToggle(event.detail)}>
    <History size={15} aria-hidden="true" /><span>版本</span>
  </button>;
}

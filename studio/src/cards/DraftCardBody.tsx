import { useMemo, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { BookOpen, PenLine } from 'lucide-react';
import ProvenanceTag from '../components/ProvenanceTag';
import { ProvenanceParagraphIcon, ProvenancePlayIcon } from '../icons/field-icons';
import { Words } from './Words';
import { DRAFT_FONT, foldedParagraphLabel, invalidateManuscriptPlans, manuscriptBudget, manuscriptExcerpt, manuscriptProjection, manuscriptReferences, manuscriptText, planManuscript, simpleManuscriptText } from './draft-preview';
import { draftCharacterCount, type DraftFootnote } from '../source-location';
import { approxCharacters, draftStage } from './card-utils';
import { cardExtras, type CardBodyProps } from './types';

type PreviewPart = { text: string } | { ref: number };

/**
 * The last few characters of a paragraph stay on one line, so the preview never ends a paragraph with one or two
 * characters on a row of their own (“……也需要自己的 / 声音。”, §3.4 “不允许孤字成行”). Same count as focus writing
 * (`markdown.ts`, INSP-09); a reference ending the paragraph stays with them. Only the presentation changes — at every
 * zoom tier, since the simple tier shows the same first paragraph.
 */
export const KEEP_CHARACTERS = 4;
export function splitKeep(parts: PreviewPart[], count = KEEP_CHARACTERS): { head: PreviewPart[]; tail: PreviewPart[] } {
  const head = [...parts];
  const tail: PreviewPart[] = [];
  let taken = 0;
  while (head.length && taken < count) {
    const part = head.pop()!;
    if ('ref' in part) { tail.unshift(part); continue; }
    const characters = Array.from(part.text);
    let cut = characters.length;
    while (cut > 0 && taken < count) { cut--; if (characters[cut].trim()) taken++; }
    // Whitespace just before the kept characters stays outside, where the line may still break.
    if (cut > 0) head.push({ text: characters.slice(0, cut).join('') });
    tail.unshift({ text: characters.slice(cut).join('') });
  }
  return { head, tail };
}

// A single font lifecycle for every mounted/remounted manuscript; no card geometry or styles are read.
let fontVersion = 0;
let fontsStarted = false;
const fontListeners = new Set<() => void>();
const notifyFonts = () => { invalidateManuscriptPlans(); fontVersion++; fontListeners.forEach(listener => listener()); };
function subscribeFonts(listener: () => void) {
  fontListeners.add(listener);
  if (!fontsStarted && typeof document !== 'undefined') {
    fontsStarted = true;
    void Promise.all([document.fonts.load(DRAFT_FONT, '文稿正文'), document.fonts.load('600 14px "Noto Sans SC Variable"', '小标题')])
      .then(() => document.fonts.ready).then(notifyFonts);
    document.fonts.addEventListener('loadingdone', notifyFonts);
  }
  return () => { fontListeners.delete(listener); };
}
const noFonts = () => () => {};
/** Main uses the same revision in CardShell's draft contentKey, releasing an initial deferred LOD hold. */
export function useDraftFontVersion(enabled = true): number {
  return useSyncExternalStore(enabled ? subscribeFonts : noFonts, () => enabled ? fontVersion : 0, () => 0);
}

/** Main wires the existing node height here; width/height are model geometry, never mounted DOM reads. */
export interface DraftCardBodyProps extends CardBodyProps { previewHeight?: number }

export function DraftCardBody({ id, data, board, activate, openCard, previewWidth, previewHeight }: DraftCardBodyProps) {
  const version = useDraftFontVersion();
  const projection = useMemo(() => manuscriptProjection(data.body), [data.body]);
  const plan = useMemo(() => planManuscript(projection, previewWidth ? previewWidth - 72 : undefined,
    manuscriptBudget(previewHeight, projection.footnotes.length, version ? projection : undefined, previewWidth), version ? undefined : null), [projection, previewWidth, previewHeight, version]);
  // Without loaded fonts/known width the fallback is explicitly deferred. Never invent a measured height in SSR.
  const measured = version > 0 && plan.status === 'measured';
  const visible = measured ? plan.visible : projection.paragraphs.slice(0, 4);
  const firstProse = projection.paragraphs.find(p => p.number && p.text);
  const excerpt = useMemo(() => measured && previewHeight && previewWidth && firstProse && !plan.visible.includes(firstProse)
    ? manuscriptExcerpt(firstProse, previewWidth - 72, plan.budget) : undefined, [measured, previewHeight, previewWidth, firstProse, plan]);
  const displayed = firstProse && !visible.includes(firstProse) ? [...visible, firstProse] : visible;
  const extras = cardExtras(board);
  const locationOf = (f: DraftFootnote) => (f.quoteNodeId && extras.quoteLocation?.(f.quoteNodeId)) || f.location || '原文';
  const onSource = (f: DraftFootnote, event: MouseEvent) => activate(event, () => board.focusSource(f.sourceNodeId, f.time, false, f.quoteNodeId, { draftId: id, footnote: f.index }));
  const numbered = new Map(projection.paragraphs.flatMap(p => p.footnotes.map(index => [index, p.number] as const)));
  const referenceLayout = manuscriptReferences(previewHeight, projection.footnotes.length);
  const rows = projection.footnotes.slice(0, referenceLayout.rows);

  return <div className="field-card__draft-content card-drag-content" data-draft-plan={measured ? 'measured' : 'deferred'} data-draft-fixed={previewHeight ? '' : undefined}>
    <div className="field-card__draft-rule" aria-hidden="true" />
    <div className="field-card__draft-frame">
      <div className={`field-card__draft-preview${excerpt ? ' has-excerpt' : measured && !plan.visible.length && firstProse ? ' has-fold-only' : ''}`} style={measured && !previewHeight && !plan.visible.length && firstProse ? { minHeight: Math.min(112, plan.budget + 24) } : undefined}>
        {displayed.map(p => {
          const references = p.footnotes.map(index => projection.footnotes[index - 1]).filter(Boolean);
          const timed = p.heading ? /^(.*?)\s+(\d{1,2}:\d{2}(?::\d{2})?(?:[–—-]\d{1,2}:\d{2}(?::\d{2})?)?)$/.exec(p.text) : null;
          const partial = p === firstProse ? excerpt : undefined;
          return <div key={p.from} className={`field-card__draft-paragraph${p.heading ? ' is-heading' : ''}${p.quoted ? ' is-quoted' : ''}${p === firstProse ? ' is-first-prose' : ''}${partial ? ' is-excerpt' : !visible.includes(p) ? ' is-simple-only' : ''}`}
            style={partial ? { '--draft-excerpt-lines': partial.lines } as CSSProperties : undefined}>
            {p.number > 0 && <span className={`field-card__draft-pn field-card__ref${references.length ? ' is-cited' : ''}`} data-pn={p.number}
              data-edge-anchor={references.length ? 'para-ref' : undefined} data-cite-key={references[0]?.quoteNodeId ?? references[0]?.sourceNodeId} aria-hidden="true" />}
            <p className={p.heading ? 'field-card__draft-heading' : undefined}><Words text={partial?.text ?? timed?.[1] ?? (!measured || !visible.includes(p) ? simpleManuscriptText(p.text, measured && previewWidth ? previewWidth - 72 : undefined) : p.text)} mode="char" minRun={4} />{timed && <time>{timed[2]}</time>}</p>
            {p.quoted && references.length > 0 && <div className="field-card__draft-cite" data-edge-anchor="stamp" data-cite-key={references[0].quoteNodeId ?? references[0].sourceNodeId}>
              <ProvenanceTag variant="stamp-mini" label={locationOf(references[0])} gone={!board.sourceNodeIds.has(references[0].sourceNodeId)}
                actionLabel={`回到引文来源：${references[0].label || '原始素材'} ${locationOf(references[0])}`} onActivate={event => onSource(references[0], event)}
                className="field-card__draft-stamp" />
              <span>{manuscriptText(references[0].label) || '原始素材'}</span>
            </div>}
          </div>;
        })}
        {!projection.paragraphs.length && <p className="is-placeholder">从一个念头开始，把画布上的灵感写成自己的作品。</p>}
        {measured && plan.folded.length > 0 && <button type="button" className="field-card__draft-more nodrag nowheel" onClick={event => activate(event, openCard)} aria-label={`展开文稿阅读：${data.title}`}>{foldedParagraphLabel(plan.folded, excerpt ? firstProse?.number : undefined)}</button>}
      </div>
    </div>
    {projection.footnotes.length > 0 && <section className="field-card__draft-references" aria-label="本稿引用">
      {referenceLayout.compact ? <button className="field-card__draft-more nodrag nowheel" type="button" onClick={event => activate(event, openCard)}>本稿引用 {projection.footnotes.length} 处，展开阅读</button> : <>
      <h4>本稿引用 <span>{projection.footnotes.length} 处</span></h4>
      <ol className="field-card__footnotes" aria-label="引用来源">{rows.map(f => <Footnote key={f.index} footnote={f} number={numbered.get(f.index) ?? 0}
        location={locationOf(f)} exists={board.sourceNodeIds.has(f.sourceNodeId)} onActivate={event => onSource(f, event)} />)}</ol>
      {projection.footnotes.length > rows.length && <button className="field-card__draft-more nodrag nowheel" type="button" onClick={event => activate(event, openCard)}>另 {projection.footnotes.length - rows.length} 处引用，展开阅读</button>}
      </>}
    </section>}
  </div>;
}

function Footnote({ footnote, number, location, exists, onActivate }: {
  footnote: DraftFootnote; number: number; location: string; exists: boolean; onActivate: (event: MouseEvent) => void;
}) {
  const Icon = footnote.time !== undefined || /^\d{1,2}:/.test(location) ? ProvenancePlayIcon : ProvenanceParagraphIcon;
  const content = <>
    <span className="field-card__footnote-n">{footnote.index}</span><Icon className="field-card__footnote-icon" aria-hidden="true" />
    <span className="field-card__footnote-location">{location}</span>
    <span className="field-card__footnote-title">{manuscriptText(footnote.label) || '原始素材'}</span>
    <span className="field-card__footnote-where" data-pn={number || '—'}>本稿</span>
  </>;
  return <li className="field-card__footnote field-card__ref" data-footnote={footnote.index} data-edge-anchor="footnote" data-cite-key={footnote.quoteNodeId ?? footnote.sourceNodeId}>
    <span className="field-card__eyelet" data-footnote-eyelet={footnote.index} aria-hidden="true" />
    {exists ? <button type="button" className="field-card__footnote-btn nodrag nowheel" onClick={onActivate}
      aria-label={`回到第 ${footnote.index} 处引用的来源：${footnote.label || '原始素材'} ${location}`} title="回到原始素材">{content}</button>
      : <span className="field-card__footnote-btn is-gone" title="来源卡片已不在当前画布">{content}</span>}
  </li>;
}

/** Stage and length under the serif title: “第二稿”“约 1,860 字” (only the prose is counted, PW-B2). */
export function DraftCardMeta({ data }: Pick<CardBodyProps, 'data'>) {
  const count = useMemo(() => draftCharacterCount(data.body), [data.body]);
  return (
    <span className="field-card__draft-meta">
      <span>{draftStage(data.draftVersions?.length ?? 0)}</span>
      <span className="tabular">{count ? approxCharacters(count, 10) : '还没有正文'}</span>
    </span>
  );
}

/** Hover action: open writing (K4 `打开文稿编辑：<标题>`, read-only `展开文稿阅读：<标题>`). */
export function DraftCardActions({ data, board, activate, openCard }: CardBodyProps) {
  const reading = !!board.readOnly;
  return (
    <button
      className="field-card__chip nodrag nowheel"
      onClick={event => activate(event, openCard)}
      aria-label={`${reading ? '展开文稿阅读' : '打开文稿编辑'}：${data.title}`}
      title={reading ? '展开阅读' : '写作'}
    >
      {reading ? <BookOpen size={14} aria-hidden="true" /> : <PenLine size={14} aria-hidden="true" />}
    </button>
  );
}

/** Compatibility export; manuscript versions are expressed by the header metadata only. */
export function draftSheets(_data: Pick<CardBodyProps['data'], 'draftVersions'>) { return 0; }

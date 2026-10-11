import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { ArrowUpRight, TextCursorInput } from 'lucide-react';
import ProvenanceTag from '../components/ProvenanceTag';
import { SourceIcon } from '../icons/field-icons';
import { kindDisplayName } from '../cards/card-utils';
import { Words } from '../cards/Words';
import type { BoardNode } from '../model';
import type { EditorView } from '@codemirror/view';
import { keepEditorFocus } from './shared';
import type { ResolvedReference } from './draft-editor/sources';
import type { Signal } from './draft-editor/panel';
import { formatCount } from './draft-text';
import { draftParagraphIndexAt, singleLineText } from '../source-location';

/** The page fonts have finished loading once (margin cards are measured again then). */
let fontsSettled = false;

export interface SourceActions {
  /** Open the source at the referenced place, keeping the way back to this draft (contract C11 / K9-20). */
  open: (reference: ResolvedReference) => void;
  /** Select the reference link in the body and bring it into view. */
  locate: (reference: ResolvedReference) => void;
}

const MISSING_SOURCE = '来源卡片已不在当前画布，正文中的引用仍保留。';
const MISSING_QUOTE = '对应的摘录已不在画布上，仍可打开来源。';

/**
 * The provenance tag of a reference: only places one can return to wear the tag shape (§6.7); a reference with no
 * exact place gets a plain text button, a removed source a dashed tag that does nothing (K5 title).
 */
function ReferenceTag({ reference, size = 'standard', onOpen }: { reference: ResolvedReference; size?: 'standard' | 'mini'; onOpen?: () => void }) {
  if (!reference.source) return <ProvenanceTag gone size={size} label={reference.location ?? '来源'} />;
  if (!reference.location) {
    return onOpen
      ? <button type="button" className="draft-source-plain" onPointerDown={keepEditorFocus} onClick={onOpen}><SourceIcon size={14} aria-hidden="true" />打开来源</button>
      : null;
  }
  return <ProvenanceTag size={size} label={reference.location} actionLabel={reference.actionLabel} onActivate={onOpen} />;
}

/**
 * One source as a card (§6.18.4 页边出处卡): the margin of focus writing, the narrow-window drawer and the popover
 * behind a superscript. The margin and drawer cards carry the contract hooks (`draft-used-reference-N`,
 * `查看第N处引用来源`, `定位第N处引用到正文`): the visible words are “查看来源” and “定位到正文”, the occurrence
 * number is read out from a zero-size inline part of the same text (inline, so no space enters the name), so the
 * accessible name contains the visible label.
 * The popover repeats the content with plain names, so the contract names stay unique.
 */
export function SourceCard({ reference, variant, active = false, onHover, actions, style, cardRef }: {
  reference: ResolvedReference;
  variant: 'margin' | 'drawer' | 'popover';
  active?: boolean;
  onHover?: (index: number | null) => void;
  actions: SourceActions;
  style?: CSSProperties;
  cardRef?: Ref<HTMLElement>;
}) {
  const { index } = reference;
  const withHooks = variant !== 'popover';
  const occurrence = withHooks ? <span className="draft-ordinal">第{index}处引用</span> : null;
  return <article
    ref={cardRef}
    className={`draft-source-card draft-source-card--${variant}${active ? ' is-active' : ''}${reference.source ? '' : ' is-missing'}`}
    data-testid={withHooks ? `draft-used-reference-${index}` : undefined}
    data-ref-index={index}
    style={style}
    onMouseEnter={onHover ? () => onHover(index) : undefined}
    onMouseLeave={onHover ? () => onHover(null) : undefined}
    onFocus={onHover ? () => onHover(index) : undefined}
    onBlur={onHover ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHover(null); } : undefined}
  >
    <div className="draft-source-card__head">
      <ReferenceTag reference={reference} onOpen={() => actions.open(reference)} />
      <span className="draft-source-card__source" title={reference.title}>{reference.title}</span>
      <span className="draft-source-card__number tabular" aria-hidden="true">{index}</span>
    </div>
    {/* Short text in the margin breaks between words only (§3.4 wrapCJK: no “反/例” or a lone “人。” line, INSP-09). */}
    {reference.text && <Words as="p" className="draft-source-card__quote" text={singleLineText(reference.text)} keep={4} />}
    {reference.mine && <Words as="p" className="draft-source-card__mine" text={reference.mine} keep={4} />}
    {!reference.source ? <p className="draft-source-card__note">{MISSING_SOURCE}</p>
      : reference.quoteMissing ? <p className="draft-source-card__note">{MISSING_QUOTE}</p> : null}
    <div className="draft-source-card__actions">
      <button
        type="button"
        className="btn btn--sm draft-card-action"
        disabled={!reference.source}
        title={reference.source ? `${reference.video ? '打开原片' : '打开原文'}：${reference.title}` : '来源卡片已不在当前画布'}
        onPointerDown={keepEditorFocus}
        onClick={() => actions.open(reference)}
      ><ArrowUpRight size={14} aria-hidden="true" /><span>查看{occurrence}来源</span></button>
      <button
        type="button"
        className="btn btn--sm draft-card-action"
        title="选中正文里的这处引用"
        onClick={() => actions.locate(reference)}
      ><TextCursorInput size={14} aria-hidden="true" /><span>定位{occurrence}到正文</span></button>
    </div>
  </article>;
}

/**
 * Docked panel: every reference in body order, repeats included (test-locked), as footnote rows with a mini tag.
 * Also used inside the narrow-window drawer of focus writing (as cards).
 */
export default function DraftSourcesList({ references, actions, variant = 'list', active = null, onHover }: {
  references: readonly ResolvedReference[];
  actions: SourceActions;
  variant?: 'list' | 'drawer';
  active?: number | null;
  onHover?: (index: number | null) => void;
}) {
  if (variant === 'drawer') {
    return <section className="draft-sources draft-sources--drawer" aria-label="本稿已引用来源">
      {references.length
        ? references.map(reference => <SourceCard key={reference.span.from} reference={reference} variant="drawer" active={active === reference.index} onHover={onHover} actions={actions} />)
        : <p className="draft-empty-copy">这篇文稿还没有引用来源。</p>}
    </section>;
  }
  return <section className="inspector-section draft-sources" aria-label="本稿已引用来源">
    <div className="draft-section-heading">
      <h3>本稿已引用来源</h3>
      <span className="tabular">{formatCount(references.length)} 处</span>
    </div>
    {references.length ? <ol className="draft-sources__list">{references.map(reference => <SourceRow key={reference.span.from} reference={reference} actions={actions} />)}</ol>
      : <p className="draft-empty-copy">这篇文稿还没有引用来源。</p>}
  </section>;
}

/** The paper's compact footnote register. Margin hooks remain unique; paragraph ownership is whole-draft. */
export function DraftFootnotes({ body, references, actions }: { body: string; references: readonly ResolvedReference[]; actions: SourceActions }) {
  if (!references.length) return null;
  return <section className="draft-footnotes" aria-label="本稿引用">
    <div className="draft-section-heading"><h3>本稿引用</h3><span className="tabular">{references.length}</span></div>
    <ol>{references.map(reference => {
      const paragraph = draftParagraphIndexAt(body, reference.span.hideFrom);
      return <li key={reference.span.from}>
        <span className="draft-footnotes__number">{reference.index}</span>
        <ReferenceTag reference={reference} size="mini" />
        <span className="draft-footnotes__title" title={reference.title}>{reference.title}</span>
        <button type="button" className="draft-footnotes__locate nodrag nopan" onClick={() => actions.locate(reference)} aria-label={`定位本稿第${reference.index}处引用到正文`}>
          本稿{paragraph ? <span>{paragraph}</span> : '引用'}
        </button>
      </li>;
    })}</ol>
  </section>;
}

function SourceRow({ reference, actions }: { reference: ResolvedReference; actions: SourceActions }) {
  const { index, source } = reference;
  const kind = source ? kindDisplayName(source.data) : undefined;
  return <li data-testid={`draft-used-reference-${index}`} className={`draft-source-row${source ? '' : ' is-missing'}`}>
    <span className="draft-source-row__number tabular" aria-hidden="true">{index}</span>
    <div className="draft-source-row__main">
      <div className="draft-source-row__line">
        {reference.location && <ReferenceTag reference={reference} size="mini" />}
        <button
          type="button"
          className="draft-source-row__title"
          disabled={!source}
          aria-label={`查看第${index}处引用来源`}
          title={source ? reference.title : '来源卡片已不在当前画布'}
          onPointerDown={keepEditorFocus}
          onClick={() => actions.open(reference)}
        ><span>{reference.title}</span><ArrowUpRight size={13} aria-hidden="true" /></button>
      </div>
      {reference.text && <Words as="p" className="draft-source-row__quote" text={singleLineText(reference.text)} />}
      <small className="draft-source-row__meta">
        {!source ? MISSING_SOURCE : reference.quoteMissing ? MISSING_QUOTE : kind}
      </small>
    </div>
    <button
      type="button"
      className="icon-btn draft-source-row__locate"
      aria-label={`定位第${index}处引用到正文`}
      title="选中正文里的这处引用"
      onClick={() => actions.locate(reference)}
    ><TextCursorInput size={15} aria-hidden="true" /></button>
  </li>;
}

/** The centre of the stamp row; cards retain the existing 16px collision spacing. */
const STAMP_Y = 21;
const CARD_GAP = 16;

interface MarginLayout { anchors: number[]; heights: number[]; spine: number; notesBottom: number; titleTop: number }

/**
 * Focus writing, wide windows: a short dashed connector runs from the cited passage to its source stamp.
 * Cards that would overlap keep the existing 16px collision spacing; anchors still use raw document positions.
 * Hovering a card or putting the caret into a reference highlights the passage and the source card.
 */
export function DraftMargin({ references, notes, getView, geometry, active, onHover, actions }: {
  references: readonly ResolvedReference[];
  notes: readonly BoardNode[];
  getView: () => EditorView | null;
  geometry: Signal;
  active: number | null;
  onHover: (index: number | null) => void;
  actions: SourceActions;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const notesRef = useRef<HTMLElement>(null);
  const cardRefs = useRef(new Map<number, HTMLElement>());
  const [layout, setLayout] = useState<MarginLayout>({ anchors: [], heights: [], spine: 32, notesBottom: 0, titleTop: 72 });

  const measure = useCallback(() => {
    const root = rootRef.current, view = getView();
    if (!root || !view) return;
    const base = root.getBoundingClientRect().top;
    const anchors = references.map(reference => {
      const position = reference.span.hideFrom;
      const coords = view.coordsAtPos(position, position > 0 ? -1 : 1);
      if (coords) return (coords.top + coords.bottom) / 2 - base;
      const block = view.lineBlockAt(position);
      return view.documentTop + block.bottom - view.defaultLineHeight / 2 - base;
    });
    const heights = references.map(reference => cardRefs.current.get(reference.index)?.offsetHeight ?? 0);
    const groove = parseFloat(getComputedStyle(root).getPropertyValue('--desk-groove')) || 64;
    const title = root.closest('.inspector-layout')?.querySelector('.inspector-title-field--paper')?.getBoundingClientRect();
    const titleTop = title ? title.top - base : 72;
    const notesBottom = notesRef.current ? titleTop + notesRef.current.offsetHeight : 0;
    setLayout(previous => {
      const same = previous.spine === groove / 2 && Math.abs(previous.notesBottom - notesBottom) < .5 && Math.abs(previous.titleTop - titleTop) < .5
        && previous.anchors.length === anchors.length && anchors.every((value, index) => Math.abs(value - previous.anchors[index]) < .5)
        && previous.heights.length === heights.length && heights.every((value, index) => value === previous.heights[index]);
      return same ? previous : { anchors, heights, spine: groove / 2, notesBottom, titleTop };
    });
  }, [references, getView]);

  useLayoutEffect(() => { measure(); }, [measure, notes.length]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    const unsubscribe = geometry.subscribe(schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    for (const card of cardRefs.current.values()) observer.observe(card);
    if (notesRef.current) observer.observe(notesRef.current);
    // Reading `document.fonts.ready` makes the browser bring style up to date; this effect runs again on every keystroke
    // (the references change), so the fonts are awaited only until they have settled once.
    if (!fontsSettled) void document.fonts?.ready.then(() => { fontsSettled = true; schedule(); });
    return () => { unsubscribe(); observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [measure, geometry, references.length, notes.length]);

  const { anchors, heights, spine } = layout;
  const measured = anchors.length === references.length;
  const tops: number[] = [];
  let floor = notes.length ? layout.notesBottom + 28 : -Infinity;
  anchors.forEach((y, index) => {
    const top = Math.max(y - STAMP_Y, floor);
    tops.push(top);
    floor = top + (heights[index] || 120) + CARD_GAP;
  });
  const bottom = Math.max(0, floor) + 48;
  const holes = tops.map(top => top + STAMP_Y);
  const last = holes.length ? Math.max(holes[holes.length - 1], anchors[anchors.length - 1]) : 0;
  const activePosition = references.findIndex(reference => reference.index === active);
  const height = Math.max(bottom, last + 200);

  return <section
    ref={rootRef}
    className={`draft-margin${active !== null ? ' has-active' : ''}`}
    aria-label="本稿已引用来源"
    style={{ minHeight: `${height}px` }}
    // Esc on a margin card returns to the editor, at the caret it left (one layer at a time, §6.18).
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
      const view = getView();
      if (!view) return;
      event.preventDefault(); event.stopPropagation();
      view.focus();
    }}
  >
    {measured && anchors.length > 0 && <svg className="draft-margin__threads" width="100%" height={height} aria-hidden="true" focusable="false">
      {anchors.map((y, index) => {
        const hot = index === activePosition;
        const hole = holes[index];
        return <g key={references[index].span.from} className={`draft-margin__tie${hot ? ' is-active' : ''}`}>
          <path className="draft-margin__stitch" d={`M0 ${y}H${spine}V${hole}H${spine * 2}`} />
        </g>;
      })}
    </svg>}
    {notes.length > 0 && <aside ref={notesRef} className="draft-margin__notes" style={{ top: `${layout.titleTop}px` }} aria-label="连到这份文稿的笔记">
      <span className="draft-margin__caption">连到这份文稿的笔记</span>
      {notes.map(note => <div key={note.id} className="draft-margin__note"><Words as="p" text={note.data.body.trim() || note.data.title} keep={4} /></div>)}
    </aside>}
    {references.length === 0 && <div className="draft-margin__empty" style={{ top: `${layout.titleTop + 6}px` }}>
      <p className="draft-empty-copy">这篇文稿还没有引用来源。</p>
      <p className="draft-margin__hint">点上方“插入摘录”，把画布里的摘录写进来；每一处都会在这里挂出原句和出处。</p>
    </div>}
    {references.map((reference, index) => <SourceCard
      key={reference.span.from}
      reference={reference}
      variant="margin"
      active={active === reference.index}
      onHover={onHover}
      actions={actions}
      style={{ top: `${tops[index] ?? 0}px`, visibility: measured ? undefined : 'hidden' }}
      cardRef={element => { if (element) cardRefs.current.set(reference.index, element); else cardRefs.current.delete(reference.index); }}
    />)}
  </section>;
}

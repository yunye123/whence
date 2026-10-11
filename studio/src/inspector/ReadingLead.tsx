import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ListTree } from 'lucide-react';
import ProvenanceTag from '../components/ProvenanceTag';
import { Words } from '../cards/Words';
import type { ReadingDocument } from './reading-markdown';
import { READING_SCROLL_MARGIN, scrollReadingTo, scrollToTrace } from './TextReading';

/** One quote card cut from this text, for the “本文已摘录” list. */
export interface ReadingExcerpt {
  id: string;
  text: string;
  understanding?: string;
  /** “第 N 段”, when the quote still resolves to one place in the current text. */
  paragraph?: number;
  /** Where the quote starts in the body (to jump there in the editor). */
  from?: number;
}

const READING_SPEED = 400;

/**
 * Left column of the reading split (DESIGN_SYSTEM §6.18.3, PR-m1): contents with the current section, the quotes
 * already taken from this text, and the time left. It follows the article's scroll by itself, so scrolling never
 * re-renders the article.
 */
interface ReadingLeadProps {
  document: ReadingDocument;
  excerpts: ReadingExcerpt[];
  /** Visible characters of the whole text (no Markdown, no whitespace). */
  characters: number;
  bodyRef: RefObject<HTMLDivElement | null>;
  /** Called after a jump (the narrow-panel popover closes itself). */
  onNavigate?: () => void;
  /**
   * Editing view: the same column stays (the article does not jump sideways when switching 阅读 / 编辑); a contents
   * entry or an excerpt tag moves the editor caret to that place instead of scrolling the reading text.
   */
  onJump?: (offset: number) => void;
}

export default function ReadingLead({ document, excerpts, characters, bodyRef, onNavigate, onJump }: ReadingLeadProps) {
  const leadRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState(0);
  const headings = document.headings;
  const editing = !!onJump;

  useEffect(() => {
    const body = bodyRef.current;
    const scroller = (body ?? leadRef.current)?.closest('.inspector')?.querySelector<HTMLElement>('.inspector-scroll');
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top;
      const range = scroller.scrollHeight - scroller.clientHeight;
      setProgress(range > 8 ? Math.min(1, Math.max(0, scroller.scrollTop / range)) : 0);
      if (!headings.length) return;
      // The editor has no rendered headings to follow: no entry is marked current there.
      if (!body?.isConnected) { setCurrent(-1); return; }
      // The current section is the last heading at or above the reading line. At the very end of the text the last
      // sections may never reach that line: then any heading already in the upper half counts.
      const atEnd = range > 8 && scroller.scrollTop >= range - 2;
      const line = atEnd ? scroller.clientHeight / 2 : READING_SCROLL_MARGIN + 36;
      let active = 0;
      headings.forEach((heading, index) => {
        const element = body.querySelector<HTMLElement>(`[data-heading="${heading.blockFrom}"]`);
        if (element && element.offsetParent !== null && element.getBoundingClientRect().top - top <= line) active = index;
      });
      setCurrent(active);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    observer?.observe(body ?? scroller);
    return () => { scroller.removeEventListener('scroll', onScroll); observer?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [bodyRef, headings, editing]);

  // Keep the current contents entry visible inside the (sticky, self-scrolling) column. Only that column moves:
  // `scrollIntoView` would also scroll the article and cancel a smooth jump that is still running.
  useEffect(() => {
    const lead = leadRef.current;
    const column = lead?.closest<HTMLElement>('.inspector-slot--lead') ?? lead;
    const item = lead?.querySelector<HTMLElement>('.reading-toc__item[aria-current="location"]');
    if (!column || !item || column.scrollHeight <= column.clientHeight) return;
    const box = column.getBoundingClientRect(), rect = item.getBoundingClientRect();
    if (rect.top < box.top + 8) column.scrollTop += rect.top - box.top - 8;
    else if (rect.bottom > box.bottom - 8) column.scrollTop += rect.bottom - box.bottom + 8;
  }, [current]);

  const goTo = (from: number, index: number, instant: boolean) => {
    if (onJump) { onJump(from); onNavigate?.(); return; }
    const element = bodyRef.current?.querySelector<HTMLElement>(`[data-heading="${from}"]`);
    if (!element) return;
    setCurrent(index);
    scrollReadingTo(element, 'start', instant || reducedMotion());
    onNavigate?.();
  };
  const minutesLeft = Math.ceil(characters * (1 - progress) / READING_SPEED);

  return <nav ref={leadRef} className="reading-lead" aria-label="目录与本文已摘录">
    {headings.length > 0 && <section className="reading-lead__group" aria-label="目录">
      <h2 className="reading-lead__title">目录</h2>
      <ol className="reading-toc">
        {headings.map((heading, index) => <li key={heading.blockFrom}>
          <button
            type="button"
            className={`reading-toc__item reading-toc__item--${Math.min(3, Math.max(1, heading.level - (headings.some(item => item.level === 1) ? 0 : 1)))}`}
            aria-current={index === current ? 'location' : undefined}
            onClick={event => goTo(heading.blockFrom, index, event.detail === 0)}
          ><Words text={heading.text} /></button>
        </li>)}
      </ol>
    </section>}
    {excerpts.length > 0 && <section className="reading-lead__group" aria-label="本文已摘录">
      <h2 className="reading-lead__title">本文已摘录<span className="tabular">{excerpts.length}</span></h2>
      <ul className="reading-excerpts">
        {excerpts.map(excerpt => <li key={excerpt.id} className="reading-excerpt">
          <div className="reading-excerpt__head">
            {excerpt.paragraph
              ? <ProvenanceTag
                size="mini"
                label={`第 ${excerpt.paragraph} 段`}
                actionLabel={`回到原文第 ${excerpt.paragraph} 段`}
                onActivate={event => {
                  if (onJump && excerpt.from !== undefined) onJump(excerpt.from);
                  else scrollToTrace(bodyRef.current, excerpt.id, event.detail === 0 || reducedMotion());
                  onNavigate?.();
                }}
              />
              : <span className="reading-excerpt__lost">原文已修改，无法定位</span>}
          </div>
          <Words as="p" className="reading-excerpt__text" text={excerpt.text} />
          {excerpt.understanding && <Words as="p" className="reading-excerpt__mine" text={excerpt.understanding} />}
        </li>)}
      </ul>
    </section>}
    {/* A text with no headings and nothing taken yet: say what this column will hold instead of one stray line. */}
    {!headings.length && !excerpts.length && <section className="reading-lead__group" aria-label="本文已摘录">
      <h2 className="reading-lead__title">本文已摘录</h2>
      <Words as="p" className="reading-lead__empty" text="选中正文里值得留下的句子，按 E 摘到画布。摘下的句子会列在这里。" />
    </section>}
    {characters > 0 && <p className="reading-lead__left" title={`按中文每分钟约 ${READING_SPEED} 字估算`}>
      {progress >= 0.995 ? '已读到结尾' : minutesLeft <= 1 ? '还剩不到 1 分钟' : <>还剩约 <span className="tabular">{minutesLeft}</span> 分钟</>}
    </p>}
  </nav>;
}

/**
 * The same contents and excerpts for a reading panel too narrow for the left column (< 880, e.g. 1440 with the
 * full sidebar): a “目录” button in the header opens them as a popover. CSS shows the button only in that width.
 * Esc and a click outside close it; Esc does not also collapse the reading layout.
 */
export function ReadingLeadPopover(props: ReadingLeadProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  const close = (focusButton: boolean) => { setOpen(false); if (focusButton) buttonRef.current?.focus(); };
  return <div ref={rootRef} className="reading-lead-toggle"
    // Esc closes the open popover and nothing else, wherever focus is inside it (the “目录” button included): the
    // reading layout collapses only on the next Esc (§6.18 one layer at a time, INSP-06).
    onKeyDown={event => {
      if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation();
      close(true);
    }}
  >
    <button
      ref={buttonRef}
      type="button"
      className="btn"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      title="目录与本文已摘录"
      onClick={() => setOpen(value => !value)}
    ><ListTree size={16} aria-hidden="true" />目录</button>
    {open && <div
      id={id}
      className="reading-lead-popover"
    ><ReadingLead {...props} onNavigate={() => { props.onNavigate?.(); close(false); props.bodyRef.current?.focus({ preventScroll: true }); }} /></div>}
  </div>;
}

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

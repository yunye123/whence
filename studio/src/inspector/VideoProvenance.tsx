import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ChevronDown, Clapperboard, LocateFixed, PenLine } from 'lucide-react';
import { useBoard } from '../board-context';
import ProvenanceTag from '../components/ProvenanceTag';
import { Words } from '../cards/Words';
import DraftWords from './DraftWords';
import { clipText, clockLabel, draftUses, videoQuotes } from './video-watch';
import type { DraftUse } from './video-watch';

/**
 * 来历 (D3, §6.18.2): every sentence excerpted from this video, and which draft — and which paragraph of it —
 * each one was written into. Index card (stamp + original sentence) → a vermilion dashed thread →
 * the manuscript card (serif title, circled paragraph, the written sentence with its footnote).
 * The tag replays the film there; a draft card opens that draft.
 */
export default memo(function VideoProvenance({ nodeId, onSeek }: { nodeId: string; onSeek: (time: number) => void }) {
  const board = useBoard();
  const headingId = useId();
  const listId = useId();
  const quotes = useMemo(() => videoQuotes(board.nodes, nodeId), [board.nodes, nodeId]);
  const uses = useMemo(() => draftUses(board.nodes, nodeId, quotes), [board.nodes, nodeId, quotes]);
  const sectionRef = useRef<HTMLElement>(null);
  const fits = useFirstRowFits(sectionRef, quotes.length);
  // The reader's own choice wins over the automatic one until the panel closes.
  const [choice, setChoice] = useState<boolean | null>(null);
  const expanded = choice ?? fits;
  if (!quotes.length) return null;
  // Opening a card ends a “return to draft” trip, so it is not offered while one is in progress (K9-20).
  const canOpen = !board.draftReturn;
  // On a “补一个镜头” trip (§6.29) an excerpt not written yet can be given to the trip's script line (“配给这一行”) or
  // written in after it (“另起一行写进原话”).
  const tripLine = board.draftReturn?.insert && board.draftReturn.draftId !== nodeId ? board.draftReturn.insert : null;
  const row = tripLine?.line ? `第 ${tripLine.line} 行` : '这一行';
  const written = quotes.filter(quote => uses.has(quote.id)).length;
  const toggle = () => {
    const next = !expanded;
    setChoice(next);
    // Opening scrolls the left column so this heading sits just under the pinned player (PV-B1): the cards follow
    // below it and the column scrolls on from there; nothing slides under the player.
    if (next) requestAnimationFrame(() => {
      const section = sectionRef.current, stage = section?.closest<HTMLElement>('.inspector-stage');
      if (!section || !stage) return;
      const pinned = section.previousElementSibling instanceof HTMLElement ? section.previousElementSibling.getBoundingClientRect().height : 0;
      const top = section.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - pinned;
      stage.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
  return <section ref={sectionRef} className={`watch-origin${expanded ? '' : ' is-collapsed'}`} aria-labelledby={headingId}>
    <header className="watch-origin__head">
      <h3 id={headingId}>从这段视频摘出的句子</h3>
      {/* One phrase, so the two numbers never read as one (“3　2 句” looked like 32). */}
      <span className="watch-origin__summary">
        <span className="tabular">{quotes.length}</span> 句{written === 0 ? '' : written === quotes.length ? '，都已写进文稿' : <>，其中 <span className="tabular">{written}</span> 句已写进文稿</>}
      </span>
      {(!fits || choice === false) && <button type="button" className="btn btn--sm watch-origin__toggle" aria-expanded={expanded} aria-controls={listId} onClick={toggle}>
        {expanded ? '收起' : '展开'}<ChevronDown size={14} aria-hidden="true" />
      </button>}
      {canOpen && <button type="button" className="btn btn--sm watch-origin__find" title="在画布上选中这些摘录" onClick={() => board.openCard(quotes[0].id)}>
        <LocateFixed size={14} aria-hidden="true" />在画布上看
      </button>}
    </header>
    <ol id={listId} className="watch-origin__list" hidden={!expanded}>
      {quotes.map(quote => {
        const drafts = uses.get(quote.id) ?? [];
        return <li key={quote.id} className={`watch-origin__row${drafts.length ? ' is-written' : ''}`}>
          <article className="watch-origin__quote" aria-label={`摘录 ${quote.label}`}>
            <div className="watch-origin__tag">
              <ProvenanceTag kind="video" label={quote.label} actionLabel={`回到原片 ${clockLabel(quote.start)}`} title={`回到原片 ${quote.label}`} onActivate={() => onSeek(quote.start)} />
            </div>
            <Words as="p" text={clipText(quote.text)} />
          </article>
          <span className="watch-origin__thread" aria-hidden="true">
            {drafts.length > 0 && <svg viewBox="0 0 44 12" preserveAspectRatio="none" focusable="false">
              <line x1="0" y1="6" x2="44" y2="6" />
            </svg>}
          </span>
          <div className="watch-origin__drafts">
            {drafts.length ? drafts.map(use => <DraftCard key={use.draftId} use={use} canOpen={canOpen} onOpen={() => board.openCard(use.draftId)} />)
              : <div className="watch-origin__unused">
                <p>还没写进文稿</p>
                {board.writeToDraft && !board.readOnly && (tripLine
                  ? <span className="watch-origin__trip">
                    <button type="button" className="btn btn--sm btn--line" aria-label={`配给${row}`}
                      title={`把这段摘录作为${row}的画面，旁白不变，然后回到脚本`} onClick={() => board.writeToDraft!(quote.id, 'shot')}>
                      <Clapperboard size={14} aria-hidden="true" />配给这一行
                    </button>
                    <button type="button" className="btn btn--sm" aria-label={`另起一行写进原话，在${row}之后`}
                      title={`把原话和出处写成${row}之后的新一行，然后回到脚本`} onClick={() => board.writeToDraft!(quote.id, 'line')}>
                      <PenLine size={14} aria-hidden="true" />另起一行写进原话
                    </button>
                  </span>
                  : canOpen && <button type="button" className="btn btn--sm btn--line" title="写进最近编辑的文稿，并打开它" onClick={() => board.writeToDraft!(quote.id)}>
                    <PenLine size={14} aria-hidden="true" />写进文稿
                  </button>)}
              </div>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
});

/**
 * INSP-14: whether the first row of cards (excerpt → draft) is mostly visible below the player without scrolling the
 * left column. At 1366×768 only the tags would peek out above the window edge, so the section shows its one-line
 * summary (“2 句，都已写进文稿 · 展开”) instead of half-cut cards; at 1440×900 the first row fits and stays open.
 */
function useFirstRowFits(sectionRef: RefObject<HTMLElement | null>, count: number): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const stage = section?.closest<HTMLElement>('.inspector-stage');
    const head = section?.querySelector<HTMLElement>('.watch-origin__head');
    if (!section || !stage || !head || typeof ResizeObserver !== 'function') return;
    let rowHeight = 120;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const row = section.querySelector<HTMLElement>('.watch-origin__row');
      if (row && row.offsetParent !== null) rowHeight = row.getBoundingClientRect().height || rowHeight;
      const headBottom = head.getBoundingClientRect().bottom - stage.getBoundingClientRect().top + stage.scrollTop;
      // 16 px list gap; the column's own 32 px fade-out at the bottom does not count as visible.
      const room = stage.clientHeight - headBottom - 16 - 24;
      setFits(room >= rowHeight * .7);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    // The player block above changes height when the film's orientation is known.
    if (section.previousElementSibling) observer.observe(section.previousElementSibling);
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [sectionRef, count]);
  return fits;
}

function DraftCard({ use, canOpen, onOpen }: { use: DraftUse; canOpen: boolean; onOpen: () => void }) {
  const stacked = use.stage !== '第一稿';
  const body = <>
    <Words className="watch-origin__draft-title" text={use.title} />
    <span className="watch-origin__draft-where">
      <span>{use.stage}</span>
      {use.paragraph !== undefined && <span className="watch-origin__position">写进第 <span className="tabular watch-origin__paragraph">{use.paragraph}</span> 段</span>}
    </span>
    <span className="watch-origin__draft-text">
      {use.segments.map((segment, index) => {
        // Serif draft words: 、，；： give back part of their blank half beside the sans quote card (INSP-32).
        if ('text' in segment) return <DraftWords key={index} text={clipText(segment.text)} />;
        // After a full-width 。” the number tucks into the mark's empty half, as superscripts do in the editor. 、，；：
        // are already tucked by DraftWords, so a number after them is not pulled in a second time.
        const previous = use.segments[index - 1];
        const afterPunct = !!previous && 'text' in previous && /[。！？”’」』）》]$/.test(clipText(previous.text));
        return <sup key={index} className={`watch-origin__ref tabular${afterPunct ? ' is-after-punct' : ''}`}>{segment.footnote}</sup>;
      })}
    </span>
  </>;
  return canOpen
    ? <button type="button" className={`watch-origin__draft${stacked ? ' is-stacked' : ''}`} title={`打开文稿：${use.title}`} onClick={onOpen}>{body}</button>
    : <div className={`watch-origin__draft${stacked ? ' is-stacked' : ''}`}>{body}</div>;
}

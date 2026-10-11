import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { InPanel } from './panel';

const WIDTH = 300;
const GAP = 10;
const EDGE = 12;
/** The stamp is inside the card; account for its actual left edge if a future variant protrudes. */
export function placeReferencePopover({ panelLeft, panelRight, centre, width, stampInset }: {
  panelLeft: number; panelRight: number; centre: number; width: number; stampInset: number;
}) {
  const minimum = panelLeft + EDGE - Math.min(0, stampInset);
  const maximum = Math.max(minimum, panelRight - width - EDGE);
  const left = Math.min(Math.max(centre - 28, minimum), maximum);
  return { left, arrow: Math.min(Math.max(centre - left, 14), width - 14) };
}

/**
 * The source card behind a superscript (docked panel and narrow focus writing, §6.18.4 “< 1280”): a white floating
 * card, 300 wide, its arrow pointing at the superscript. It opens below the line and flips above when the panel has
 * no room (§6.21); it closes on Esc, on a press outside, and when the writing area scrolls. Opened from the keyboard
 * (Alt+Enter) it takes focus and gives it back to the editor on Esc.
 */
export function ReferencePopover({ root, anchor, keyboard, onClose, children }: {
  root: HTMLElement | null;
  anchor: HTMLElement;
  keyboard: boolean;
  onClose: (refocusEditor: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; arrow: number; above: boolean } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !root) return;
    const box = root.getBoundingClientRect();
    const target = anchor.getBoundingClientRect();
    const footer = root.querySelector(':scope > .inspector-footer')?.getBoundingClientRect();
    const bottomLimit = (footer ? footer.top : box.bottom) - EDGE;
    const card = element.getBoundingClientRect();
    const stamp = element.querySelector('.tag')?.getBoundingClientRect();
    const height = card.height;
    const centre = target.left + target.width / 2;
    const { left, arrow } = placeReferencePopover({ panelLeft: box.left, panelRight: box.right, centre, width: card.width || WIDTH, stampInset: stamp ? stamp.left - card.left : 0 });
    const below = target.bottom + GAP;
    const above = below + height > bottomLimit && target.top - GAP - height > box.top + 56;
    const top = above ? target.top - GAP - height : below;
    setPlace({ left: left - box.left, top: top - box.top, arrow, above });
  }, [anchor, root]);

  useEffect(() => {
    if (keyboard) ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }, [keyboard, place !== null]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation();
      close.current(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor.contains(target)) return;
      close.current(false);
    };
    const scroller = anchor.closest('.inspector-scroll');
    const onScroll = () => close.current(false);
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      scroller?.removeEventListener('scroll', onScroll);
    };
  }, [anchor]);

  return <InPanel root={root}>
    <div
      ref={ref}
      className={`draft-popover${place?.above ? ' is-above' : ''}`}
      role="dialog"
      aria-label="引用的出处"
      style={place ? { left: `${place.left}px`, top: `${place.top}px`, '--arrow-x': `${place.arrow}px` } as CSSProperties : { visibility: 'hidden' }}
    >{children}</div>
  </InPanel>;
}

import { useLayoutEffect, useRef } from 'react';
import type { CardLod } from './types';

/**
 * Lighttable (§2.4⑦): the jacket and neutral proof sheet are painted on the article root. It lets the pointer through
 * (K7). Only its 8px edge band is a drag surface (CD-B2), so a group can be picked up anywhere on its
 * rim, not only by the label; the inside stays clickable for the cards and the empty canvas.
 *
 * Retain --tab-w for geometry consumers; the v2 paper no longer uses the old edge mask. Read in a deferred rAF,
 * after movement ends, including remounts due to viewport culling. Natural picture metadata is not a layout read.
 */
export function FrameCardBody({ lod, title, count }: { lod: CardLod; title: string; count?: number }) {
  const edge = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tray = edge.current?.closest<HTMLElement>('.field-card');
    const tab = tray?.querySelector<HTMLElement>(':scope > .field-card__surface > .field-card__header');
    if (!tray || !tab) return;
    const flow = tray.closest<HTMLElement>('.flow-container');
    let pending = 0;
    const measure = () => {
      pending = 0;
      if (flow?.classList.contains('is-moving')) return;
      const scale = tray.offsetWidth ? tray.getBoundingClientRect().width / tray.offsetWidth : 1;
      if (!scale) return;
      tray.style.setProperty('--tab-w', `${Math.round((tab.getBoundingClientRect().width / scale) * 100) / 100}px`);
    };
    const schedule = () => { if (!pending) pending = requestAnimationFrame(measure); };
    schedule();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(tab);
    // One class transition, not a continuously changing viewport value.
    const movement = flow && typeof MutationObserver !== 'undefined' ? new MutationObserver(() => {
      if (!flow.classList.contains('is-moving')) schedule();
    }) : undefined;
    movement?.observe(flow!, { attributes: true, attributeFilter: ['class'] });
    document.fonts?.addEventListener('loadingdone', schedule);
    return () => { observer?.disconnect(); movement?.disconnect(); document.fonts?.removeEventListener('loadingdone', schedule); if (pending) cancelAnimationFrame(pending); };
  }, [lod, title, count]);
  return <div ref={edge} className="field-card__tray-edge card-drag-content" aria-hidden="true" />;
}

/** “4 张” after the group name, when App can count the cards wholly inside the tray. */
export function FrameCount({ count }: { count?: number }) {
  if (count === undefined) return null;
  return <span className="field-card__frame-count">{count} 张</span>;
}

/** The group glyph of §9.1: a lighttable with its label tab (14px, icon colour). */
export function TrayGlyph() {
  return (
    <svg className="field-card__frame-glyph" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5.5" width="17" height="14" rx="2" />
      <path d="M3.5 9.5h6" />
    </svg>
  );
}

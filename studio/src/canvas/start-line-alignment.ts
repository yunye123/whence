export interface InkBand { top: number; bottom: number }

/** First-open only: choose nearby whitespace for the desk edge, without hiding a card header. */
export function startLineOffset(ink: readonly InkBand[], desk: InkBand, headroom: number, limit = 24): number {
  const minimum = -Math.max(0, Math.min(limit, headroom));
  const candidates = new Set([0]);
  for (const band of ink) {
    candidates.add(Math.floor(desk.bottom - band.bottom - .5));
    candidates.add(Math.ceil(desk.bottom - band.top + .5));
  }
  const cuts = (offset: number) => ink.filter(band => {
    const top = band.top + offset, bottom = band.bottom + offset;
    return bottom > desk.top && top < desk.bottom
      && (top < desk.top - .5 || bottom > desk.bottom + .5);
  }).length;
  let best = 0, count = cuts(0);
  for (const offset of candidates) {
    if (offset < minimum || offset > limit) continue;
    const next = cuts(offset);
    if (next < count || (next === count && Math.abs(offset) < Math.abs(best))) {
      best = offset; count = next;
    }
  }
  return best;
}

/** A single settled-layout read on first open; never called during panning or zooming. */
export function readStartLineOffset(): number {
  const desk = document.querySelector<HTMLElement>('.react-flow');
  if (!desk) return 0;
  const area = desk.getBoundingClientRect(), styles = new Map<Element, CSSStyleDeclaration>();
  const style = (element: Element) => {
    let value = styles.get(element);
    if (!value) { value = getComputedStyle(element); styles.set(element, value); }
    return value;
  };
  const ink: InkBand[] = [];
  let top = Infinity;
  for (const card of desk.querySelectorAll<HTMLElement>('.field-card')) {
    const box = card.getBoundingClientRect();
    if (box.right <= area.left || box.left >= area.right || box.bottom <= area.top || box.top >= area.bottom) continue;
    top = Math.min(top, box.top);
    const walk = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let text = walk.nextNode(); text; text = walk.nextNode()) {
      if (!text.textContent?.trim()) continue;
      const element = text.parentElement;
      if (!element || element.closest('.sr-only,[aria-hidden="true"]')) continue;
      let clipTop = -Infinity, clipBottom = Infinity, visible = true;
      for (let parent: HTMLElement | null = element; parent && parent !== desk; parent = parent.parentElement) {
        const css = style(parent);
        if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) { visible = false; break; }
        if (/hidden|clip|auto|scroll/.test(css.overflowY)) {
          const bounds = parent.getBoundingClientRect();
          clipTop = Math.max(clipTop, bounds.top); clipBottom = Math.min(clipBottom, bounds.bottom);
        }
      }
      if (!visible) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        if (rect.right <= area.left || rect.left >= area.right) continue;
        const band = { top: Math.max(rect.top, clipTop), bottom: Math.min(rect.bottom, clipBottom) };
        if (band.bottom > band.top) ink.push(band);
      }
    }
  }
  return startLineOffset(ink, area, Math.max(0, top - area.top));
}

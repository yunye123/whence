/** Read at the time of the gesture, so a changed system preference applies immediately. */
export function motionDuration(milliseconds: number): number {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : milliseconds;
}

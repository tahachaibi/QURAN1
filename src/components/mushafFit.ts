/**
 * How big the mushaf text can be on this page — pure, and therefore tested.
 *
 * A page is fifteen fixed lines that must all be visible at once, so the type
 * size is decided by whichever constraint bites first: the widest line against
 * the page width, or fifteen line-heights against the page height.
 *
 * This lives apart from the component because the bug it guards against is
 * arithmetic, not rendering, and rendering is the one thing a jest test of a
 * React Native screen cannot actually do. Words were being clipped off the right
 * edge of dense pages, and the reason was a measurement that came back clamped:
 * a line wider than the page reported the page's own width, so `widest` equalled
 * `boxW`, the scale solved to 1, and nothing was ever shrunk. The measuring pass
 * is laid out somewhere far wider now — and this function is where that fix can
 * be shown to work.
 */

/** Never so small it is unreadable, never so large it is silly. */
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 1.6;

/**
 * A whisker under a perfect fit.
 *
 * Text measurement and text rendering are not the same code path, and a line
 * solved to exactly the page width can still round a hair over it and lose its
 * last letter. Costing 1.5% of type size to never do that is the right trade.
 */
export const SAFETY = 0.985;

export interface FitInput {
  /** natural width of the widest line, measured unconstrained */
  widest: number;
  /** the page box */
  boxW: number;
  boxH: number;
  /** how many lines this page has */
  lines: number;
  /** the unscaled line height */
  lineHeight: number;
}

export function solveScale({ widest, boxW, boxH, lines, lineHeight }: FitInput): number {
  if (boxW <= 0 || boxH <= 0 || lines <= 0 || lineHeight <= 0) return 1;
  const byWidth = widest > 0 ? boxW / widest : MAX_SCALE;
  const byHeight = boxH / (lines * lineHeight);
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(byWidth, byHeight) * SAFETY));
}

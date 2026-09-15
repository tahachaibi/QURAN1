/**
 * How big the mushaf text can be on this page — pure, and therefore tested.
 *
 * A page is fifteen fixed lines that must all be visible at once, so the type
 * size is decided by whichever constraint bites first: the widest line against
 * the page width, or fifteen line-heights against the page height.
 *
 * This lives apart from the component because the bug it guards against is
 * arithmetic, not rendering, and rendering is the one thing a jest test of a
 * React Native screen cannot actually do. Words kept being clipped off the edge
 * of dense pages, through two different causes:
 *
 *  1. A CLAMPED MEASUREMENT. The measuring pass laid each line out inside the
 *     page, so a line wider than the page reported the page's own width back:
 *     `widest` equalled `boxW`, the scale solved to 1, nothing shrank. Fixed by
 *     measuring somewhere far wider than any page.
 *  2. WIDTH THAT DOES NOT SHRINK. A line is not pure type — every word carries
 *     horizontal padding, and every size is rounded to a whole pixel. Scaling
 *     the type by `s` therefore does NOT scale the line by `s`, so a single
 *     extrapolation from one measurement at full size lands over the margin by
 *     the constant part times (1 - s). On a dense page that is a whole word.
 *
 * Hence `probe`: widths come back measured AT a known scale, and the solve is
 * re-applied from there until the measurement it is given actually fits. One
 * step is exact when the line is pure type; the loop is what makes it exact
 * when it is not.
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

/**
 * Ink room at the two margins, in pixels.
 *
 * A justified line puts its first and last word flush against the edges, and an
 * Arabic glyph's ink is wider than its advance — a final ى or a stray ۥ paints
 * past the box the layout gave it, and the page clips it. The type is fitted to
 * the page MINUS this, and the lines are inset by half of it each side, so what
 * is flush is the gutter and not the letters.
 */
export const GUTTER = 8;

/**
 * Room for the measuring pass to lay a line out at its true width.
 *
 * Any number comfortably past the widest possible line on the widest phone. It
 * exists so a long line is never measured against the page it has to be shrunk
 * to fit — which is precisely how the first half of the clipping bug worked.
 */
export const MEASURE_WIDTH = 4000;

/** How many times the fit may be re-measured before the smallest wins. */
export const MAX_REFINEMENTS = 4;

export interface FitInput {
  /** natural width of the widest line, measured unconstrained at `probe` */
  widest: number;
  /** the page box */
  boxW: number;
  boxH: number;
  /** how many lines this page has */
  lines: number;
  /** the unscaled line height */
  lineHeight: number;
  /** the scale `widest` was measured at — 1 on the first pass */
  probe?: number;
}

/** The width the type may actually occupy, once the margins are kept clear. */
export function usableWidth(boxW: number): number {
  return Math.max(0, boxW - GUTTER);
}

/** Does a line of this width sit inside the page, margins included? */
export function fitsWidth(widest: number, boxW: number): boolean {
  return widest <= usableWidth(boxW);
}

export function solveScale({ widest, boxW, boxH, lines, lineHeight, probe = 1 }: FitInput): number {
  if (boxW <= 0 || boxH <= 0 || lines <= 0 || lineHeight <= 0) return 1;
  if (probe <= 0) return 1;
  // `widest` was measured at `probe`, so the width ratio is relative to it.
  // Height is not measured at all — it is fifteen line-heights of our own
  // arithmetic — so that term is absolute.
  const byWidth = widest > 0 ? (usableWidth(boxW) / widest) * probe : MAX_SCALE;
  const byHeight = boxH / (lines * lineHeight);
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(byWidth, byHeight) * SAFETY));
}

/** The whole-pixel type size a scale actually renders at. */
export function pxFont(base: number, scale: number): number {
  return Math.max(8, Math.round(base * scale));
}

/** The whole-pixel line height a scale actually renders at. */
export function pxLine(base: number, scale: number): number {
  return Math.max(12, Math.round(base * scale));
}

export interface RefineInput extends FitInput {
  /** the UNSCALED type size, so candidates can be compared in whole pixels */
  fontSize: number;
  /** how many times this page has already been re-measured */
  refinements?: number;
  /** true on the very first measurement, when nothing has been probed yet */
  first?: boolean;
}

/** Settle on a scale, or ask for another measurement at a different one. */
export type FitStep = { done: true; scale: number } | { done: false; probe: number };

/**
 * One round of the fit.
 *
 * The caller measures the page at `probe` and hands the widest line back here.
 * This is the part the previous fix could not see: the arithmetic was right and
 * the measurement was honest, yet the page still clipped, because a prediction
 * from one measurement at full size is not the same as a measurement at the
 * size actually used. So the answer is only accepted once the width it was
 * derived from is the width on screen.
 */
export function refine({
  widest,
  boxW,
  boxH,
  lines,
  lineHeight,
  fontSize,
  probe = 1,
  refinements = 0,
  first = false,
}: RefineInput): FitStep {
  if (boxW <= 0 || boxH <= 0 || lines <= 0 || lineHeight <= 0 || fontSize <= 0 || probe <= 0) {
    return { done: true, scale: 1 };
  }

  const next = solveScale({ widest, boxW, boxH, lines, lineHeight, probe });
  const currentFont = pxFont(fontSize, probe);
  const nextFont = pxFont(fontSize, next);
  const fits = fitsWidth(widest, boxW) && lines * pxLine(lineHeight, probe) <= boxH;

  if (!fits) {
    if (refinements >= MAX_REFINEMENTS || nextFont === currentFont) {
      // Out of rounds, or the arithmetic has stopped moving the type size while
      // the line still hangs over the margin. Take the smallest candidate, and
      // force a whole step down rather than accept a size already measured not
      // to fit.
      return { done: true, scale: Math.min(probe, next, (currentFont - 1) / fontSize) };
    }
    // Re-measure smaller. The type size always changes here, which matters more
    // than it looks: a probe that rounded to the same size would produce no
    // layout change, hence no layout event, and a page stuck in its (invisible)
    // measuring pass forever.
    return { done: false, probe: next };
  }

  // It fits. Grow only from the first measurement, and only by a whole pixel of
  // type: a sparse page should fill its page rather than sit at the default
  // size, but chasing the last pixel in either direction only oscillates
  // between two sizes that both very nearly fit.
  if (first && nextFont > currentFont) return { done: false, probe: next };
  return { done: true, scale: probe };
}

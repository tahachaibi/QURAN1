/**
 * The page fit, and the clipping bug it exists to prevent.
 *
 * Words kept running off the edge of dense pages, through two causes with the
 * same symptom. The first was a clamped measurement: the measuring pass laid
 * each line out INSIDE the page, so a line wider than the page reported the
 * page's own width, `widest` came back equal to `boxW`, and nothing shrank.
 *
 * The second survived that fix and is the one these tests are mostly about. A
 * line is not pure type: every word carries horizontal padding and every size
 * is rounded to a whole pixel, so scaling the type by `s` does NOT scale the
 * line by `s`. One extrapolation from a single measurement at full size
 * therefore lands OVER the margin by the non-scaling part times (1 - s) — on a
 * dense page, about a word's worth. `refine` is the answer: measure at the size
 * being considered, and only accept a size once the width it came from is the
 * width on screen.
 */
import {
  GUTTER,
  MAX_REFINEMENTS,
  MAX_SCALE,
  MIN_SCALE,
  SAFETY,
  fitsWidth,
  pxFont,
  pxLine,
  refine,
  solveScale,
  usableWidth,
} from '../src/components/mushafFit';

/** A phone-shaped page: 360 wide, 600 tall, 15 lines at 40px, type at 22px. */
const page = { boxW: 360, boxH: 600, lines: 15, lineHeight: 40 };
const usable = usableWidth(page.boxW);

describe('solveScale', () => {
  it('shrinks a page whose widest line is wider than the page', () => {
    // this is the case that was being clipped
    const scale = solveScale({ ...page, widest: 500 });
    expect(scale).toBeCloseTo((usable / 500) * SAFETY, 5);
    expect(scale).toBeLessThan(1);
    // and the line now fits, with the margins kept clear
    expect(fitsWidth(500 * scale, page.boxW)).toBe(true);
  });

  it('is bound by height when the lines are short but many', () => {
    // 15 x 40 = 600 exactly, so height binds before width
    const scale = solveScale({ ...page, widest: 100 });
    expect(scale).toBeCloseTo((600 / 600) * SAFETY, 5);
  });

  it('takes whichever constraint bites first', () => {
    const tall = solveScale({ ...page, boxH: 300, widest: 100 });
    const wide = solveScale({ ...page, widest: usable * 2 });
    expect(tall).toBeCloseTo(0.5 * SAFETY, 5);
    expect(wide).toBeCloseTo(0.5 * SAFETY, 5);
  });

  it('keeps the margins clear rather than fitting edge to edge', () => {
    // a justified line puts its first and last word flush against the edges,
    // and Arabic ink is wider than its advance: fitting exactly still clips
    const scale = solveScale({ ...page, widest: page.boxW });
    expect(page.boxW * scale).toBeLessThanOrEqual(usable);
    expect(usable).toBe(page.boxW - GUTTER);
  });

  /**
   * The first regression, stated as arithmetic.
   *
   * A clamped measurement and an honest one differ, and the clamped one is the
   * one that does nothing. If these two ever agree again, the measuring pass has
   * been put back inside the page.
   */
  it('does nothing when handed a clamped measurement, and shrinks when handed a true one', () => {
    const clamped = solveScale({ ...page, widest: 360 }); // what the bug reported
    const honest = solveScale({ ...page, widest: 470 }); // what the line really was
    expect(clamped).toBeGreaterThan(0.95);
    expect(honest).toBeLessThan(0.8);
    expect(470 * clamped).toBeGreaterThan(page.boxW); // still overflowing: the bug
    expect(fitsWidth(470 * honest, page.boxW)).toBe(true); // fits: the fix
  });

  it('reads a measurement as belonging to the size it was measured at', () => {
    // 300 measured at half size is a 600-wide line at full size, and must be
    // treated as such — this is what makes a second round mean anything
    const half = solveScale({ ...page, widest: 300, probe: 0.5 });
    const full = solveScale({ ...page, widest: 600, probe: 1 });
    expect(half).toBeCloseTo(full, 5);
  });

  it('clamps to sane bounds', () => {
    expect(solveScale({ ...page, widest: 100000 })).toBe(MIN_SCALE);
    expect(solveScale({ ...page, boxH: 100000, widest: 1 })).toBe(MAX_SCALE);
  });

  it('returns 1 rather than nonsense before anything has been measured', () => {
    expect(solveScale({ ...page, boxW: 0, widest: 0 })).toBe(1);
    expect(solveScale({ ...page, boxH: 0, widest: 100 })).toBe(1);
    expect(solveScale({ ...page, lines: 0, widest: 100 })).toBe(1);
    expect(solveScale({ ...page, widest: 100, probe: 0 })).toBe(1);
  });

  it('treats an unmeasured width as no width constraint, not as zero', () => {
    // widest 0 must not divide by zero into an infinite scale; it stands in as
    // "width does not bind", and the safety margin still applies on top
    const scale = solveScale({ ...page, boxH: 100000, widest: 0 });
    expect(scale).toBeCloseTo(MAX_SCALE * SAFETY, 5);
    expect(scale).toBeLessThanOrEqual(MAX_SCALE);
  });
});

/**
 * A page whose line is NOT pure type.
 *
 * `text` scales with the type; `fixed` does not — word padding as it used to be
 * (4px either side of every word), whole-pixel rounding, glyph ink past the
 * advance. This is the model that exposes the bug the second fix is about.
 */
const line = (text: number, fixed: number) => (scale: number) =>
  (text * pxFont(22, scale)) / 22 + fixed;

/** Drive the real loop to completion, the way the component drives it. */
function settle(measure: (scale: number) => number) {
  let probe = 1;
  let first = true;
  for (let i = 0; i <= MAX_REFINEMENTS + 1; i++) {
    const step = refine({
      ...page,
      fontSize: 22,
      widest: measure(probe),
      probe,
      first,
      refinements: i,
    });
    if (step.done) return { scale: step.scale, rounds: i + 1 };
    probe = step.probe;
    first = false;
  }
  throw new Error('the fit never settled');
}

describe('refine', () => {
  it('fits a dense page that a single extrapolation leaves overflowing', () => {
    // 10 words of 8px padding on a 470-wide line: 80px that does not shrink
    const measure = line(390, 80);
    expect(measure(1)).toBe(470);

    // One shot from full size, as it was before the margins existed: the line
    // renders ~20px over the page edge, which on this page is a whole word.
    const asShipped = (page.boxW / measure(1)) * SAFETY;
    expect(measure(asShipped) - page.boxW).toBeGreaterThan(20);

    // The margins hide most of that, and still don't fix it: the line renders
    // past the edge, never mind the gutter it was supposed to leave clear.
    const oneShot = solveScale({ ...page, widest: measure(1) });
    expect(fitsWidth(measure(oneShot), page.boxW)).toBe(false);
    expect(measure(oneShot)).toBeGreaterThan(page.boxW);

    // what the loop settles on: a size measured to fit, margins included
    const { scale, rounds } = settle(measure);
    expect(fitsWidth(measure(scale), page.boxW)).toBe(true);
    expect(scale).toBeLessThan(oneShot);
    expect(rounds).toBeLessThanOrEqual(MAX_REFINEMENTS + 1);
  });

  it('accepts a size that already fits without another round', () => {
    const step = refine({ ...page, fontSize: 22, widest: usable, probe: 0.8 });
    expect(step).toEqual({ done: true, scale: 0.8 });
  });

  it('asks for a smaller measurement when the line hangs over', () => {
    const step = refine({ ...page, fontSize: 22, widest: 470, probe: 1 });
    expect(step.done).toBe(false);
    if (!step.done) {
      expect(step.probe).toBeLessThan(1);
      expect(pxFont(22, step.probe)).toBeLessThan(pxFont(22, 1));
    }
  });

  it('grows a sparse page once, from the first measurement only', () => {
    // a short-lined page should fill its page rather than sit at the default
    const grow = refine({ ...page, boxH: 2000, fontSize: 22, widest: 200, probe: 1, first: true });
    expect(grow.done).toBe(false);
    if (!grow.done) expect(grow.probe).toBeGreaterThan(1);

    // but not again, once something has been probed: two sizes that both very
    // nearly fit would otherwise be chased forever
    const settled = refine({ ...page, boxH: 2000, fontSize: 22, widest: 200, probe: 1.2, first: false });
    expect(settled).toEqual({ done: true, scale: 1.2 });
  });

  it('settles on a whole step smaller when the arithmetic stops moving', () => {
    // over the margin by a hair: the solve rounds to the same type size, so
    // accepting it would accept a size already measured not to fit
    const step = refine({ ...page, fontSize: 22, widest: usable + 1, probe: 1 });
    expect(step.done).toBe(true);
    if (step.done) {
      expect(pxFont(22, step.scale)).toBeLessThan(pxFont(22, 1));
    }
  });

  it('gives up at the smallest readable size rather than looping on the impossible', () => {
    const { scale, rounds } = settle(line(100000, 400));
    expect(scale).toBe(MIN_SCALE);
    expect(rounds).toBeLessThanOrEqual(MAX_REFINEMENTS + 1);
  });

  it('never accepts a size taller than the page', () => {
    // height is our own arithmetic, so it is checked at the rendered value
    const { scale } = settle(line(100, 0));
    expect(page.lines * pxLine(page.lineHeight, scale)).toBeLessThanOrEqual(page.boxH);
  });

  it('refuses to answer before the page has a size', () => {
    expect(refine({ ...page, boxW: 0, fontSize: 22, widest: 0 })).toEqual({ done: true, scale: 1 });
    expect(refine({ ...page, fontSize: 0, widest: 100 })).toEqual({ done: true, scale: 1 });
  });
});

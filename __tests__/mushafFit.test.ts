/**
 * The page fit, and the clipping bug it exists to prevent.
 *
 * Words were running off the right edge of dense pages. The cause was not this
 * arithmetic but its input: the measuring pass laid each line out INSIDE the
 * page, so a line wider than the page reported the page's own width. `widest`
 * came back equal to `boxW`, the scale solved to 1, nothing shrank, and the
 * surplus was clipped. The measuring pass is unconstrained now; these tests pin
 * what the arithmetic must do with an honest measurement.
 */
import { MAX_SCALE, MIN_SCALE, SAFETY, solveScale } from '../src/components/mushafFit';

/** A phone-shaped page: 360 wide, 600 tall, 15 lines at 40px. */
const page = { boxW: 360, boxH: 600, lines: 15, lineHeight: 40 };

describe('solveScale', () => {
  it('shrinks a page whose widest line is wider than the page', () => {
    // this is the case that was being clipped
    const scale = solveScale({ ...page, widest: 500 });
    expect(scale).toBeCloseTo((360 / 500) * SAFETY, 5);
    expect(scale).toBeLessThan(1);
    // and the line now fits, with room to spare
    expect(500 * scale).toBeLessThan(360);
  });

  it('is bound by height when the lines are short but many', () => {
    // 15 x 40 = 600 exactly, so height binds before width
    const scale = solveScale({ ...page, widest: 100 });
    expect(scale).toBeCloseTo((600 / 600) * SAFETY, 5);
  });

  it('takes whichever constraint bites first', () => {
    const tall = solveScale({ ...page, boxH: 300, widest: 100 });
    const wide = solveScale({ ...page, widest: 720 });
    expect(tall).toBeCloseTo(0.5 * SAFETY, 5);
    expect(wide).toBeCloseTo(0.5 * SAFETY, 5);
  });

  it('never returns exactly a perfect fit', () => {
    // measurement and rendering are different code paths; a line solved to
    // exactly the page width can round a hair over and lose its last letter
    const scale = solveScale({ ...page, widest: 360 });
    expect(scale).toBeLessThan(1);
    expect(360 * scale).toBeLessThan(360);
  });

  /**
   * The regression itself, stated as arithmetic.
   *
   * A clamped measurement and an honest one differ, and the clamped one is the
   * one that does nothing. If these two ever agree again, the measuring pass has
   * been put back inside the page.
   */
  it('does nothing when handed a clamped measurement, and shrinks when handed a true one', () => {
    const clamped = solveScale({ ...page, widest: 360 }); // what the bug reported
    const honest = solveScale({ ...page, widest: 470 }); // what the line really was
    expect(clamped).toBeGreaterThan(0.97);
    expect(honest).toBeLessThan(0.8);
    expect(470 * clamped).toBeGreaterThan(360); // still overflowing: the bug
    expect(470 * honest).toBeLessThan(360); // fits: the fix
  });

  it('clamps to sane bounds', () => {
    expect(solveScale({ ...page, widest: 100000 })).toBe(MIN_SCALE);
    expect(solveScale({ ...page, boxH: 100000, widest: 1 })).toBe(MAX_SCALE);
  });

  it('returns 1 rather than nonsense before anything has been measured', () => {
    expect(solveScale({ ...page, boxW: 0, widest: 0 })).toBe(1);
    expect(solveScale({ ...page, boxH: 0, widest: 100 })).toBe(1);
    expect(solveScale({ ...page, lines: 0, widest: 100 })).toBe(1);
  });

  it('treats an unmeasured width as no width constraint, not as zero', () => {
    // widest 0 must not divide by zero into an infinite scale; it stands in as
    // "width does not bind", and the safety margin still applies on top
    const scale = solveScale({ ...page, boxH: 100000, widest: 0 });
    expect(scale).toBeCloseTo(MAX_SCALE * SAFETY, 5);
    expect(scale).toBeLessThanOrEqual(MAX_SCALE);
  });
});

/**
 * Nothing that is on screen most of the time may be drawn over the mushaf.
 *
 * THE REGRESSION, reported from a real phone with a screenshot: the heard-text
 * line and the "I read page N — add it" chip both lived in the surah screen's
 * `floating` overlay, which is `position: 'absolute'` over the page — and both
 * covered its last line. The heard text is there for the whole of a recitation
 * and the chip is there whenever the microphone is off, so between them the
 * bottom line of every page was hidden nearly all the time.
 *
 * And the heard text showed in the LISTEN view too. The chips were wrapped in
 * `tab === 'read'` with a comment saying recitation notices belong to the Read
 * view — but the heard line sat just outside that guard, so it rendered over
 * the reciter card in Listen and garbled its label.
 *
 * jest performs no layout, so "does not overlap" cannot be measured by
 * rendering. That is the same blind spot the page-clipping bug slipped through.
 * What CAN be pinned is structure: what is inside the absolute overlay, and
 * what is not. This walks the JSX and checks exactly that.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', 'app', 'surah', '[id].tsx'), 'utf8');

/** The text of the <View> element whose style starts with `styleRef`, tags balanced. */
function viewBlock(styleRef: string): string {
  const at = source.indexOf(styleRef);
  if (at < 0) throw new Error(`${styleRef} not found in the surah screen`);
  const open = source.lastIndexOf('<View', at);
  const tag = /<\/?View\b[^>]*?(\/?)>/g;
  tag.lastIndex = open;
  let depth = 0;
  for (let m = tag.exec(source); m !== null; m = tag.exec(source)) {
    const closing = m[0].startsWith('</');
    const selfClosing = m[1] === '/';
    if (closing) depth--;
    else if (!selfClosing) depth++;
    if (depth === 0) return source.slice(open, m.index + m[0].length);
  }
  throw new Error(`unbalanced <View> around ${styleRef}`);
}

/**
 * Looked up inside each test rather than at load. Doing it at the top of the
 * file meant that a screen with no status strip made the lookup THROW while
 * the module loaded, so jest registered zero tests and reported "0 total" —
 * technically a failure, but one that reads as "nothing ran" and names none of
 * the properties that broke.
 */
const floatingBlock = (): string => viewBlock('styles.floating');
const stripBlock = (): string => {
  if (!source.includes('styles.statusStrip')) return '';
  return viewBlock('styles.statusStrip');
};

describe('the page is not covered by anything that stays on screen', () => {
  it('keeps the "I read page" action out of the absolute overlay', () => {
    const floating = floatingBlock();
    const strip = stripBlock();
    expect(floating).not.toMatch(/I read/);
    expect(floating).not.toMatch(/onSelfReport/);
    expect(strip).toMatch(/onSelfReport/);
  });

  it('keeps the collapsed heard line out of the absolute overlay', () => {
    const floating = floatingBlock();
    const strip = stripBlock();
    // The only HeardPill left floating must be the expanded one, opened on
    // purpose by tapping the line below — covering the page is what the user
    // asked for at that moment.
    const pills = floating.match(/<HeardPill[\s\S]*?\/>/g) ?? [];
    for (const pill of pills) expect(pill).toMatch(/\bexpanded\b(?!=\{false\})/);
    expect(floating).toMatch(/transcriptOpen \?/);
    expect(strip).toMatch(/<HeardPill[\s\S]*?expanded=\{false\}/);
  });

  it('shows the heard line in the Read view only, never in Listen', () => {
    const floating = floatingBlock();
    expect(source).toContain('styles.statusStrip');
    // The strip itself is behind the guard...
    const before = source.slice(0, source.indexOf('styles.statusStrip'));
    expect(before.slice(before.lastIndexOf('{tab ===')).startsWith("{tab === 'read'")).toBe(true);
    // ...and so is the expanded one that floats.
    expect(floating).toMatch(/tab === 'read' && transcriptOpen/);
  });

  it('gives the strip a FIXED height, so starting to recite cannot re-fit the page', () => {
    // A strip that only appeared while reciting would change the box the page
    // is fitted to every time the microphone started or stopped, and the type
    // size with it.
    expect(source).toMatch(/const STATUS_STRIP_HEIGHT = \d+;/);
    expect(source).toMatch(/statusStrip: \{[\s\S]*?height: STATUS_STRIP_HEIGHT/);
    // rendered unconditionally in Read, not only while listening
    expect(stripBlock()).toMatch(/\{listening \?/);
  });

  it('lifts the transient overlay clear of the strip rather than onto it', () => {
    expect(source).toMatch(/styles\.floating, \{ bottom: bottomPad \+ 96 \+ \(tab === 'read' \? STATUS_STRIP_HEIGHT : 0\) \}/);
  });
});

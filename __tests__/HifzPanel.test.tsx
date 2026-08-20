/**
 * Render tests for the revision panel.
 *
 * The panel does real arithmetic (due queues, strength, pattern advice) and has
 * four distinct states — nothing tracked, nothing due, things due, and a profile
 * dominated by recognizer noise. Each one is a different tree, so each one gets
 * rendered.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { HifzPanel } from '../src/components/HifzPanel';
import { buildProfile, type MistakeRecord } from '../src/engine/confusion';
import { applyEvidence, newCard, type AyahEvidence, type HifzDeck } from '../src/engine/hifz';
import { darkPalette, lightPalette } from '../src/theme/theme';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

const evidence = (ayah: number, over: Partial<AyahEvidence> = {}): AyahEvidence => ({
  ayah,
  totalWords: 10,
  recitedWords: 10,
  missedWords: 0,
  hintedWords: 0,
  revealedWords: 0,
  ...over,
});

function render(
  props: Partial<Parameters<typeof HifzPanel>[0]> = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <HifzPanel
        deck={{}}
        profile={buildProfile([])}
        palette={lightPalette}
        now={T0}
        onPractise={() => undefined}
        onOpenAyah={() => undefined}
        {...props}
      />,
    );
  });
  return tree;
}

const text = (tree: ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n !== null && typeof n === 'object' && 'children' in n) {
      walk((n as { children: unknown }).children);
    }
  };
  walk(tree.toJSON());
  return out.join(' ');
};

describe('HifzPanel', () => {
  it('invites you in when nothing is tracked yet', () => {
    const tree = render();
    expect(text(tree)).toContain('becomes your revision plan');
    tree.unmount();
  });

  it('says nothing is due when nothing is due', () => {
    const deck = applyEvidence({}, [evidence(0)], T0).deck;
    const tree = render({ deck, now: T0 });
    expect(text(tree)).toContain('Nothing due');
    tree.unmount();
  });

  it('offers a revision run when ayahs are due, and lists the weakest first', () => {
    let deck: HifzDeck = {};
    deck = applyEvidence(deck, [evidence(0)], T0).deck;
    deck = applyEvidence(deck, [evidence(1, { missedWords: 6, recitedWords: 4 })], T0).deck;
    const tree = render({ deck, now: T0 + 40 * DAY });
    const rendered = text(tree);
    // the text collector joins interpolated segments with spaces
    expect(rendered).toMatch(/Revise\s+\d+\s+due/);
    expect(rendered).toContain('Weakest first');
    tree.unmount();
  });

  it('hands the practice range as WORD indices, not ayah indices', () => {
    const deck = applyEvidence({}, [evidence(0), evidence(1)], T0).deck;
    const calls: [number, number][] = [];
    const tree = render({
      deck,
      now: T0 + 40 * DAY,
      onPractise: (from, to) => calls.push([from, to]),
    });
    // find the CTA and press it
    const pressables = tree.root.findAll(
      (n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel?.startsWith('Revise'),
    );
    expect(pressables.length).toBeGreaterThan(0);
    act(() => {
      pressables[0].props.onPress();
    });
    expect(calls).toHaveLength(1);
    const [from, to] = calls[0];
    // Al-Fatiha 1:1 is words 0..3, 1:2 is 4..7 — a run of ayahs 0..1 is 0..7
    expect(from).toBe(0);
    expect(to).toBe(7);
    tree.unmount();
  });

  it('surfaces a repeated confusion pattern with advice', () => {
    const records: MistakeRecord[] = [
      { word: 28, expected: 'الضالين', heardInstead: 'الظالين' },
      { word: 100, expected: 'يضل', heardInstead: 'يظل' },
      { word: 200, expected: 'الضحى', heardInstead: 'الظحى' },
    ];
    const deck = applyEvidence({}, [evidence(0)], T0).deck;
    const tree = render({ deck, profile: buildProfile(records), now: T0 + 2 * DAY });
    const rendered = text(tree);
    expect(rendered).toContain('What keeps tripping you');
    expect(rendered).toContain('likely the recognizer');
    tree.unmount();
  });

  it('tells you when the profile is mostly recognizer noise, not your recitation', () => {
    const records: MistakeRecord[] = [
      { word: 1, expected: 'الضالين', heardInstead: 'الظالين' },
      { word: 2, expected: 'يضل', heardInstead: 'يظل' },
      { word: 3, expected: 'الضحى', heardInstead: 'الظحى' },
      { word: 4, expected: 'الصراط', heardInstead: 'السراط' },
      { word: 5, expected: 'صبر', heardInstead: 'سبر' },
      { word: 6, expected: 'صدق', heardInstead: 'سدق' },
    ];
    const deck = applyEvidence({}, [evidence(0)], T0).deck;
    const tree = render({ deck, profile: buildProfile(records), now: T0 + 2 * DAY });
    expect(text(tree)).toContain('routinely confuses');
    tree.unmount();
  });

  it('renders in the night palette', () => {
    const deck = applyEvidence({}, [evidence(0, { missedWords: 4, recitedWords: 6 })], T0).deck;
    const tree = render({ deck, palette: darkPalette, now: T0 + 5 * DAY });
    expect(tree.toJSON()).not.toBeNull();
    tree.unmount();
  });

  it('never renders a card that has no reviews', () => {
    const deck: HifzDeck = { '5': newCard(5, T0) };
    const tree = render({ deck, now: T0 + 10 * DAY });
    expect(text(tree)).toContain('becomes your revision plan');
    tree.unmount();
  });
});

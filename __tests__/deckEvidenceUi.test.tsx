/**
 * An empty revision panel has to be legible, and a panel full of taps has to
 * admit it.
 *
 * THE REGRESSION: the empty state was a paragraph of encouragement — "recite an
 * ayah or two" — with nothing to press, shown to people who in many cases
 * cannot take that advice at all: no Arabic speech pack on the phone, reading
 * silently, sitting somewhere they will not speak into a phone. For them the
 * whole coach layer was a blank screen with a suggestion in it.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { HifzPanel } from '../src/components/HifzPanel';
import { buildProfile } from '../src/engine/confusion';
import {
  applyEvidence,
  applySelfReport,
  type AyahEvidence,
  type HifzDeck,
} from '../src/engine/hifz';
import { lightPalette } from '../src/theme/theme';

const T0 = 1_700_000_000_000;

const recited = (ayah: number): AyahEvidence => ({
  ayah,
  totalWords: 10,
  recitedWords: 10,
  missedWords: 0,
  hintedWords: 0,
  revealedWords: 0,
});

function render(props: Partial<Parameters<typeof HifzPanel>[0]> = {}): ReactTestRenderer {
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

const pressButton = (tree: ReactTestRenderer, label: string): void => {
  const hits = tree.root.findAll(
    (n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label,
  );
  // findAll returns the Pressable and its host view, so one button is two hits
  expect(hits.length).toBeGreaterThan(0);
  act(() => {
    hits[0].props.onPress();
  });
};

describe('an empty revision deck', () => {
  it('explains the way in that does not need a microphone', () => {
    const tree = render();
    const rendered = text(tree);
    expect(rendered).toMatch(/do not have to recite out loud/i);
    expect(rendered).toMatch(/speech pack/i);
    tree.unmount();
  });

  it('offers the action, not just the advice', () => {
    const pressed: string[] = [];
    const tree = render({
      selfReport: { label: 'I read page 3 — add it', onPress: () => pressed.push('yes') },
    });
    expect(text(tree)).toContain('I read page 3 — add it');
    pressButton(tree, 'I read page 3 — add it');
    expect(pressed).toEqual(['yes']);
    tree.unmount();
  });

  it('still renders when there is no reading position to offer yet', () => {
    // first run, nothing read, nothing recited: the panel must not render a
    // button labelled with a page nobody has been on
    const tree = render({ selfReport: null });
    expect(text(tree)).toContain('becomes your revision plan');
    expect(
      tree.root.findAll((n) => typeof n.props.onPress === 'function'),
    ).toHaveLength(0);
    tree.unmount();
  });
});

describe('a deck that was partly filled by hand', () => {
  it('says how much of it nothing has actually heard', () => {
    let deck: HifzDeck = applySelfReport({}, [10, 11], 'read', T0).deck;
    deck = applyEvidence(deck, [recited(12)], T0).deck;
    const tree = render({ deck, now: T0 });
    // the text collector joins interpolated segments with spaces
    expect(text(tree)).toMatch(/2\s+of these you added by hand/);
    tree.unmount();
  });

  it('says nothing of the sort when every ayah has been recited', () => {
    const deck = applyEvidence({}, [recited(1), recited(2)], T0).deck;
    const tree = render({ deck, now: T0 });
    expect(text(tree)).not.toMatch(/added by hand/);
    tree.unmount();
  });

  it('keeps offering the by-hand door once the deck is no longer empty', () => {
    // somebody who reads silently does not stop reading silently the moment
    // their first card exists
    const deck = applySelfReport({}, [10], 'read', T0).deck;
    const pressed: string[] = [];
    const tree = render({
      deck,
      now: T0,
      selfReport: { label: 'I read page 4 — add it', onPress: () => pressed.push('yes') },
    });
    pressButton(tree, 'I read page 4 — add it');
    expect(pressed).toEqual(['yes']);
    tree.unmount();
  });
});

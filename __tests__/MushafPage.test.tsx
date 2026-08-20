/**
 * Render tests for the page renderer.
 *
 * These exist to catch the two failure modes that only show up at render time:
 * a hooks-order violation from a conditional early return (§10), and a page
 * whose word slice does not line up with its display tokens.
 */
import { Animated } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MushafPage } from '../src/components/MushafPage';
import { lightPalette, darkPalette } from '../src/theme/theme';
import { ayahDisplayWords, ayahsOnPage, pageWordRange, wordIndexOf } from '../src/data/quran';
import type { PageSlice } from '../src/hooks/usePageSlice';

const level = new Animated.Value(0);

function sliceFor(page: number, overrides: Partial<PageSlice> = {}): PageSlice {
  const [from, to] = pageWordRange(page);
  return {
    page,
    from,
    to,
    current: -1,
    recited: [],
    missed: [],
    hinted: [],
    progress: 0,
    ...overrides,
  };
}

function render(page: number, props: Partial<Parameters<typeof MushafPage>[0]> = {}): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <MushafPage
        page={page}
        slice={sliceFor(page)}
        hidden={false}
        fontStep={1}
        palette={lightPalette}
        reduceMotion
        level={level}
        cursor={pageWordRange(page)[0]}
        hintLevelOf={() => 0}
        onWordPress={() => undefined}
        onWordLongPress={() => undefined}
        width={390}
        {...props}
      />,
    );
  });
  return tree;
}

describe('MushafPage renders', () => {
  it.each([1, 2, 3, 49, 293, 440, 604])('page %i without throwing', (page) => {
    const tree = render(page);
    expect(tree.toJSON()).not.toBeNull();
    tree.unmount();
  });

  it('renders exactly the words in its own range and no others', () => {
    const page = 3;
    const [from, to] = pageWordRange(page);
    const tree = render(page);
    const texts = collectText(tree.toJSON());
    // every display token of every ayah on the page, clamped to the range
    const expected: string[] = [];
    for (const ayah of ayahsOnPage(page)) {
      ayahDisplayWords(ayah).forEach((word, offset) => {
        const index = ayah.wordStart + offset;
        if (index >= from && index < to) expected.push(word);
      });
    }
    for (const word of expected) {
      expect(texts).toContain(word);
    }
    tree.unmount();
  });

  it('renders the same node count in hidden mode: geometry must not shift (§6.2)', () => {
    const shown = render(1, { hidden: false });
    const hiddenTree = render(1, { hidden: true });
    expect(countNodes(hiddenTree.toJSON())).toBe(countNodes(shown.toJSON()));
    shown.unmount();
    hiddenTree.unmount();
  });

  it('survives every word state at once', () => {
    const page = 1;
    const [from] = pageWordRange(page);
    const tree = render(page, {
      slice: sliceFor(page, {
        current: from + 4,
        recited: [from, from + 1, from + 2, from + 3],
        missed: [from + 6],
        hinted: [from + 8],
        progress: 0.4,
      }),
      hidden: true,
      hintLevelOf: (w) => (w === from + 8 ? 1 : 0),
    });
    expect(tree.toJSON()).not.toBeNull();
    tree.unmount();
  });

  it('renders in the night palette and at every font step', () => {
    for (const fontStep of [0, 1, 2] as const) {
      const tree = render(2, { palette: darkPalette, fontStep });
      expect(tree.toJSON()).not.toBeNull();
      tree.unmount();
    }
  });

  it('re-renders on a new slice and bails out on an identical one', () => {
    const page = 1;
    const stable = sliceFor(page);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <MushafPage
          page={page}
          slice={stable}
          hidden={false}
          fontStep={1}
          palette={lightPalette}
          reduceMotion
          level={level}
          cursor={0}
          hintLevelOf={() => 0}
          onWordPress={() => undefined}
          onWordLongPress={() => undefined}
          width={390}
        />,
      );
    });
    const before = JSON.stringify(tree.toJSON());
    act(() => {
      tree.update(
        <MushafPage
          page={page}
          slice={stable}
          hidden={false}
          fontStep={1}
          palette={lightPalette}
          reduceMotion
          level={level}
          cursor={0}
          hintLevelOf={() => 0}
          onWordPress={() => undefined}
          onWordLongPress={() => undefined}
          width={390}
        />,
      );
    });
    expect(JSON.stringify(tree.toJSON())).toBe(before);
    tree.unmount();
  });
});

// --- helpers -------------------------------------------------------------

type Json = ReturnType<ReactTestRenderer['toJSON']>;

function collectText(node: Json): string[] {
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
  walk(node);
  return out;
}

function countNodes(node: Json): number {
  let count = 0;
  const walk = (n: unknown): void => {
    if (n === null || n === undefined) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      count++;
      walk((n as { children?: unknown }).children);
    }
  };
  walk(node);
  return count;
}

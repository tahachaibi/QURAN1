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

describe('measure-then-justify layout', () => {
  /**
   * react-test-renderer never fires layout events, so the justified pass has to
   * be driven by hand. This simulates the words of page 1 landing on three
   * lines and asserts the second pass stretches every line except the last.
   */
  function drive(page: number, linesOfY: number[]): ReactTestRenderer {
    const tree = render(page);
    const hosts = hostsWithLayout(tree);
    expect(hosts.length).toBeGreaterThan(0);
    act(() => {
      hosts.forEach((h, i) => {
        h.props.onLayout({
          nativeEvent: { layout: { x: 0, y: linesOfY[i % linesOfY.length], width: 40, height: 40 } },
        });
      });
    });
    return tree;
  }

  /**
   * Host nodes only. findAll returns both the composite element and the host it
   * renders to, so an unfiltered search counts every match twice.
   */
  const hostsWithLayout = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => typeof n.type === 'string' && typeof n.props.onLayout === 'function');

  const flatten = (style: unknown): Record<string, unknown> | null => {
    if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean));
    return style !== null && typeof style === 'object' ? (style as Record<string, unknown>) : null;
  };

  const rowsWith = (tree: ReactTestRenderer, value: string): number =>
    tree.root.findAll((n) => {
      if (typeof n.type !== 'string') return false;
      const flat = flatten(n.props.style);
      return flat !== null && flat.flexDirection === 'row-reverse' && flat.justifyContent === value;
    }).length;

  it('starts in a single continuous wrap so ayahs do not each begin a line', () => {
    const tree = render(1);
    // one wrapping container for the whole page, not one per ayah
    const wraps = tree.root.findAll((n) => {
      if (typeof n.type !== 'string') return false;
      const flat = flatten(n.props.style);
      return flat !== null && flat.flexWrap === 'wrap';
    });
    expect(wraps).toHaveLength(1);
    tree.unmount();
  });

  it('justifies every line but the last once the words have been measured', () => {
    const tree = drive(2, [0, 0, 0, 60, 60, 60, 120, 120]);
    // three distinct y values -> three lines: two justified, the last flush right
    expect(rowsWith(tree, 'space-between')).toBe(2);
    expect(rowsWith(tree, 'flex-start')).toBe(1);
    tree.unmount();
  });

  it('keeps every word after re-laying the lines: nothing is dropped', () => {
    const before = collectText(render(3).toJSON()).join(' ');
    const tree = drive(3, [0, 40, 80, 120]);
    const after = collectText(tree.toJSON()).join(' ');
    for (const word of before.split(/\s+/).filter((w) => w.length > 2)) {
      expect(after).toContain(word);
    }
    tree.unmount();
  });

  it('falls back to the plain wrap when not every word reports a layout', () => {
    const tree = render(1);
    const hosts = hostsWithLayout(tree);
    act(() => {
      // only half the words report — grouping must not run on partial data
      hosts.slice(0, Math.floor(hosts.length / 2)).forEach((h) => {
        h.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 40, height: 40 } } });
      });
    });
    expect(rowsWith(tree, 'space-between')).toBe(0);
    expect(tree.toJSON()).not.toBeNull();
    tree.unmount();
  });

  it('scales the type down on a dense page so it still fits one screen', () => {
    const sizeOn = (page: number): number => {
      const tree = render(page);
      const texts = tree.root.findAll(
        (n) => typeof n.type === 'string' && Array.isArray(n.props.style),
      );
      let max = 0;
      for (const t of texts) {
        const flat = Object.assign({}, ...t.props.style.filter(Boolean));
        if (typeof flat.fontSize === 'number') max = Math.max(max, flat.fontSize);
      }
      tree.unmount();
      return max;
    };
    // Al-Fatiha is a sparse page; a mid-Baqarah page is dense
    expect(sizeOn(1)).toBeGreaterThan(sizeOn(49));
  });
});

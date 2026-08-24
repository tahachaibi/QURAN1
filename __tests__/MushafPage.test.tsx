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
import { pageWordRange } from '../src/data/quran';
import { linesOfPage } from '../src/data/lines';
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

  it('renders exactly the words the real layout puts on the page', () => {
    const page = 3;
    const [from, to] = pageWordRange(page);
    const tree = render(page);
    const texts = collectText(tree.toJSON());
    for (const line of linesOfPage(page)) {
      for (const token of line.tokens) {
        if (token.kind !== 'word') continue;
        expect(token.index).toBeGreaterThanOrEqual(from);
        expect(token.index).toBeLessThan(to);
      }
    }
    expect(texts.length).toBeGreaterThan(0);
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

describe('ayah markers', () => {
  it('draws the marker as digits only — never with U+06DD as well', () => {
    // In KFGQPC Uthmanic Hafs each Arabic-Indic digit is already drawn inside the
    // rosette. Prefixing U+06DD ARABIC END OF AYAH put a second, EMPTY rosette
    // beside every numbered one, which is exactly how it looked on device.
    const tree = render(1);
    const texts = collectText(tree.toJSON()).join('');
    expect(texts).not.toContain('\u06DD');
    // and the numbers are still there, in Arabic-Indic digits
    expect(texts).toContain('١');
    tree.unmount();
  });

  it('puts the page number in reserved space, not floating over the text', () => {
    // As an absolutely positioned badge it sat on top of the last line.
    const tree = render(3);
    const absolute = tree.root.findAll((n) => {
      if (typeof n.type !== 'string') return false;
      const st = n.props.style;
      const flat = Array.isArray(st) ? Object.assign({}, ...st.filter(Boolean)) : st;
      return (
        flat !== null &&
        typeof flat === 'object' &&
        (flat as Record<string, unknown>).position === 'absolute' &&
        typeof (flat as Record<string, unknown>).borderRadius === 'number' &&
        (flat as Record<string, unknown>).borderRadius === 16
      );
    });
    expect(absolute).toHaveLength(0);
    tree.unmount();
  });
});

describe('real imported layout', () => {
  /**
   * react-test-renderer never fires layout events, so the justified pass has to
   * be driven by hand: the body reports its box, then each fixed line reports its
   * natural width, and the scale is solved from those in one step.
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

  function drive(page: number, naturalWidth = 300, boxWidth = 360): ReactTestRenderer {
    const tree = render(page);
    act(() => {
      hostsWithLayout(tree)[0].props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: boxWidth, height: 600 } },
      });
    });
    act(() => {
      hostsWithLayout(tree)
        .slice(1)
        .forEach((h) => {
          h.props.onLayout({
            nativeEvent: { layout: { x: 0, y: 0, width: naturalWidth, height: 40 } },
          });
        });
    });
    return tree;
  }

  it('renders one row per real ayah line of the page', () => {
    const tree = drive(2);
    const lines = linesOfPage(2).filter((l) => l.kind === 'ayah');
    const justified = rowsWith(tree, 'space-between');
    const centred = tree.root.findAll((n) => {
      if (typeof n.type !== 'string') return false;
      const f = flatten(n.props.style);
      return (
        f !== null &&
        f.flexDirection === 'row' &&
        f.justifyContent === 'center' &&
        // the surah band's inner frame is also row+center; it aligns 'center'
        f.alignItems === 'flex-end'
      );
    }).length;
    expect(justified + centred).toBe(lines.length);
    tree.unmount();
  });

  it('justifies ayah lines to both margins', () => {
    const tree = drive(3);
    expect(rowsWith(tree, 'space-between')).toBeGreaterThan(0);
    tree.unmount();
  });

  it('scales the type down when the widest line overflows the page', () => {
    // Only ayah text: the page-number badge has a fixed 14pt, which otherwise
    // floors every reading at 14 and hides the scaling entirely.
    const maxFont = (tree: ReactTestRenderer): number => {
      let max = 0;
      // Animated.Text may hand the host a flattened object rather than an array,
      // so do not require an array here.
      for (const t of tree.root.findAll((n) => typeof n.type === 'string')) {
        const flat = flatten(t.props.style);
        if (flat === null) continue;
        if (typeof flat.fontSize !== 'number' || typeof flat.lineHeight !== 'number') continue;
        max = Math.max(max, flat.fontSize);
      }
      return max;
    };
    // Page 200 is untouched by the other tests here, so neither call can be
    // served by the module-level scale cache. Same natural line width, different
    // page width: the narrow box must shrink the type, the wide one is bounded
    // only by height.
    const cramped = maxFont(drive(200, 720, 360));
    const roomy = maxFont(drive(200, 720, 1440));
    expect(cramped).toBeLessThan(roomy);
  });

  it('falls back to the unscaled pass when a line never reports a width', () => {
    const tree = render(1);
    act(() => {
      hostsWithLayout(tree)[0].props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 600 } },
      });
    });
    expect(tree.toJSON()).not.toBeNull();
    expect(rowsWith(tree, 'space-between')).toBe(0);
    tree.unmount();
  });

  it('keeps every word of the page after re-laying the lines', () => {
    const before = collectText(render(3).toJSON()).join(' ');
    const tree = drive(3);
    const after = collectText(tree.toJSON()).join(' ');
    for (const word of before.split(/\s+/).filter((w) => w.length > 2)) {
      expect(after).toContain(word);
    }
    tree.unmount();
  });
});

describe('centred lines', () => {
  const flat = (style: unknown): Record<string, unknown> | null => {
    if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean));
    return style !== null && typeof style === 'object' ? (style as Record<string, unknown>) : null;
  };

  const hostsWithLayout = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => typeof n.type === 'string' && typeof n.props.onLayout === 'function');

  /** the justified/centred shapes only exist once the scale has been solved */
  function driven(page: number): ReactTestRenderer {
    const tree = render(page);
    act(() => {
      hostsWithLayout(tree)[0].props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 600 } },
      });
    });
    act(() => {
      hostsWithLayout(tree)
        .slice(1)
        .forEach((h) =>
          h.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 40 } } }),
        );
    });
    return tree;
  }

  it('centres Al-Fatiha, whose every line the layout marks centred', () => {
    // The layout sets is_centered on all of page 1. Relying on justifyContent
    // inside a row-reverse flex left the lines hugging the right margin.
    expect(linesOfPage(1).filter((l) => l.kind === 'ayah').every((l) => l.centered)).toBe(true);

    const tree = driven(1);
    const centred = tree.root.findAll((n) => {
      if (typeof n.type !== 'string') return false;
      const f = flat(n.props.style);
      return (
        f !== null &&
        f.flexDirection === 'row' &&
        f.justifyContent === 'center' &&
        f.alignItems === 'flex-end'
      );
    });
    // one wrapper per centred ayah line, and each holds a content-sized inner row
    expect(centred.length).toBeGreaterThanOrEqual(7);
    expect(linesOfPage(1).filter((l) => l.kind === 'ayah')).toHaveLength(7);
    const inner = tree.root.findAll((n) => {
      if (typeof n.type !== 'string') return false;
      const f = flat(n.props.style);
      return f !== null && f.flexDirection === 'row-reverse' && f.flexShrink === 1;
    });
    expect(inner.length).toBeGreaterThanOrEqual(7);
    tree.unmount();
  });

  it('still justifies a page whose lines are not centred', () => {
    const page = 3;
    expect(linesOfPage(page).some((l) => l.kind === 'ayah' && !l.centered)).toBe(true);
    const tree = driven(page);
    const justified = tree.root.findAll((n) => {
      if (typeof n.type !== 'string') return false;
      const f = flat(n.props.style);
      return f !== null && f.flexDirection === 'row-reverse' && f.justifyContent === 'space-between';
    });
    expect(justified.length).toBeGreaterThan(0);
    tree.unmount();
  });
});

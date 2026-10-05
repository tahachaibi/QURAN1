/**
 * What the summary card promises: when the weakest ayah comes back, and
 * whether there is anything to practise at all.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SummaryCard } from '../src/components/SummaryCard';
import type { SessionSummary } from '../src/context/RecitationProvider';
import { globalAyahOf, wordIndexOf } from '../src/data/quran';
import { lightPalette } from '../src/theme/theme';

const ayah = (surah: number, n: number): number => globalAyahOf(wordIndexOf(surah, n));

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    wordsRecited: 30,
    versesCovered: 3,
    accuracy: 0.95,
    longestCleanRun: 20,
    hintedWords: [],
    mistakes: [],
    durationMs: 90_000,
    furthestWord: wordIndexOf(2, 6),
    surah: 2,
    previousFurthest: null,
    graded: [],
    dueNow: 0,
    autoLogged: false,
    ...overrides,
  };
}

function render(s: SessionSummary): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <SummaryCard
        summary={s}
        palette={lightPalette}
        onClose={() => undefined}
        onLog={() => undefined}
        onPractise={() => undefined}
        onExport={() => undefined}
        onAddByHand={() => undefined}
      />,
    );
  });
  return tree;
}

const textOf = (tree: ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n !== null && typeof n === 'object' && 'children' in n) walk((n as { children: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join('');
};

const practiseButtons = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (n) =>
      typeof n.type === 'string' &&
      n.props.accessibilityLabel === 'Practice the weakest ayah from this session',
  );

describe('the weakest ayah', () => {
  it('comes back tomorrow only when it failed', () => {
    const failed = render(
      summary({ graded: [{ ayah: ayah(2, 3), grade: 4 }, { ayah: ayah(2, 4), grade: 2 }] }),
    );
    expect(textOf(failed)).toContain('weakest 2:4 — it comes back tomorrow');
    failed.unmount();
  });

  it('makes no promise about tomorrow for an ayah that passed', () => {
    // a pass goes three or more days out once an ayah has been reviewed before
    const passed = render(summary({ graded: [{ ayah: ayah(2, 3), grade: 5 }, { ayah: ayah(2, 4), grade: 4 }] }));
    const text = textOf(passed);
    expect(text).toContain('weakest 2:4');
    expect(text).not.toContain('tomorrow');
    passed.unmount();
  });
});

describe('the practise button', () => {
  it('is not offered when there is nothing to practise', () => {
    const tree = render(summary({ wordsRecited: 0, graded: [], hintedWords: [] }));
    expect(practiseButtons(tree)).toHaveLength(0);
    tree.unmount();
  });

  it('is offered for a graded ayah, and for hinted words alone', () => {
    const graded = render(summary({ graded: [{ ayah: ayah(2, 3), grade: 3 }] }));
    expect(practiseButtons(graded).length).toBeGreaterThan(0);
    expect(textOf(graded)).toContain('Practice 2:3');
    graded.unmount();

    const hinted = render(summary({ hintedWords: [wordIndexOf(2, 5)] }));
    expect(practiseButtons(hinted).length).toBeGreaterThan(0);
    expect(textOf(hinted)).toContain('Practice shaky words');
    hinted.unmount();
  });
});

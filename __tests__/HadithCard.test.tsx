/**
 * The hadith card.
 *
 * The promise is "Arabic, with its English translation underneath" — so the test
 * that matters is that both are actually rendered, in that order, with the
 * citable number.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { HadithCard } from '../src/components/HadithCard';
import { hadithsOfChapter } from '../src/data/hadith';
import { darkPalette, lightPalette } from '../src/theme/theme';

const collect = (node: unknown): string[] => {
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
};

function render(index = 0, showSource = false): ReactTestRenderer {
  const hadith = hadithsOfChapter(1, 1)[index];
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <HadithCard hadith={hadith} palette={lightPalette} fontStep={1} showSource={showSource} />,
    );
  });
  return tree;
}

describe('HadithCard', () => {
  it('renders the Arabic and the English beneath it, in that order', () => {
    const hadith = hadithsOfChapter(1, 1)[0];
    const tree = render(0);
    const texts = collect(tree.toJSON());
    const arabicAt = texts.findIndex((t) => t === hadith.arabic);
    const englishAt = texts.findIndex((t) => t === hadith.english);
    expect(arabicAt).toBeGreaterThanOrEqual(0);
    expect(englishAt).toBeGreaterThan(arabicAt);
    tree.unmount();
  });

  it('shows the number it can be cited by', () => {
    const tree = render(0);
    expect(collect(tree.toJSON())).toContain('1');
    tree.unmount();
  });

  it('names the collection only when asked, for cross-collection results', () => {
    expect(collect(render(0, true).toJSON()).join(' ')).toContain('Sahih al-Bukhari');
    expect(collect(render(0, false).toJSON()).join(' ')).not.toContain('Sahih al-Bukhari');
  });

  it('sets the Arabic in Amiri, not the Quran face', () => {
    // KFGQPC Uthmanic Script is the mushaf's typeface; a narration set in it
    // would read as revelation.
    const tree = render(0);
    const fonts = tree.root
      .findAll((n) => typeof n.type === 'string')
      .map((n) => {
        const st = n.props.style;
        const flat = Array.isArray(st) ? Object.assign({}, ...st.filter(Boolean)) : st;
        return flat !== null && typeof flat === 'object'
          ? (flat as Record<string, unknown>).fontFamily
          : undefined;
      })
      .filter((f): f is string => typeof f === 'string');
    expect(fonts).toContain('Amiri_400Regular');
    expect(fonts).not.toContain('KFGQPC-Hafs');
    tree.unmount();
  });

  it('renders in the night palette, and without a narrator', () => {
    const hadith = { ...hadithsOfChapter(1, 1)[0], narrator: '' };
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<HadithCard hadith={hadith} palette={darkPalette} fontStep={2} />);
    });
    expect(tree.toJSON()).not.toBeNull();
    tree.unmount();
  });
});

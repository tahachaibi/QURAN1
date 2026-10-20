/**
 * Text on the green cards (next prayer, streak, adhan banner) must be
 * readable in both themes. A screenshot from a phone in the dark theme showed
 * the prayer countdown at 1.2:1 and the prayer name at 2.0:1 against the light
 * green there; WCAG AA asks 4.5:1 for text this size.
 */
import { darkPalette, lightPalette, type Palette } from '../src/theme/theme';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each<[string, Palette]>([
  ['light', lightPalette],
  ['dark', darkPalette],
])('%s theme, text on primary', (_name, palette) => {
  it.each(['onPrimary', 'onPrimaryAccent', 'accentSoft', 'paper'] as const)('%s is at least 4.5:1', (token) => {
    expect(contrast(palette[token], palette.primary)).toBeGreaterThanOrEqual(4.5);
  });
});

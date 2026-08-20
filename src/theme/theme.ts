/**
 * The visual system (spec §7).
 *
 * Two palettes, one shape. Nothing in the app hard-codes a colour: night mushaf
 * is warm dark paper, not pure black, and the sacred text is never red — a
 * missed word is marked by a small dot beneath it instead.
 */
export interface Palette {
  primary: string;
  primaryLight: string;
  accent: string;
  accentSoft: string;
  background: string;
  paper: string;
  paperEdge: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  error: string;
  errorSoft: string;
  success: string;
  successSoft: string;
  /** ink at full strength for ayah text */
  ink: string;
  /** paper gradient endpoints */
  paperTop: string;
  paperBottom: string;
  overlay: string;
}

export const lightPalette: Palette = {
  primary: '#1B4332',
  primaryLight: '#2D6A4F',
  accent: '#C9A227',
  accentSoft: '#F3E7C3',
  background: '#F6F2E9',
  paper: '#FBF7EC',
  paperEdge: '#E7DDC8',
  surface: '#FFFFFF',
  text: '#20241F',
  textMuted: '#6F6B60',
  border: '#E5E0D3',
  error: '#B3261E',
  errorSoft: '#F9E2E0',
  success: '#2D6A4F',
  successSoft: '#E4EFE7',
  ink: '#20241F',
  paperTop: '#FDFAF2',
  paperBottom: '#F6EFE0',
  overlay: 'rgba(32, 36, 31, 0.45)',
};

/** Warm dark paper. Pure black makes Quranic text look like a terminal. */
export const darkPalette: Palette = {
  primary: '#74C69D',
  primaryLight: '#95D5B2',
  accent: '#E6C560',
  accentSoft: '#3A331F',
  background: '#14170F',
  paper: '#1C1F16',
  paperEdge: '#2B3021',
  surface: '#222619',
  text: '#F0EADB',
  textMuted: '#A39C8B',
  border: '#333828',
  error: '#F2B8B5',
  errorSoft: '#3B1F1D',
  success: '#95D5B2',
  successSoft: '#1E2C22',
  ink: '#F2ECDD',
  paperTop: '#20241A',
  paperBottom: '#181B12',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

/** 8pt grid (§7). */
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

/** Motion: fast and small. No springs on text (§7). */
export const duration = {
  reveal: 120,
  transition: 200,
  slow: 320,
} as const;

export const fonts = {
  quran: 'AmiriQuran_400Regular',
  arabic: 'Amiri_400Regular',
  arabicBold: 'Amiri_700Bold',
} as const;

/** Three ayah text sizes (§6.7). Line height >= 2.0 for Arabic (§7). */
export const ayahTextSizes = [
  { fontSize: 24, lineHeight: 52 },
  { fontSize: 29, lineHeight: 62 },
  { fontSize: 34, lineHeight: 74 },
] as const;

export type FontStep = 0 | 1 | 2;

/** Word-state ink opacities (§6.3). */
export const inkOpacity = {
  upcoming: 0.45,
  current: 1,
  recited: 1,
  missed: 1,
  /** a ghost of the glyph's own shape, so page geometry never shifts (§6.2) */
  hidden: 0.09,
  hintFirstLetter: 1,
} as const;

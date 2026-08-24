# Fonts

## Ayah text: KFGQPC Uthmanic Script HAFS

`src/assets/fonts/UthmanicHafs.otf` — the typeface the printed mushaf is actually
set in, from the King Fahd Glorious Quran Printing Complex. 246 KB, one file,
normal Unicode text.

**Licence.** The agreement is embedded in the font's own name table (id 13) and
is unambiguous:

> Copyright (c) 2010 by King Fahd Glorious Quran Printing Complex (KFGQPC) …
> Permission is hereby granted, **Free of Cost**, to any person obtaining a copy
> of this Font accompanying this license, the rights to **Use, Copy, Distribute**,
> subject to the following conditions:
> 1. The Font Software cannot be **Sold, Modified, Altered, Translated, Reverse
>    Engineered, Decompiled, Disassembled, Reproduced** or Attempted to discover
>    the Source Code of this Font in no means.

Two consequences the build honours:

- It is bundled **whole and unmodified**. Subsetting it — the obvious way to save
  bytes — would be "Modified" and is therefore not done, however tempting.
- The licence travels with it, inside the font file itself, which satisfies
  "accompanying this license".

Source: <http://fonts.qurancomplex.gov.sa>, mirrored at `nuqayah/qpc-fonts`
(`various/UthmanicHafs1 Ver09.otf`).

`scripts/verify-fonts.mjs` asserts, on every CI run, that it covers all 73
codepoints the bundled text uses, that it carries no colour tables, and that it
has U+06DD plus the Arabic-Indic digits the ayah marker is drawn with.

## Why not the per-page QPC glyph fonts

Tarteel renders QPC V2 — 604 page-specific fonts where each word is a
pre-positioned glyph, so justification is baked into the typeface and the page is
pixel-identical to print. That is the ideal, and it is not bundleable:

Each font holds only ~164 glyphs, yet weighs ~300 KB, because every glyph is a
whole word of calligraphy drawn as detailed outlines. Subsetting barely helps
(302 KB → 275 KB on page 262 — and would breach the licence anyway). Sampled
across the mushaf the mean is 365 KB, so the full set is **≈ 210 MB**.

The remaining route is fetching a page's font on demand and caching it, falling
back to Uthmanic Hafs for pages not yet cached. That trades the app's
offline-first guarantee for the last few percent of fidelity, so it is a decision
to take deliberately rather than by default.

## Other faces

- **Amiri / Amiri Bold** — Arabic UI that is not Quran text: surah names in the
  band, the heard pill, the mistake sheet's heard-word line.
- **System sans** — all Latin UI.

Amiri Quran is deliberately **not** used. It has no glyph for U+065E, which the
bundled text uses 1,807 times across 1,241 ayahs, and the copy shipped by
`@expo-google-fonts/amiri-quran` is the *Coloured* variant, which paints the
tashkeel red and destroys red as the missed-word signal (§6.3).

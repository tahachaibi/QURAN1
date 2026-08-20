# Getting true 15-line mushaf pages

The data I need exists and is structured. I just cannot reach it: this
environment's egress proxy blocks `qul.tarteel.ai` by `curl` and by web fetch
alike. Five minutes of your time unblocks it permanently.

---

## What to download

1. Go to **https://qul.tarteel.ai** and sign up (free).
2. Find **Mushaf Layouts**.
3. Pick a **15-line Madani** layout — either is fine:
   - *Mushaf Al-Madinah V1* (1405 print)
   - *KFQPC V2* (1421H) — the more common modern digital layout
4. **Read the licence / attribution on that resource's page** and copy the text.
   QUL resources are mostly community-contributed and vary: some public domain,
   some under a specific licence. Their FAQ tells you to check per resource, so
   this step is the one that actually matters.
5. **Export it.** SQLite is their primary export and is what I'd prefer; JSON is
   fine too.

## STATUS: one more export needed

You sent `qpcv215lines.db` — QCF V2 (1421H print), 604 pages, 15 lines, 9,046
line records. It is structurally perfect and it agrees with every printed-mushaf
fact this repo already asserts. Run `node --experimental-sqlite
scripts/analyse-mushaf-layout.mjs` to see the whole analysis.

What it established:

- The id space tiles exactly, no gaps, no overlaps.
- QUL's pagination agrees with mine on **579 of 604** pages, and on **all 10**
  hand-checked printed-mushaf facts (2:6 on p3, 36:1 on p440, 114:1 on p604 …).
  So both describe the same print.
- It found a real bug in MY data: quran-json writes 2:72's فَٱدَّٰرَٰٔتُمۡ as two
  space-separated pieces, so the word array had 77,429 words where the mushaf has
  77,428, and the matcher expected two spoken words where there is one. Fixed by
  fusing any token that begins with a combining mark, since no Arabic word can.
- After that fix, the mapping is **exact and verified for pages 1–262** — 3,954
  lines cross-checked against ayah-marker positions.

What still blocks the import: **four words**, where QUL splits a word that
quran-json joins. Each is localised to one page:

| Surah | Page | Ayahs on that page |
|---|---|---|
| 15 | 262 | 15:1–15:15 |
| 27 | 378 | 27:14–27:22 |
| 36 | 441 | 36:13–36:27 |
| 41 | 482 | 41:47–41:54 |

The lines export gives id *ranges* only, so it cannot tell me which word inside
those pages is split — and guessing would shift every later word onto the wrong
line for the rest of each surah.

**So: please export the same layout WORD BY WORD.** On QUL that is the
per-word/`mushaf_words` export for QCF V2 15-lines — the one with a `text` column
alongside `word_id`, `page_number`, `line_number`, `position_in_line`. With the
text I can align it against my words and resolve all four exactly, then verify
the whole mapping end to end.

If you would rather not wait: I can import what I have with per-page anchoring,
which is exact for 575 pages and possibly one word out of place on 29 of them. I
would flag those pages rather than hide them. Say the word — but one more
download is the better answer for a Quran app.

## What to send me

- the exported file (SQLite or JSON)
- the licence / attribution text from the resource page
- which layout you picked (V1 or V2)

## What I will do with it

The schema is already known — I read it from QUL's own source
(`app/models/mushaf_word.rb`, `mushaf_page.rb`, `mushaf_line_alignment.rb`):

| Table | Fields I use |
|---|---|
| `mushaf_words` | `word_id`, `page_number`, `line_number`, `position_in_page`, `position_in_line`, `char_type_name` |
| `mushaf_pages` | `page_number`, `lines_count` |
| `mushaf_line_alignments` | `page_number`, `line_number`, `alignment` (centred lines: surah bands, basmala) |

`scripts/gen-mushaf-lines.mjs` will turn that into a compact
`src/assets/quran-lines.json` (per-word line number, delta-encoded — expect
~100 KB), and the renderer switches from computing its own line breaks to using
the real ones. The paper card, per-word states, mistake dots, hint ladder and
taps all stay exactly as they are; only where each line breaks changes.

The source export stays out of the repo. Only the generated asset and the
generator are committed, the same as the existing Quran data, with the licence
recorded in the README.

## What I will verify before trusting it

The load-bearing risk is word alignment. QUL's `word_id` is a global 1-based
index over their `words` table; mine is a 0-based index over my own 77,428-word
array. If the two tokenise identically, `mine = word_id - 1` — and if they do
not, pages would silently render the wrong words on the wrong lines, which is
worse than approximate line breaks.

So the generator will fail the build unless all of these hold:

1. exactly 604 pages, every one non-empty;
2. each page's distinct line count equals its `lines_count`;
3. every one of my 77,428 words is assigned a page and line exactly once;
4. the page each word lands on matches the page my own verified table already
   gives it (scripts/verify-pages.mjs checks that table against a printed
   mushaf, so a disagreement means the word mapping is off, not the pages);
5. per-ayah word counts agree between QUL and my array, which localises any
   tokenisation mismatch to the exact ayah rather than leaving it as a vague
   offset.

If (4) or (5) fails I will tell you the mismatch rather than shipping pages that
look right and are not.

## The other route, for reference

Tarteel's own pages are pixel-identical to print because they do not justify
text at all: they render pre-positioned **glyphs** from page-specific QPC fonts,
so line breaks live in the typeface. `Mushaf#using_glyphs?`, `font_code`,
`use_images?` and `use_svg?` in their model are exactly that.

It is the better-looking end state, needs the same layout export plus the QPC
font set, and costs APK size. Worth doing after the line data is in and
verified — not instead of it.

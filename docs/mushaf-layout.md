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
index over their `words` table; mine is a 0-based index over my own 77,429-word
array. If the two tokenise identically, `mine = word_id - 1` — and if they do
not, pages would silently render the wrong words on the wrong lines, which is
worse than approximate line breaks.

So the generator will fail the build unless all of these hold:

1. exactly 604 pages, every one non-empty;
2. each page's distinct line count equals its `lines_count`;
3. every one of my 77,429 words is assigned a page and line exactly once;
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

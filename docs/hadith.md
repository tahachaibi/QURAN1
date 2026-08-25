# Hadith

## What is included, and why only this

**Sahih al-Bukhari (7,276) and Sahih Muslim (7,458)** — 14,734 hadith, Arabic with
the English translation underneath each one.

The brief was hadith that are authentic. These two are the collections the
scholarly tradition accepts as authentic essentially in their entirety, so
restricting to them answers that **without this app grading a single narration**.
That distinction matters: the other books of the six — Abu Dawud, Tirmidhi,
Nasa'i, Ibn Majah — carry sahih, hasan and da'if side by side, and separating them
is a scholar's work, not a program's. Nothing here rests on a judgement I am not
qualified to make.

Every hadith shows its collection and its number in that collection, so any of it
can be checked against a printed copy.

## Regenerating

The raw dataset is not committed — only the generated assets are.

```bash
mkdir -p hadith-source
for b in bukhari muslim; do
  curl -L -o "hadith-source/$b.json" \
    "https://raw.githubusercontent.com/AhmedBaset/hadith-json/v1.2.0/db/by_book/the_9_books/$b.json"
done
node scripts/gen-hadith.mjs hadith-source/bukhari.json hadith-source/muslim.json
```

Pin the tag. The dataset's own README warns that the format may change on `main`.

Source: [AhmedBaset/hadith-json](https://github.com/AhmedBaset/hadith-json),
scraped from [sunnah.com](https://sunnah.com/). **The repository carries no
licence file.** The Arabic is classical text and not anyone's to license; the
English translations are a different question, and if this app is ever
distributed beyond your own phone that question needs an answer. It is the same
open point as the mushaf layout, recorded in docs/mushaf-layout.md.

## How it is loaded

Splitting the data was the whole design problem: 21.8 MB cannot sit at the top of
a module.

| File | Size | When |
|---|---|---|
| `hadith-index.json` | 11 KB | imported eagerly — collections, book names, counts |
| `hadith-1.json` | 11.5 MB | `require`d when Bukhari is opened |
| `hadith-2.json` | 10.3 MB | `require`d when Muslim is opened |

Metro runs a module's factory on first `require`, so the two text files cost
nothing until someone opens that collection. `release()` drops one again, because
holding both at once is 22 MB of strings. The lazy-loading claim is asserted in
`__tests__/hadith.test.ts` rather than assumed: it checks that describing the
collections loads no text at all.

## Typography

Hadith Arabic is set in **Amiri**, deliberately not in KFGQPC Uthmanic Script.
That face is the mushaf's, and setting a narration in it would dress it as
revelation. A render test enforces it.

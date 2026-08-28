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

## The morning and evening adhkar

The adhkar screen (`app/adhkar.tsx`, reached from the top of the Hadith tab) has
one hard rule: **not one Arabic character on it is typed by this app.** Every
du'a is a verbatim slice of a hadith already bundled here, and every Qur'an
passage is read from the bundled mushaf text at display time. Sacred text written
from memory is how a du'a app teaches a du'a nobody said, and no amount of care
while typing prevents that — only refusing to type it does.

The mechanism is in `scripts/gen-adhkar.mjs`. Both translations wrap the Prophet's
words in double quotes, so the odd-indexed parts of `text.split('"')` are the
quoted spans. An entry names a hadith, which of its spans to take, and optionally
a folded anchor for where inside the span the du'a starts and ends; the isnad,
the "he who says this shall…" clause and the surrounding narrative are dropped by
construction rather than by judgement. A missing anchor is a hard error, because a
silently un-trimmed du'a would fold the reward clause into the du'a itself.

`npm run gen` regenerates it and CI fails if the output differs from what is
committed, so the file can never drift from the corpus it was cut out of.
`__tests__/adhkar.test.ts` then asserts, at runtime, that every line still appears
character for character inside the narration it cites, that the cited hadith
exists with that text, that no chain of narration leaked in, and that the Qur'an
lines equal `ayahAt()` exactly.

### What is in it

| | Source | Times |
|---|---|---|
| Ayat al-Kursi, al-Ikhlas, al-Falaq, an-Nas | Qur'an 2:255, 112, 113, 114 | 1, 3, 3, 3 |
| Sayyid al-istighfar | Bukhari 6069 | 1 |
| لا إله إلا الله وحده… | Muslim 6677 | 100 |
| أعوذ بكلمات الله التامات | Muslim 6711 | 3 |
| اللهم لك أسلمت… | Muslim 6731 | 1 |
| اللهم إني أعوذ بك من الهم والحزن | Bukhari 6126 | 1 |
| سبحان الله وبحمده عدد خلقه (morning) | Muslim 6745 | 3 |
| أصبحنا وأصبح الملك لله (morning) | Muslim 6740 | 1 |
| أمسينا وأمسى الملك لله (evening) | Muslim 6740 | 1 |

### The supplied list

The screen now serves the adhkar the user supplied from islambook.com — 15 in the
morning, 13 in the evening — because www.islambook.com cannot be reached from this
build machine (the egress proxy answers 403 to CONNECT for that host, an
organisation policy denial), so the text was handed over as a paste rather than
fetched.

`data/adhkar-supplied.txt` holds that paste verbatim and is committed. Keeping the
input and not only the output is the point: what is on screen can be diffed
against what was actually given, and `__tests__/adhkar.test.ts` asserts exactly
that — every line on screen appears character for character in that file.

`scripts/gen-adhkar-text.mjs` splits, classifies and copies. It makes three
classifications, each mechanical, each logged so it can be checked:

**The count** comes off the title line ("— 3 مرات"), and a bare restatement of it
further down ("4 مرات.") is dropped as redundant. The first version of that check
used `\b`, which is an ASCII word boundary and never matches after an Arabic
letter, so every restatement leaked into the notes.

**Dhikr versus commentary** is decided by *diacritic density*. The supplied du'a
text is fully vowelled — اللَّهُمَّ أَنْتَ رَبِّي — and the explanatory sentences
around it are not — ويمكنك الإكثار منها. Counting harakat per letter separates
them at a threshold of 0.15 without anybody deciding which Arabic sentence is
scripture, which is not a judgement a script should be making.

**Qur'an passages are dropped** by title and read from the bundled mushaf instead.
The supplied Ayat al-Kursi is truncated with an ellipsis, and an app that ships a
partial ayah where a whole one belongs is worse than one that reads it from the
text it already has.

Where a supplied du'a's wording matches a narration already bundled here, the
citation is carried across, so a card can say "Sahih Muslim 6740" rather than only
naming a website. The agreement is measured **both ways** — shared words over all
words. A one-directional measure got this wrong on the first run: "أصبحنا وأصبح
الملك لله" contains the whole of Muslim 6677 as a fragment, scored 100%, and was
about to be labelled with the wrong hadith. Every short du'a is a perfect match
for a long one that quotes it. Three citations survive the symmetric test at 0.7;
the rest name the page and claim nothing more.

### What is deliberately missing, and why

This app bundles only Bukhari and Muslim. Several of the best-known morning and
evening adhkar are narrated in Abu Dawud, at-Tirmidhi, an-Nasa'i and Ibn Majah
instead, and they are **absent rather than approximated**:

- بسم الله الذي لا يضر مع اسمه شيء
- رضيت بالله ربا وبالإسلام دينا وبمحمد نبيا
- اللهم بك أصبحنا وبك أمسينا
- اللهم عافني في بدني، اللهم عافني في سمعي
- أصبحت على فطرة الإسلام
- اللهم إني أسألك علما نافعا
- the instruction to read al-Ikhlas and the two mu'awwidhat three times morning
  and evening — which is why those four passages are cited by surah and ayah only,
  with the screen saying plainly that the narration prescribing them is not one
  the app can show you

Adding them needs a licensed, graded dataset of the four Sunan with Arabic and
English. That is a data decision, not a code one: point me at a source with a
licence and they go in the same generator, under the same verbatim rule.

### Two typefaces on one screen

Qur'an passages are set in KFGQPC Uthmanic Script; du'as in Amiri. The screen puts
revelation and narration side by side, so the distinction the rest of the app
makes by tab has to be made here by typeface.

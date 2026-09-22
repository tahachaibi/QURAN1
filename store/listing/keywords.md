# Keywords — and what I cannot tell you about them

## The uncertainty, stated plainly

**I have not verified a single search volume, and I cannot from here.** There is
no keyword tool in this environment, Google Play Console's own search-terms
report only exists for an app that is already published, and third-party ASO
estimates for Play are modelled, not measured. Every keyword below is chosen from
how this audience talks about the practice, not from a number.

Anyone who hands you a table with "quran memorization app — 40,500/mo" for Play
is quoting a Google **web** search estimate or an invented one. Play search
behaves differently: shorter queries, far more brand and transliteration
queries, and heavy locale skew.

**The only real data arrives after launch.** Play Console → Acquisition → Search
terms (needs traffic first). Treat the list below as the hypothesis, and replace
it with that report as soon as it is populated — ideally at 30 and 90 days.

## The hypothesis, ranked by how confident I am

### Tier 1 — the app's actual identity
These describe the one thing no competitor listing owns in plain words.

| Query | Where it must appear |
|---|---|
| app that listens to your recitation | short description, full description, landing page H1 |
| quran memorization app | title (variant A), full description, landing `<title>` |
| hifz app / hifz tracker | title (variant B), full description |
| تسميع القرآن | ar full description |
| حفظ القرآن تطبيق | ar full description, ar landing `<title>` |
| مراجعة الحفظ | ar full description |

### Tier 2 — category head terms, which you will not win quickly
`quran`, `quran app`, `mushaf`, `قرآن`, `مصحف`, `prayer times`, `adhan`,
`azan`. These are dominated by apps with tens of millions of installs. Include
them so you are *eligible*, not because you will rank. Ranking on `quran` alone
is a multi-year, install-velocity problem, not a copywriting one.

### Tier 3 — long tail, where a new app actually gets its first installs
`quran app without ads`, `offline quran no internet`, `quran memorization
spaced repetition`, `hifz revision schedule`, `quran app that corrects you`,
`madani mushaf 604 pages`, `15 line quran`, `morning and evening azkar`,
`sahih bukhari offline`, `قرآن بدون انترنت`, `قرآن بدون إعلانات`,
`مصحف المدينة 604 صفحة`, `أذكار الصباح والمساء`.

These are where the honest limits in the description help rather than hurt: a
person searching "quran app without ads" converts on a listing that says "no
ads" and stays, which is the retention signal that actually moves ranking.

## Keywords to deliberately NOT chase

- **tajweed / تجويد** — the app does not grade tajweed. `src/engine/mistakes.ts`
  decides *which word* you said; `src/engine/confusion.ts` explicitly refuses
  letter-level blame when the evidence is weak. Ranking for tajweed would send
  you traffic that uninstalls, and uninstall rate is a ranking input.
- **quran translation / english quran / tafsir** — there is no translation
  bundled. `src/assets/quran-data.json` carries the Arabic text and surah names
  only; the `quran-json` package is a devDependency read at build time.
- **qibla / قبلة** — no compass feature exists in this repo.
- Any competitor's brand name. Play's metadata policy prohibits it, and a
  listing rejection costs more than the traffic is worth.

## The field-by-field map

| Field | Weight (Play, generally understood) | What goes in it |
|---|---|---|
| App title (30) | highest | brand + one head keyword |
| Short description (80) | high | the differentiating mechanic in a human sentence |
| Full description (4000) | moderate, and fully indexed | everything else, once or twice, in prose |
| Developer name | low but real | consider "Quran Habit" as the developer name too |
| Package name `com.quranhabit.app` | indexed, unchangeable after publish | already correct — do not change it |
| In-app product names | indexed | name the subscription something searchable, e.g. "Quran Habit Coach" |
| Ratings & reviews text | indexed | you cannot write it, but reviews mentioning "memorization" help |

`com.quranhabit.app` is set in `app.json` and **cannot be changed after the
first publish, ever**. It is already a keyword-bearing id. Good.

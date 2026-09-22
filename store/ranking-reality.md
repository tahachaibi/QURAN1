# How long ranking takes, and what actually moves it

No guarantees appear in this file, because none are available. What follows is
what is known about how Play ranking behaves, what is inferred, and what is
simply unknown.

## What actually moves Play ranking

Google has never published the Play search algorithm. These are the inputs it
is broadly understood to use, ordered by how much they matter relative to how
much you control them:

**1. Retention, and specifically day-1 / day-7 / day-30 install retention.**
This is the one Google says out loud, repeatedly, in Play Console and in its
developer guidance: apps people keep get surfaced. It is also the one input this
codebase is unusually well placed to win. A recitation streak
(`app/(tabs)/tracker.tsx`), a daily revision queue (`src/engine/hifz.ts`) and
prayer times are three separate reasons to open the app tomorrow. Most Quran
apps have one.

**2. Uninstall rate.** The mirror of the above, and the reason the "Honest
limits" section is in the store description rather than hidden. A user who
installs expecting tajweed correction or an English translation uninstalls
within a day, and that costs more ranking than the extra install was worth.

**3. Ratings and review volume, weighted recent.** Play weights recent ratings
more heavily than old ones, and a rating below roughly 4.0 suppresses
discovery badly in a category where the incumbents sit around 4.5+. The single
highest-leverage engineering work for ASO is therefore **`docs/acceptance-log.md`
— ten acceptance tests, zero filled in.** An app whose central mechanic fails on
the reviewer's device earns 1-star reviews that no amount of listing copy can
outrun, and the follow-along has never been run on a device by anyone.

**4. Install velocity, especially in the first 72 hours and relative to the
category.** Absolute installs matter less than the slope. This is the input that
external promotion (a mosque WhatsApp group, a hifz teacher's class, one
Ramadan post) actually buys you.

**5. Keyword relevance in title, short description, full description.** Real,
but far weaker than 1–4, and the only one addressed by writing. This is why
`store/listing/en-US.md` exists and also why it is not the point.

**6. Technical quality signals surfaced in Android vitals** — crash rate, ANR
rate, excessive wakeups. Play demotes apps that exceed the bad-behaviour
thresholds. The adhan timer that re-arms every minute
(`src/data/adhanTimer.ts`) and the recognizer watchdog are both wakeup-adjacent;
watch vitals after launch.

## What does not move it

- **Buying installs.** Incentivised or bot installs are detected, do not retain,
  and risk suspension of the developer account. In this category a suspension is
  unrecoverable: the package name `com.quranhabit.app` can never be reused.
- **Keyword stuffing the description.** A repeated-keyword block is both a spam
  signal and a conversion loss.
- **Review exchange schemes / asking for 5 stars.** Against Play policy, and the
  in-app review API deliberately gives you no control over the rating.
- **Backlinks to the landing page.** Web SEO signals do not feed Play search.
  The landing page is for *web* queries and for social previews; it is not an
  ASO input.
- **Changing the listing every week.** Changes reset the learning on whatever
  Play was measuring. Change the title at most quarterly, and only with a
  Store Listing Experiment running.

## The honest timeline

Nobody can give you a date, and anyone who does is selling something. What can
be said about the shape of it:

| Phase | What is realistic |
|---|---|
| Week 0 | Indexing after publish takes hours to a few days. You will rank for your own brand name ("Quran Habit") almost immediately, and for nothing else. |
| Weeks 1–4 | Long-tail queries only: "app that listens to your recitation", "quran hidden mode memorize". These have low volume, which is exactly why a new app can appear on them. |
| Months 2–6 | Mid-tail becomes possible *if* retention and rating hold: "quran memorization app", "hifz app", "تسميع القرآن". This is where install velocity and 4.5+ ratings do the work, not copy. |
| Head terms: `quran`, `قرآن`, `prayer times` | Realistically years, or never, against apps with 50M+ installs and a decade of rating history. Plan the business on not ranking for these. |

Two things compress that timeline and both are outside the listing:

- **Ramadan.** Search volume in this category spikes enormously in Ramadan and
  the weeks before it. An app that is already published, already rated and
  already retaining goes into that window with compounding advantage; an app
  published *during* it is competing for attention with every incumbent's
  marketing budget. Ramadan 1448 begins around February 2027 — **verify the date,
  I have not**. Ship, get rated, and iterate well before it.
- **One real distribution channel.** A hifz teacher with thirty students, one
  mosque, one Moroccan Islamic-apps Telegram channel. Thirty installs that
  retain beat three hundred that do not.

## What I could not verify, and you should

Flagged plainly rather than guessed:

- **Competitor pricing.** The task brief says Tarteel is "~$10/mo last known". I
  cannot confirm that, nor their current tier structure, from this environment.
  Check it yourself before pricing against it.
- **Search volumes for every keyword in `store/listing/keywords.md`.** Not
  verified, not verifiable here. See that file's opening section.
- **Current Play policy details** — Data Safety form requirements, the exact
  prominent-disclosure wording required for `RECORD_AUDIO`, the current target-API
  deadline, and whether a new personal developer account still requires the
  12-tester-for-14-days closed test before production. That last one, if it still
  applies, is a *hard multi-week schedule dependency* and the first thing to
  check in Play Console, before any of this.
- **Whether Play will accept the app at all with an English-only UI and an Arabic
  listing.** It generally does; the risk is ratings, not rejection.

## The order to actually do this in

1. **Make the app icon.** There is none (`store/assets/screenshots.md`). Nothing
   else converts until this exists.
2. **Run the ten acceptance tests** in `docs/acceptance-log.md` on a real device.
   A broken core mechanic makes every other item on this list worthless.
3. **Resolve the licence questions** — the hadith English translations have no
   licence (`docs/hadith.md`) and the QUL layout is unresolved
   (`docs/mushaf-layout.md`). Publishing to a store is "distributed beyond your
   own phone", which is the exact condition those docs name.
4. Privacy policy live (`store/web/privacy.html`) and Data Safety form completed
   to match it word for word.
5. Switch the release build to an **app bundle** for Play. `eas.json`'s
   `production` profile is already `app-bundle`; the CI workflow builds
   `:app:assembleRelease` (an APK) with the **Android debug signing key**, which
   Play will reject. A real upload key and `:app:bundleRelease` are needed.
6. Listing copy, screenshots, feature graphic.
7. Closed test → production. Then, and only then, start reading the Play Console
   search-terms report and replace the keyword hypothesis with data.

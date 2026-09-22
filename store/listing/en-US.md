# Play Store listing — en-US

Field limits are Google Play's: title 30, short description 80, full description
4000 characters. `node store/check-lengths.mjs` asserts them, and CI can run it.

Every claim below is traceable to code in this repo. Nothing here describes a
feature that does not exist, because the first one-star review for a listing that
oversells a Quran app is written by someone who trusted it.

---

## Title (30 max)

**Primary — 28 characters**

```
Quran Habit: Memorize & Read
```

Two A/B alternatives, same brand slot, different head keyword:

| Variant | Chars | Head keyword it bids for |
|---|---|---|
| `Quran Habit: Memorize & Read` | 28 | memorize quran |
| `Quran Habit: Hifz Companion` | 27 | hifz |
| `Quran Habit — Recite & Learn` | 28 | quran recitation |

The title is the single strongest indexed field on Play, so the brand word goes
first (people who hear about the app must find it by name) and exactly one
category keyword follows. Do not attempt "quran memorize hifz tajweed mushaf" —
that reads as stuffing to both the ranking system and to a human, and **tajweed
would be a lie**: nothing in `src/engine/` grades pronunciation quality. It grades
*which word you said*, and `src/engine/confusion.ts` deliberately refuses even to
attribute a letter-level mistake when the evidence is weak.

## Short description (80 max)

**Primary — 71 characters**

```
It listens while you recite and follows you word by word on the mushaf.
```

Alternatives:

```
Recite aloud. The page follows your voice, word by word. Offline. No ads.
```
```
Hifz with a page that listens: follow-along, hidden mode, spaced revision.
```

The short description is indexed and is the only body text visible before a tap,
so the primary one states the single differentiating mechanic in plain words —
the same sentence `app/onboarding.tsx` opens with ("The page follows your voice").

## Full description (4000 max)

```
Quran Habit listens while you recite and follows you through the mushaf, word by word.

Open any surah and start reciting. The highlight moves with your voice across the printed page, and when you reach the last line, the page turns. You never have to tell it where you are: begin in the middle of another surah, with or without the basmala, and it finds you in about a second.

THE FOLLOW-ALONG
• Recite aloud and watch the page keep up, word by word.
• Start anywhere in the Quran. There is no "select the ayah first" step.
• Missed and misread words are marked as you go and collected into a review sheet at the end — never in red on the sacred text.
• Your voice is processed on your own device by Android's Arabic speech recognizer. Nothing is recorded, nothing is uploaded.

HIDDEN MODE, FOR MEMORISATION (HIFZ)
• The page holds its exact shape while the words stay hidden, and each word appears as you say it. Nothing reflows — the page you memorised looks the same hidden or shown.
• Stuck? Tap once for the first letter. Tap again for the whole word.
• Every hint is remembered, so the app knows which words you lean on.

REVISION THAT KNOWS YOUR WEAK SPOTS
• Each session grades the ayahs you recited from what actually happened — matched, missed, hinted — and schedules them with spaced repetition.
• The Tracker shows these ayahs, today: weakest and most overdue first, grouped into passages you can actually recite rather than shuffled verses.
• A personal error profile shows the words you confuse, and is honest enough to say when the fault is the phone's recognizer rather than your recitation.
• A recitation streak and an 18-week heatmap. The streak counts Quran only.

THE REAL PRINTED PAGE
• All 604 pages of the Madani mushaf with the true 15-line layout: the same line breaks, ayah markers and surah bands as print.
• Set in KFGQPC Uthmanic Script from the King Fahd Glorious Quran Printing Complex — the face the printed mushaf itself uses.
• Jump by surah, juz, hizb or page, and resume exactly where you stopped.

PRAYER TIMES AND THE ADHAN
• Today's times from your location, using your country's own calculation authority — Morocco, Egypt, Türkiye, Saudi Arabia, Pakistan, Indonesia, Malaysia, France and more, matched automatically.
• A countdown, a five-minute warning, and per-prayer minute corrections so the times match the mosque you follow.
• The adhan plays in full, with a stop button — not as a truncated notification chime.
• Times are cached, so the tab still answers offline.

HADITH AND ADHKAR
• Sahih al-Bukhari and Sahih Muslim in full: 14,734 narrations, Arabic with English underneath, each with its number so you can check it against print.
• Morning and evening adhkar, where not one Arabic word is typed by this app: every du'a is a verbatim passage from the bundled hadith or mushaf.

LISTEN
• Recitations from Yasser Al-Dosari, Mahmoud Khalil Al-Husary, Mostafa Ismaeel and more, on the same page view.

FREE, AND NO ADS
Every part of this app is free. No ads, no sign-up. Worship does not belong behind a paywall.

PRIVACY
No account. No ads. No analytics, no tracking, no advertising ID.
The Quran, the hadith, the adhkar and the recitation matching all work in airplane mode. Prayer times are the exception: they are fetched for your approximate location, so that one screen needs a connection.
Your voice goes to Android's own speech recognition — on the device when the Arabic pack is installed, otherwise through Android's service. Quran Habit never records or uploads it.

HONEST LIMITS, BEFORE YOU INSTALL
• Android only for now.
• Arabic text only. No translation or tafsir in this version.
• The follow-along uses Android's own Arabic speech recognition. Install the offline Arabic language pack for best results.
• It does not grade tajweed. It follows which word you said, not how you said it.

Quran, mushaf, hifz, memorize Quran, recitation, prayer times, adhan, azan, hadith, Bukhari, Muslim, morning and evening azkar, offline Quran.
```

### Notes on the copy

- The closing keyword line is a deliberate, single, readable sentence. Play
  indexes the full description, but a wall of comma-separated keywords risks a
  spam flag and reads badly to a human; one sentence is the compromise. Delete
  it entirely if you would rather not have it.
- **Do not name Tarteel, Muslim Pro or Quran.com anywhere in the listing.** Play's
  metadata policy prohibits irrelevant references to other apps and brands, and a
  comparison in the description is the easiest possible listing rejection.
- "14,734 narrations" is from `docs/hadith.md`. "604 pages", "15 lines" and the
  QPC V2 line breaks are from `docs/mushaf-layout.md` and
  `src/assets/layout/qpc-v2-15-lines.db`. The reciter names are the seeded list in
  `src/data/audio.ts`. The country list is `REGION_RULES` in
  `src/data/prayerRegion.ts`.
- "Nothing is recorded, nothing is uploaded" is true of this app's own code, but
  it is a claim about **Android's** recognizer too. Google's on-device recognition
  is local; the network-relay path is not. `src/recognition/` already detects
  which strategy is in use. Before publishing, confirm the wording with a lawyer
  or soften to "processed by Android's speech recognition, which this app asks to
  run on-device" — and make the Data Safety form match exactly what you say here.

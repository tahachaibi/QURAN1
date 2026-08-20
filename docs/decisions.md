# Decisions, trade-offs and what is still unverified

## What I could and could not verify

This was built in a Linux container with no Android device, no microphone, no
Android SDK (`dl.google.com` is blocked by the network policy here) and no Expo
credentials. That splits the work cleanly:

**Verified by running it**

| Claim | How |
|---|---|
| Madani page numbers are correct | `scripts/verify-pages.mjs`: 29 hand-checked facts, all pass |
| Word array is well-formed | `__tests__/data.test.ts`: page/surah partitions, 1:1 display↔index correspondence for all 6,236 ayahs |
| الرحمن ≠ الرحيم | `__tests__/distance.test.ts`, both directions |
| Alignment is idempotent, breath-restart works, jumps land and credit | `__tests__/align.test.ts`, `session.test.ts`, `fixtures.test.ts` |
| Mistake gates behave | `session.test.ts`, `one-misread-word` fixture |
| Page renderer does not crash and hidden mode keeps identical geometry | `__tests__/MushafPage.test.tsx` |
| Engine cost per partial | `npm run bench`: p95 **1.07 ms** on desktop V8 |
| Metro resolves everything | `expo export --platform android` → 6.09 MB hbc |
| The native module will be linked | `expo-modules-autolinking search` lists `expo-arabic-speech` |
| Every Android API used exists with the signature assumed | read from AOSP `android14-release` source |
| Every Expo Kotlin DSL symbol exists | read from the installed `expo-modules-core` Kotlin source |
| **The Kotlin module compiles** | `:expo-arabic-speech:compileReleaseKotlin` green in CI |
| Gradle actually links the module | `gradlew projects` lists `:expo-arabic-speech` |
| Hifz scheduling and the confusion profile | `__tests__/hifz.test.ts`, `HifzPanel.test.tsx` |

**Not verified, and cannot be here**

- The Kotlin has never been compiled. No Android SDK is reachable.
- No acceptance test in §12 has been run: all ten need a real device and a
  voice.
- The <300 ms end-to-end budget: only the engine's ~1 ms share is measured. The
  recognizer's own latency and the React commit are unmeasured.
- Whether `EXTRA_SEGMENTED_SESSION` actually works on any given device. The code
  treats this as unknown by design: it only believes segmented mode once an
  `onSegmentResults` callback has actually arrived, and demotes itself and says
  so otherwise.
- Whether the phonetic equivalence classes match what Android's Arabic
  recognizer really emits. They are the spec's classes, implemented literally.

## Deviations from the brief, and why

**React 18.3.1, not 18.2.** Expo SDK 52 and React Native 0.76 both require
18.3.1; RN 0.76's renderer will not run against 18.2. Pinning 18.2 produces a
build that does not start, so the version in the brief is taken as a slip.

**`expo-asset` added.** `@expo/metro-config` in SDK 52 hard-requires it; without
it Metro refuses to start at all. It is a transitive Expo package, not a new
dependency in spirit.

**minSdk raised from 24 to 26.** `AudioFocusRequest` (API 26) appears as a field
type in the recognizer. Keeping minSdk 24 means a type the verifier may touch on
a device that lacks it. Android 8.0 is a 2017 release and the interesting
features here are API 31/33 anyway.

**`wordMeta` is typed arrays, not an object array.** §2 asks for a parallel
`{surah, ayah, wordInAyah, page}[]`. Allocating 77,429 objects on a phone is a
poor trade for an O(1) lookup that four `Uint8Array`/`Uint16Array`s give for
~380 KB. `wordMeta(i)` returns exactly the specified shape; the storage
underneath is different. Same for `words`: stored as one space-joined string and
split at load, which parses an order of magnitude faster than a 77k-element JSON
array.

**No per-word line data, so line breaks are approximate.** §3 permits this
explicitly. Page *boundaries* are exact and verified. Getting true 15-line pages
needs QUL/quran.com word-layout data, which is not bundled in either data
package and would have to be fetched at build time — worth doing, but it is a
separate piece of work with its own licence question.

**Words are separate views, not one justified `<Text>` run.** A single `<Text>`
would give real line-breaking and justification but no per-word breathing
underline, missed-word dot or reliable tap target. Arabic does not join across
spaces, so nothing is lost in shaping. The cost is that `flexWrap` cannot justify
only the full lines, so lines are centred rather than justified.

## The one that would have wasted a day

**The Kotlin module was never committed.** `.gitignore` had an unanchored
`android/`, meant for the prebuild output at the repo root. Git matches that
pattern against a directory of that name at *any* depth, so it also excluded
`modules/expo-arabic-speech/android/` — the entire 619-line recognizer, its
`build.gradle`, its manifest.

Everything local kept passing, because the files were on disk. `expo export`
bundled. `expo-modules-autolinking search` even found the module, because
`expo-module.config.json` sits one level up and *was* committed. The first thing
to notice was Gradle, by having no `:expo-arabic-speech` project to include.

On a phone this would have surfaced as "native module not linked" with no visible
cause — §10's "verify the device is running the code you think it is", except the
code was never in the repo at all. Patterns are anchored now (`/android/`,
`/ios/`) and both CI jobs assert the Kotlin exists in the checkout before
anything tries to use it.

## The bug a real device found that no test could

**The tashkeel rendered red, and a fifth of the Quran was silently missing a
diacritic.** Both from the same cause, and both invisible from here.

`@expo-google-fonts/amiri-quran` does not ship Amiri Quran. It ships Amiri Quran
**Coloured**: the TTF carries `COLR` (8,366 bytes) and `CPAL` tables painting 612
glyphs from a four-colour palette — `#CC3333` red, `#00A550` green, `#EE9933`
orange, `#336699` blue. Android honours COLRv0 from API 26, so it faithfully
painted the marks. That is not merely a taste question: red is the missed-word
signal (§6.3, "no red text on the sacred text"), so a red-marked text destroys
the error channel entirely, and the palette's `#EE9933` sits almost on top of the
accent gold `#C9A227`.

Checking the font's coverage against the text it has to render then turned up the
worse problem. **Amiri Quran has no glyph for U+065E** (ARABIC FATHA WITH TWO
DOTS), which the bundled Uthmani text uses **1,807 times across 1,241 ayahs** — a
fifth of the Quran. A missing *combining mark* renders as nothing rather than a
tofu box, so every page still looked plausible. And Al-Fatiha contains none of
them, so the one page anybody would test on could never reveal it; the first
affected page is page 3.

Plain **Amiri** covers all 73 codepoints the text uses and carries no colour
tables, so the ayah text now uses Amiri. This is a deliberate departure from §7,
made for the reason §7 gives for specifying a font at all — "correct
tashkeel/Quranic marks". Amiri Quran demonstrably renders 1,807 of them as
nothing.

I did not ship a "coloured marks" toggle. Coloured Quranic marks are a legitimate
scholarly convention, but the only coloured font available here is the one with
the glyph hole, and offering a knowingly-broken option is worse than not offering
it. The right fix, if it is wanted, is a complete coloured Quranic font.

`scripts/verify-fonts.mjs` now parses the sfnt directory and cmap in pure Node
and fails the build on either condition. Pointed at Amiri Quran it rejects it on
both counts, which is the only reason to trust it.

## The first bug a real device found

**Every session paused instantly with "Another app took the microphone", with no
other app involved.** The app was taking the microphone from itself.

I wired the audio-focus change listener to pause the session on
`AUDIOFOCUS_LOSS` / `AUDIOFOCUS_LOSS_TRANSIENT`. But audio focus governs
**playback**, not capture. The system recognition service requests focus for its
own session the moment it starts listening, which revokes ours — so the very act
of starting to listen produced the event that stopped listening. A notification
chime would have done the same thing, mid-ayah.

The focus request itself is correct and stays: `GAIN_TRANSIENT_EXCLUSIVE` is the
documented way to ask other apps to stop playing sound into your microphone. It
is the *reaction* that was wrong. Focus loss is now reported as
`audio-focus-lost`, shown in the debug overlay, and does nothing to the session.

Real microphone loss has exactly one reliable signal: `ERROR_AUDIO` from the
recognizer. That now raises `mic-unavailable`, which is treated as a *recoverable*
interruption with a one-tap resume rather than a failed session.

Two related hardenings came out of the same look:

- §4's "pause any Listen-tab playback when the mic starts" is now done
  explicitly, by the provider calling a stopper the Listen panel registers.
  Leaning on audio focus for that was the thinking that caused the bug.
- The AppState pause now fires only on `background`, not on any non-`active`
  state. Android reports `inactive` transiently — during a permission dialog, or
  when the privacy indicator appears — and that was another way to pause a
  session nobody had left.

## Things I found and fixed while building

**The article-collapse bug.** §5.1 says to collapse the definite article's
spacing variants. Applying that to the canonical mushaf text is wrong: `ءَالِ`
("family of") normalizes to `ال`, and collapsing it swallowed the following word
in 23 ayahs (2:49, 2:50, 3:11, 8:54, 12:6, 14:6, …), silently shifting every
later word index on those pages. There are now two tokenizers: the canonical one
never fuses, the recognizer one does, and it consults the Quran's own vocabulary
before fusing so `ال فرعون` survives. The 1:1 invariant is asserted for all
6,236 ayahs.

Fixing this also moved the word count from 77,405 to **77,429** — the classical
count.

**A single repeated word dragged the cursor backwards.** §5.3's backwards
re-anchor, taken literally, made `align(cursor=8, heard=['الرحيم'])` jump back to
1:1's الرحيم (score 1.0) instead of stepping forward to 1:3's (score 0.65). A
backwards anchor now has to explain *strictly more* of the transcript than
staying put, and at least two words of it. Going back must be earned by
evidence, not by one word fitting better.

**The localizer was too eager to jump.** Comparing the global best against the
caller's local score is not enough, because the caller's score uses the narrow
locked-on look-ahead. Ordinary forward progress could therefore look like a
jump. `localize()` now also computes the *generous* local score — wide
look-ahead plus the breath-restart window — and uses the better of the two as
the bar.

**The basmala could cause a jump, not just fail to prevent one.** §5.5 says the
basmala must never anchor a jump and must never suppress one. Reciting the
basmala on the way from Al-Fatiha into Al-Baqarah localized as a jump *back* to
1:1 — the single most likely false jump in the app. An all-basmala transcript
now strips to nothing.

**"Moved ≥3 words past it" is `cursor - word - 1`.** A skip at index *w* with the
cursor at *w+3* means two words followed it, not three. With the off-by-one, a
word was flagged in the same final result that skipped it — exactly what
acceptance test 8 forbids.

**Kotlin, found by review rather than by the compiler** (there is no compiler
here, which is precisely why this list matters): `main.post { … return@main }`
labels the lambda `post`, not `main`; a nullable `Bundle` parameter is not
smart-cast by a null check on a *different* value; `postDelayed(…, 4_000)` does
not compile because Kotlin will not widen `Int` to `Long`; `@Field val` in a
class body works but `@Field var` constructor parameters are what the first-party
modules use and what `RecordTypeConverter` is exercised against; API-33 calls
belong in `@RequiresApi` helpers so the verifier never touches an
API-33 signature on an older device.

## Known weaknesses I did not paper over

**The §5.2 thresholds are looser at the word level than the spec's own framing
suggests.** A single cross-class substitution fits inside 1.0 for short words and
inside 2.0 up to length 9, so `يوم`/`قوم`, `العالمين`/`الظالمين` and
`الحمد`/`الحميد` all compare equal today. I implemented the numbers as specified
rather than quietly re-tuning them, and pinned the behaviour in a test named
"documents the pairs the mandated thresholds do accept".

In practice the aligner is what prevents confusion: locked on, a heard word is
only ever compared against the next three expected words, and none of those pairs
sit within three words of each other anywhere in the Quran. The place it could
bite is the global localizer, where a loose pair buys one extra vote. Tightening
these belongs in a pass driven by real device transcripts through the replay
harness — which is why the harness exists.

**`nearestHeard`** — the "what was heard instead" string on a mistake row — is a
heuristic (the first unmatched heard token near the skip). It is for the review
sheet's benefit only and never feeds a decision.

**The five-minute endurance question (acceptance test 9) is designed for but
unmeasured.** The session transcript is capped at 600 words, the event capture at
4,000 events, per-page slices are cached by reference, and no `Set` or `Map` is
reallocated when nothing changed. Whether that holds against a real recognizer
for five minutes is exactly the kind of claim that needs a device.

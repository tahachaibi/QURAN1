# Quran Habit

An Android-first Islamic habit companion whose centrepiece is a recitation
follow-along that tracks your voice through the Quran.

Everything works offline except prayer times and optional audio playback. There
is no backend, no account and no analytics; the Quran text, the Madani page
layout and the verse-search index are all bundled at build time.

## The one architectural idea

The reciter's position is **a single integer index into a flat array of every
word in the Quran** (77,429 words). Not a position within a surah — a position
in the Quran.

```
src/data/quran.ts        words[]  + page/ayah/surah offset tables
src/engine/session.ts    owns exactly one globalCursor
src/context/…Provider    mounted ABOVE the router, so no screen owns the session
```

The Read screen is a pure view of wherever the cursor is. Reciting into another
surah just changes the cursor's value; the page view follows. There is no
`router.replace`, no remount and no microphone handoff anywhere in the read
path, because there is nothing to hand off.

## Layout

```
app/                     expo-router screens (tabs, surah, onboarding, settings)
src/engine/              the matching engine — pure, testable, no React
  normalize.ts           single source of truth, imported by the generators too
  distance.ts            phonetic-weighted edit distance
  align.ts              idempotent alignment of heard vs expected words
  localize.ts            continuous cross-Quran localization
  mistakes.ts            the five gates a word must fail before it is a mistake
  session.ts             the reducer that owns cursor, livePos, mistakes, timer
  replay.ts              the replay harness
src/data/                bundled Quran, storage, prayer times, audio
src/components/          page renderer, controls, sheets, debug overlay
src/recognition/         JS-side recognizer session rules (watchdog, AppState)
modules/expo-arabic-speech/  the Kotlin native module
scripts/                 data generators, mushaf verification, bench, fixtures
__tests__/               unit, alignment, session, fixture and render tests
```

## Setup

```bash
npm install
npm run gen          # generate src/assets/ from quran-json + quran-meta
npm test             # 100 tests
npm run typecheck
```

`npm run gen` runs three generators and then **verifies the result against a
printed mushaf** (`scripts/verify-pages.mjs`, 29 hand-checked page and juz
facts). If a data-source bump ever shifts pagination, that fails loudly instead
of silently mislabelling pages.

## Building

The app needs a native module, so **Expo Go cannot run it**. Build a dev client:

```bash
npx eas login
npx eas build --profile development --platform android   # produces an APK
```

Before rebuilding an APK, check bundling the fast way — seconds instead of
minutes:

```bash
npm run bundle:check    # expo export --platform android
```

### Developing from a container against a physical phone

```bash
npm run dev             # scripts/dev.sh
```

That kills stragglers, opens a **cloudflared quick tunnel**, exports
`EXPO_PACKAGER_PROXY_URL`, and starts Metro. Do not substitute
`expo start --tunnel`: ngrok refuses when an Expo token is set ("Cannot use
ngrok with a robot user"), and container port-forwarding answers the phone with
404 because the forwarded origin is not the origin Metro advertises.

## Working on matching quality

Recite once, iterate forever:

1. Turn on **Settings → Diagnostics → Show debug overlay** in a dev build.
2. Recite. The overlay shows heard alternatives, local vs global score,
   cursor/livePos, and the jump decision.
3. Tap **Export replay fixture** and save the JSON into `__tests__/fixtures/`.
4. `npm test` — `__tests__/fixtures.test.ts` picks up every file in that
   directory automatically and replays it through the real reducer.

That is the only way to tune the matcher without re-reciting the passage, and it
turns "accuracy feels worse" into a diff.

```bash
npm run bench       # engine latency against the real 77k-word array
npm run fixtures    # regenerate the synthetic fixtures
```

## Data sources and licences

- Quran text: [`quran-json`](https://github.com/risan/quran-json) (CC-BY-4.0)
- Madani page / juz metadata: [`quran-meta`](https://github.com/quran-center/quran-meta) (MIT)
- Prayer times: [Aladhan](https://aladhan.com/prayer-times-api)
- Audio: `cdn.islamic.network`
- Fonts: Amiri and Amiri Quran (OFL) via `@expo-google-fonts`

Both data packages are **devDependencies**: they are read at build time only and
never ship in the app.

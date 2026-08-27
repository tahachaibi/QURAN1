# What I need from you

Four things, in priority order. The first one unblocks everything else and takes
about five minutes of your time.

---

## 1. Install the APK and run the ten acceptance tests

**You do not need an Expo account, EAS, Android Studio, or a Metro tunnel.** CI
builds a self-contained, installable APK on every push.

### Getting it

1. Open **https://github.com/tahachaibi/QURAN1/actions**
2. Click the most recent green **android** run on branch
   `claude/quran-habit-android-jr6hwv`
3. Scroll to **Artifacts** at the bottom → download **`quran-habit-apk`**
4. Unzip it. Inside is `quran-habit-<sha>.apk`
5. Copy it to your phone and tap it. Android will warn about installing from an
   unknown source — allow it for your file manager. (The APK is signed with the
   standard Android debug key, which is why it installs without any account.)

### First launch

- It will ask for the **microphone**. Say yes — follow-along cannot work without
  it.
- The 3-step intro ends by dropping you into Al-Fatiha, ready to recite.
- Go to **Settings → Diagnostics → Show debug overlay** and turn it **on** before
  you start testing. That overlay is how I see what the engine saw.

### The tests

`docs/acceptance-log.md` is a checklist with all ten tests written out, one
section each, with the exact thing to watch for. Fill it in on your phone or on
paper and paste it back to me — even just "1 ✅, 2 ✅, 3 ❌ it un-revealed the
words" is enough to act on.

**What matters most, in order:** test 1 (does Al-Fatiha track at all), test 4
(does the jump to 2:6 work), test 9 (does it survive five minutes). If 1 fails,
nothing else matters yet and I need the debug overlay numbers.

### If it crashes or the mic never starts

Tell me these four lines from the debug overlay: **status**, **strategy**,
**on-device**, **arabic pack**. And if you can, run this with the phone plugged
in and send me the output:

```
adb logcat -d | grep -iE "quranhabit|ArabicSpeech|SpeechRecognizer|ReactNative" | tail -80
```

---

## 2. The recitation log (the "JSON file"), so I can tune the matcher

This is the single most useful thing you can send me, and it is now **four taps**
— no debug overlay, no settings, nothing to turn on first.

### How to make it

1. Open a surah and recite as you normally would.
2. Tap **Stop** when you're done. The summary card appears.
3. On that card, tap **Save recitation log**.
4. Android's share sheet opens with a file called something like
   `quran-habit-fixture-214-events.json`. Send it to yourself — WhatsApp to your
   own number, Gmail to yourself, Drive, Keep, anything. Then send me the file.

That's it. If the share sheet does not appear, tell me — that means the export
failed and the card will show why.

**Then tell me, in words, which surah and which ayahs you recited.** This part is
not optional and I will keep asking for it: inferring the passage from the
transcript is exactly how a matcher gets tuned to fit the wrong text.

### What's in the file, and what is not

It is the *event log* of the session: every partial transcript the recognizer
produced, with timestamps, plus the passage you were on. **No audio.** Nothing is
uploaded anywhere — the app writes the file to its own folder and hands it to the
share sheet, and that is the only time it leaves the app.

Each file becomes a permanent regression test: it drops into
`__tests__/fixtures/` and `npm test` replays it through the real engine, so a
change that would have broken your session fails the build instead. The five
fixtures in there today are ones I wrote by hand — synthetic, useful for logic,
useless for accuracy. **Two or three real ones are worth more than everything I
can invent.**

**Most useful captures, if you're choosing:**
- Al-Fatiha at your natural pace (the baseline)
- A session where it visibly got confused or froze
- A session where it flagged a mistake you know you did not make
- The 2:6-without-basmala jump from test 4

### The older path, if you prefer it

Settings → Diagnostics → Show debug overlay, then tap the overlay to expand and
tap **Export replay fixture**. Same file, same result. The summary-card button
exists because burying it behind a diagnostics toggle meant it never got used.

---

## 2b. The adhan — you choose the file on your phone now

**Nothing to send me.** Prayer tab → **Choose adhan** → pick any audio file on the
phone. The app copies it into its own storage and plays it straight away so you
hear it there and then. No size limit but the phone's, and no rebuild.

That replaces sending me a file, which failed twice for two different reasons:

- The first was **four minutes of digital silence** — a structurally perfect MP3
  (9,200 valid frames, 128 kbps, 44.1 kHz, 4:01) whose audio payload was 100%
  zero bytes. Every layer below worked and said so: packaged, copied to res/raw,
  extracted, decoded, played at full volume on the speaker. "Playing 3:59 of
  adhan" was true. There was nothing in it to hear. I had checked that file's
  container and never its signal, and three rounds of debugging went into a
  player that was working.
- The second was **too large to send at all**, which is the app's problem to
  solve, not yours.

### What is guarded now

- `scripts/verify-audio.mjs` runs in `npm run gen` and in CI and **refuses a
  silent file**: it walks the MPEG frames, measures the zero-byte fraction of the
  audio payload, and fails above 95%.
- A **generated chime** is bundled — 1.6 s, computed from arithmetic, so its
  contents are known. With nothing chosen, **Hear it now** plays that and says so.
  Hearing it proves the phone and the app can play sound, so any later silence is
  the recording. That distinction cost three rounds; it is one tap now.

### The one limit, stated plainly

A file you choose plays **in the app**, with the Stop button. The notification for
when the app is **closed** keeps the default sound. Android fixes a notification
channel's sound when the channel is created and it must be a resource inside the
APK — a file in the app's private storage is not readable by the system process
that plays notification sounds.

If you want the closed-app notification to be the adhan too, that needs a file
small enough to bundle: **under about 3 MB, 30 seconds or so** (Android truncates
long notification sounds anyway). Converting your file to mono at 96 kbps gets a
4-minute adhan to roughly 2.8 MB, and a 30-second excerpt to about 350 KB. Send
me either and I will bundle it — after checking it has a signal this time.

## 3. Two decisions only you can make

### a) ~~True 15-line mushaf pages~~ — done, but only you can look at it

You sent the QUL layout database and it is in: pages now break into the same
lines as the print, and `scripts/verify-pages.mjs` proves the mapping against a
printed mushaf. See `docs/mushaf-layout.md` for how it was verified.

The one thing I still cannot do is **look at the result**. I can prove it is
structurally correct; I cannot tell you it looks like a mushaf. If a page ever
looks wrong to you, send a screenshot and the page number.

### b) Which recognizer locale sounds best for your voice

`ar-SA` is the default. Recognition quality genuinely varies by locale for the
same voice. Try **Settings → Recognizer locale** with `ar-EG` and `ar-MA` on the
same passage and tell me which tracked best — I'll make that the default.

---

## 4. Optional: an Expo token, if you want EAS builds too

You don't need this. The GitHub Actions APK covers device testing completely.

Only if you want EAS specifically (over-the-air updates, Play Store submission,
iOS later): create a token at
**https://expo.dev/settings/access-tokens**, then add it as a repository secret
named `EXPO_TOKEN` under **Settings → Secrets and variables → Actions → New
repository secret**. Tell me once it's there and I'll wire an EAS job.

Do not paste the token into chat. A repository secret is the only place it should
live.

---

## What I do NOT need

- Any Quran text or audio — all bundled or fetched at runtime already.
- A server, a database, or an account system — the app has none by design.
- Your location — the app asks the phone directly, once, for prayer times.

---

## Where things stand

| | |
|---|---|
| Tests | 228 passing |
| Typecheck | clean |
| Metro bundle | builds, 36.7 MB |
| Kotlin native module | **compiles** (verified in CI) |
| Installable APK | **built by CI on every push** |
| The ten acceptance tests | **0 of 10 run — this is what I need you for** |

The honest summary: everything that can be verified without a phone and a voice
is verified. Nothing that needs a phone and a voice has been.

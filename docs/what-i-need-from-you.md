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

## 2. Recordings, so I can tune the matcher without you re-reciting

This is the difference between me guessing at accuracy and me actually improving
it. The loop is:

1. Recite with the debug overlay on.
2. Tap the overlay to expand it, then tap **Export replay fixture**.
3. Share it to yourself (email, Drive, Keep, whatever) — it's a JSON blob.
4. Send me the JSON **and tell me which surah and ayah you were reciting.**

That last part is not optional. I will not guess what you recited — inferring the
passage from a transcript is exactly how a matcher gets tuned to fit the wrong
text.

Each fixture becomes a permanent regression test: drop it in
`__tests__/fixtures/` and `npm test` replays it through the real engine. Two or
three real sessions are worth more than anything I can synthesise.

**Most useful captures, if you're choosing:**
- Al-Fatiha at your natural pace (the baseline)
- A session where it visibly got confused or froze
- A session where it flagged a mistake you know you didn't make
- The 2:6-without-basmala jump from test 4

---

## 3. Two decisions only you can make

### a) True 15-line mushaf pages — download one file from QUL

Page **boundaries** are exact (verified against a printed mushaf); line breaks
inside the page are computed by the app rather than matching the print. The real
per-word line data lives on QUL — Tarteel's own open library — which this
environment's proxy blocks me from reaching.

**See `docs/mushaf-layout.md`** for the five-minute version: what to download,
which layout to pick, the licence line to copy off the resource page, and the
five checks the generator will run before I trust the file.

Be aware of the one thing I cannot do here: **I cannot look at the result.** I
can prove it is structurally correct; I cannot tell you it looks like a mushaf.
You'd need to eyeball a build.

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
| Tests | 132 passing |
| Typecheck | clean |
| Metro bundle | builds, 6.09 MB |
| Kotlin native module | **compiles** (verified in CI) |
| Installable APK | **built by CI on every push** |
| The ten acceptance tests | **0 of 10 run — this is what I need you for** |

The honest summary: everything that can be verified without a phone and a voice
is verified. Nothing that needs a phone and a voice has been.

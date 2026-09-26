# store/ — Play Store listing and web presence

## Before any of this is published — four things only you can decide

1. ~~**A support email.**~~ **Decided 2026-09-26: `tasmee.app@gmail.com`.** It is on
   the privacy page, and it goes in Play Console → Store settings → Contact
   details. Play shows it publicly on the listing. Once money is involved, Play's
   48-hour self-service refund window ends at this inbox, so check it.

2. ~~**One brand, not two.**~~ **Decided 2026-09-26: "Tasmee Hifz"** (تسميع الحفظ)
   in every language, with package id `com.tasmeehifz.app`. "Quran Habit" was
   dropped because the phrase is already in several apps' titles. Plain "Tasmee"
   was dropped because Eqra Tech's *Tasmee* (`com.eqra.android.tasmee`, since
   2016) does the same job, and an identical name would invite an impersonation
   report. تسميع itself is an ordinary word that several apps use, so the qualifier
   is what makes the name ours. Titles: `Tasmee Hifz: Quran Memorizer` (en) and
   `Tasmee Hifz: حفظ وتلاوة القرآن` (ar).

   Kept on purpose: storage keys, the backup file's `format` string, the Kotlin
   module's `com.quranhabit.speech` package and the upload key's alias. None of
   them is shown to anybody. Renaming the first two would lose data, and
   renaming the other two would buy nothing.

3. **Where the site lives.** Every canonical URL, `hreflang` and Open Graph tag
   under `store/web/` hard-codes `tahachaibi.github.io`, taken from this repo's
   git remote. That is a guess, not a decision. If the site goes anywhere else,
   those tags must change before launch — a wrong canonical tag is the one SEO
   mistake that actively suppresses a page.

4. **Nothing here mentions a subscription, on purpose.** There is no billing code
   in this repo yet, so every claim about a paid tier has been removed from the
   listings and both landing pages. Put them back when, and only when, the code
   exists — the listing's own rule is that nothing in it describes a feature that
   does not ship.

Every factual claim in `store/web/privacy.html` was checked against the source in
`src/` rather than written from memory: the four hosts it names are the only ones
the app contacts (`api.aladhan.com`, `quranicaudio.com`,
`download.quranicaudio.com`, plus Android's geocoder via
`Location.reverseGeocodeAsync`), and the "works offline" claim is scoped to the
Quran, hadith, adhkar and recitation matching, because prayer times are fetched
and cached rather than calculated on the phone.

`node store/check-lengths.mjs` enforces Play's 30/80/4000 limits and runs in CI,
so a copy edit that overflows fails the build instead of the upload.

Everything needed to publish and be found. Each file is written to be used
directly: the listing files are copy-paste into Play Console, the `web/`
directory is a complete GitHub Pages site.

| File | What it is |
|---|---|
| `listing/en-US.md` | Title, short and full description in English, with alternatives |
| `listing/ar.md` | The same in Arabic, rewritten rather than translated — **read its first paragraph before publishing** |
| `listing/keywords.md` | The keyword hypothesis, and an explicit statement of what could not be verified |
| `listing/locales.md` | Which locales to add, in what order, and why |
| `assets/screenshots.md` | The 8 screenshots with captions, the feature graphic, and the missing app icon |
| `web/` | The GitHub Pages landing page: EN + AR, JSON-LD, OG, sitemap, robots, privacy policy |
| `ranking-reality.md` | How long ranking takes, what moves it, what does not |
| `check-lengths.mjs` | Asserts Play's 30/80/4000 character limits on the listing files |

## Verify the copy still fits

```bash
node store/check-lengths.mjs
```

Current state: EN title 28/30, short 71/80, full 3988/4000; AR title 22/30,
short 54/80, full 3659/4000. Worth wiring into `.github/workflows/android.yml`
next to the other generators-and-verifiers, so an edit that overflows a Play
field fails in CI rather than in Play Console.

## Publishing the landing page

**Live since 2026-09-26** at https://tahachaibi.github.io/QURAN1/. The privacy
policy for the Play Console form is
https://tahachaibi.github.io/QURAN1/privacy.html. The workflow below is
`.github/workflows/pages.yml`, and it redeploys on every change under `store/web/`.

GitHub Pages, from this repo, with `store/web` as the source — Settings → Pages
→ Deploy from a branch → `/store/web` is not a selectable folder (Pages offers
only `/` and `/docs`), so use a workflow:

```yaml
# .github/workflows/pages.yml
name: pages
on:
  push:
    branches: [main]
    paths: ['store/web/**', '.github/workflows/pages.yml']
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: store/web }
      - id: deploy
        uses: actions/deploy-pages@v4
```

That publishes to `https://tahachaibi.github.io/QURAN1/`, which is the canonical
URL hard-coded in the pages. Three things to know about that URL:

1. **`robots.txt` at a project-page path is ignored.** Crawlers read it only
   from the host root, which belongs to the account's user-pages repo. The file
   is included for the day a custom domain exists; see its own comment.
2. **A custom domain is worth buying.** `tasmeehifz.app` or similar ranks better
   than a `github.io` subpath for the branded query, gives you a working
   `robots.txt`, and lets the Play listing point at a domain you control. If you
   buy one, find-and-replace `https://tahachaibi.github.io/QURAN1` in
   `web/index.html`, `web/ar/index.html`, `web/privacy.html`, `web/sitemap.xml`
   and `web/robots.txt`, and add a `CNAME` file to `web/`.
3. **Submit the sitemap** in Google Search Console after the first deploy, and
   verify ownership with the HTML-tag method (add one `<meta>` to both pages).

## Images the pages reference and that do not exist yet

`og-cover.png` (1200×630), `og-cover-ar.png`, `favicon.png`,
`apple-touch-icon.png`. They belong in `store/web/`. Until they exist, a shared
link renders with no preview image, which measurably reduces click-through.
See `assets/screenshots.md` for the art direction — the same mark serves the app
icon, the feature graphic and these.

## The two hard prerequisites

Neither is copywriting, and both outrank everything in this directory:

1. **There is no app icon in the repo at all** — `app.json` sets an adaptive-icon
   background colour with no foreground image. `assets/screenshots.md` opens
   with this.
2. **`docs/acceptance-log.md` has ten acceptance tests and zero results.** The
   recitation follow-along has never run on a device. Ratings are a ranking
   input; a core mechanic that fails on the first reviewer's phone cannot be
   fixed by a better description.

---

## Making the build uploadable: the upload keystore

Every APK this repo has ever produced is signed with the **debug** key, because
Expo's Android template wires `release -> signingConfigs.debug`. Play refuses
those outright. CI now builds a signed **App Bundle** as well, but only once four
secrets exist — without them it still builds the sideloadable APK, so nothing
breaks in the meantime.

### 1. Create the key (once, on your own computer, never in CI)

You need `keytool`, which comes with Java. If `keytool -help` says "not
recognized", install **Eclipse Temurin JDK 17** from adoptium.net (Windows `.msi`,
tick "Set JAVA_HOME" and "Add to PATH"), then open a **new** terminal.

Windows (PowerShell), in a folder you will remember, e.g. `Documents\keys`:

```powershell
keytool -genkeypair -v -keystore upload.jks -alias quran-habit-upload -keyalg RSA -keysize 4096 -validity 10000
```

macOS / Linux: the same command works as-is.

It asks for a keystore password (typed twice, invisible while you type), then
your name, organisational unit, organisation, city, region and two-letter
country code. Play shows these as the certificate owner, and your own name is
fine for all of them. Answer `yes` to confirm. The file is PKCS12, the modern
default, so **the key password is the same as the keystore password**, and the
tool will not ask for a second one.

Check it worked:

```powershell
keytool -list -keystore upload.jks
```

It should show one entry, `quran-habit-upload`, of type `PrivateKeyEntry`.

#### Can't install anything? (a work laptop, for example)

Do it in a **GitHub Codespace** instead. It is a Linux machine in the browser
with Java already installed, and nothing gets installed on the laptop.

1. On the repository page: **Code** → **Codespaces** → the `…` menu → **New with
   options**. Pick branch `claude/quran-habit-android-jr6hwv` (or any branch
   whose `.gitignore` has `/.keys/`) and create it.
2. In the terminal at the bottom:
   ```bash
   mkdir -p .keys && cd .keys
   keytool -genkeypair -v -keystore upload.jks -alias quran-habit-upload -keyalg RSA -keysize 4096 -validity 10000
   base64 -w0 upload.jks > upload.b64
   ```
   (If it says `keytool: command not found`, run
   `sudo apt-get update && sudo apt-get install -y openjdk-17-jdk-headless` first.)
3. Check nothing is about to be committed: `git status` must NOT list `.keys`.
4. Explorer on the left → `.keys` → right-click `upload.jks` → **Download**.
   Store it straight into your backup (step 2 below), not in the laptop's
   Downloads folder.
5. Open `upload.b64`, select all, copy, and paste it as the
   `UPLOAD_KEYSTORE_BASE64` secret (step 3 below).
6. When the backup and the secrets are done: github.com/codespaces → `…` next
   to this codespace → **Delete**. Otherwise a copy of the key stays on
   GitHub's servers for as long as the codespace exists.

### 2. Back it up somewhere you will still have in five years

**This is the step people regret.** Once Play App Signing is enrolled, Google
can reset a lost upload key. But a key lost *before* enrolment, or a
forgotten password, can mean you can never update your own app again. Keep
`upload.jks` and its password in at least two places that survive losing this
laptop. For example: a password manager with the file attached, plus a USB
stick, or your own cloud drive.

Never in this repository. `.gitignore` covers `*.jks`, `*.keystore` and
`keystore.properties`, because a key committed even once stays in the history
forever and can sign anything claiming to be this app.

### 3. Add four repository secrets

First turn the file into one line of text:

```powershell
# Windows: copies it to the clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\upload.jks")) | Set-Clipboard
```
```bash
# macOS
base64 -i upload.jks | pbcopy
# Linux
base64 -w0 upload.jks
```

Then GitHub → the repository → Settings → Secrets and variables → Actions →
New repository secret, four times:

| Secret | Value |
|---|---|
| `UPLOAD_KEYSTORE_BASE64` | paste the clipboard (one long line) |
| `UPLOAD_KEYSTORE_PASSWORD` | the password you chose |
| `UPLOAD_KEY_ALIAS` | `quran-habit-upload` |
| `UPLOAD_KEY_PASSWORD` | the same password again |

The next push produces `tasmee-hifz-<sha>.aab` in the artifact zip next to the
APK. Before that bundle ships, CI uses `keytool` to check that the secrets open
the keystore, and uses `jarsigner` to check that the bundle is **not** signed
with the debug certificate. Otherwise you would find out from Play, after the
release notes were already written.

### 4. Enrol in Play App Signing

Do this when you create the app in Console. Google then holds the *app signing*
key and yours is only the *upload* key, which is the arrangement that makes a
lost key recoverable.

### What is deliberately NOT enabled: R8

`enableProguardInReleaseBuilds` stays false. R8 strips and renames code, and this
app has two things that make that risky in a way no test here would catch: a
Kotlin native module reached through Expo's autolinking by name, and Expo modules
that resolve by reflection. The App Bundle already gives the large win — Play
delivers only the ABI and density each phone needs, rather than the universal APK
CI also builds. Turning R8 on is a separate change that needs a real device to
verify, and it should not ride along with the release plumbing.

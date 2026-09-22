# store/ — Play Store listing and web presence

## Before any of this is published — four things only you can decide

1. **A support email.** Play requires one in Console, and everything here that
   needs an address says `SUPPORT_EMAIL_PLACEHOLDER`. Grep for it and replace it.
   GitHub issues were the old answer and are not usable by the people this app is
   for, and once money is involved Play's 48-hour self-service refund window ends
   at a human inbox — yours.

2. **One brand, not two.** `store/listing/ar.md` publishes the title
   **ورد القرآن**, while `app.json` names the app **Quran Habit** with no
   localized name. An Arabic-locale user would find one name on Play and a
   different one on their home screen, which splits every review, every search
   and every word-of-mouth mention in half. Pick one, then either add a localized
   `app_name` to the Android build or change the listing title.

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
2. **A custom domain is worth buying.** `quranhabit.app` or similar ranks better
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

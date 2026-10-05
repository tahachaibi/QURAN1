# Screenshots, feature graphic and icon

## Icon: done

The launcher icon, adaptive icon, notification icon and splash are in
`src/assets/brand/`, drawn by `scripts/gen-icons.mjs` from the palette in
`src/theme/theme.ts` and wired in `app.json`. The 512×512 Play icon and the
feature graphic are in `store/assets/`. CI fails if a committed image differs
from what the generator draws.

## The 8 phone screenshots

Play shows the first 3–4 in the search result carousel without a tap, so those
three must carry the whole pitch on their own. Order is not cosmetic: it is the
funnel.

Format: 1080×1920 PNG, portrait, real device captures (not mockup frames — Play
allows frames but real captures convert better in this category, where a
skeptical user is checking whether the mushaf looks right). Caption burned into
the top ~18% of the image, over the app's own `#F6F2E9` paper background, in a
weight heavy enough to read at carousel thumbnail size (~44 px tall glyphs).

| # | Screen to capture | Caption (EN) | Caption (AR) | Why here |
|---|---|---|---|---|
| 1 | `app/surah/[id].tsx` in Follow mode, mid-recitation: highlight partway through a line of Al-Baqarah, several words behind already inked, the breathing underline visible on the current word | **The page follows your voice** | **الصفحة تتبع صوتك** | The one sentence the whole app is. Also the first frame in the carousel, so it must work as a thumbnail. |
| 2 | Same screen in Hidden mode, roughly half the page revealed, ghost glyphs visible for the rest, one word mid-hint showing only its first letter | **Hidden mode: say it, and it appears** | **وضع الإخفاء: قلها فتظهر** | Shows hifz, and shows the geometry-stable ghost page that §7 forces — a hafiz recognises immediately that the page has not reflowed. |
| 3 | `src/components/SummaryCard.tsx` / the mistake sheet at end of session: matched count, the missed-word rows, the "heard instead" line | **Every session tells you what you missed** | **كل جلسة تخبرك بما فاتك** | This is the "it corrects me" promise, and the third carousel slot. |
| 4 | Tracker tab (`app/(tabs)/tracker.tsx`) with the 18-week heatmap populated and `HifzPanel` showing due ayahs | **These ayahs, today — weakest first** | **آيات اليوم — الأضعف أولًا** | The retention feature. Sells the reason to come back tomorrow. |
| 5 | A dense mushaf page — page 262 or similar, 15 full lines, an ayah marker and a surah band visible | **The real Madani page. All 604 of them** | **مصحف المدينة كاملًا — 604 صفحات** | Answers the silent question every serious user has: "is the mushaf right?" |
| 6 | Prayer tab (`app/(tabs)/index.tsx`) with a countdown running and the authority line visible ("Beni Mellal, Morocco · وزارة الأوقاف…") | **Your country's own prayer calculation** | **مواقيت بطريقة بلدك الرسمية** | This is genuinely better than the generic-method competition, and the authority string proves it. |
| 7 | Adhkar screen (`app/adhkar.tsx`) or the hadith reader, Arabic with English underneath and the Bukhari/Muslim reference visible | **Bukhari, Muslim and the daily adhkar** | **البخاري ومسلم وأذكار اليوم** | Breadth, and the reference number signals seriousness. |
| 8 | Settings or a plain typographic card on the paper background | **No account. No ads. The Quran works offline.** | **بلا حساب، بلا إعلانات، والمصحف بدون إنترنت** | The close. This is the sentence that beats Muslim Pro for the people who dislike Muslim Pro. |

Two rules for whoever captures these:

- **Capture on a real device with a real recitation in progress**, not a
  simulator with lorem state. Screenshot 1 with a highlight in a plausible place
  mid-ayah is worth more than a perfect empty page.
- **No red anywhere on the Quran text**, in the screenshots as in the app
  (§6.3). A caption in `error` red over a mushaf page would undo the rule the
  whole renderer is built around.

## Feature graphic — 1024×500

Required by Play for every listing, and it is the banner at the top of the store
page and on any Play editorial surface.

- Left 55%: a mushaf page in the app's paper tone `#F6F2E9`, with one line lit
  in `#C9A227` gold and a soft waveform running along that line — the single
  visual metaphor of the product.
- Right 45%: on `#1B4332`, the wordmark and one line — EN **"Recite. It
  follows."** / AR **"اتلُ، وهو يتابعك."**
- No screenshots-inside-the-banner, no device frames, no five-feature grid. It
  is rendered at ~400 px wide on many surfaces.
- Text must stay inside the central safe area; Play crops this asset
  differently across surfaces.

## Promo video (optional, high value here)

15–25 seconds, no narration, no music (music over Quran recitation would be a
serious misstep with this audience). One continuous screen recording: open
Al-Fatiha → recite → watch the highlight track the voice → the page turns. The
mechanic is not believable in a still image, and it is completely believable in
eight seconds of video. If only one extra asset ever gets made after the icon,
make this one.

## Tablet screenshots

Play surfaces a "not designed for tablet" notice when they are missing.
`app.json` locks `"orientation": "portrait"` and there is no tablet layout work
in `src/components/mushafFit.ts` beyond fitting the page, so capture the same 8
on a 7" and 10" emulator only after checking that the mushaf page still fits —
`mushafFit.ts` is the file that decides, and a clipped page in a tablet
screenshot is worse than no tablet screenshot.

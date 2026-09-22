# Which locales to translate into, and in what order

A Play listing translation is cheap and permanent; an app UI translation is
neither. These are two separate decisions and this file keeps them separate.

**Today the app UI is English-only.** There is no i18n layer in `src/`; tab
labels are literal strings in `app/(tabs)/_layout.tsx`. So "add a locale" below
means *listing first, UI when it can be done properly* — and for Arabic those
two must land together (see `store/listing/ar.md`).

## Priority order

### 1. Arabic (`ar`) — do this one properly or not at all
The audience that will judge the app hardest and recommend it fastest. Also the
only locale where the app's own vocabulary (تسميع, مراجعة, ورد) already matches
the product.
- Listing: `store/listing/ar.md`, written, not machine-translated.
- UI: needed. Includes RTL (`I18nManager.forceRTL`) and a layout pass — the
  mushaf renderer is already RTL-correct, but the chrome around it is not.
- Covers Morocco, Egypt, Saudi Arabia, the Gulf, Algeria, Tunisia, Jordan —
  eleven of the country rules already in `REGION_RULES`
  (`src/data/prayerRegion.ts`) are Arabic-speaking.

### 2. Indonesian (`id`) — the largest Muslim population on earth, Android-first
Indonesia is an Android-dominant, price-sensitive, high-install-volume market,
and `REGION_RULES` already resolves it to Kemenag. Install velocity from `id`
moves a global chart faster than the same number of installs from `en-GB`.
- Listing: yes, professionally translated.
- UI: high value, no RTL work, Latin script. This is the cheapest large win.
- Note for the copy: "hafalan Al-Qur'an", "murojaah" and "setoran" are the words
  used there — `murojaah` (مراجعة) and `setoran` (تسميع) map exactly onto what
  this app does. Get a native speaker; do not transliterate from Arabic.

### 3. French (`fr`) — Morocco, Algeria, Tunisia, France
The user's own country is in `REGION_RULES` first (`MA`, Morocco). A large part
of the Maghrebi and French diaspora audience uses phones set to French even
while reciting in Arabic. Small locale, disproportionate fit to this app's
actual first users.

### 4. Urdu (`ur`) — Pakistan
Large, Android-first, and `PK` → Karachi method is already handled. RTL again,
so it rides on whatever the Arabic RTL work produces. Listing first; UI after
`ar` and `id`.

### 5. Turkish (`tr`)
`TR` → Diyanet is already in `REGION_RULES`. Turkish users search in Turkish
almost exclusively ("kuran ezberleme", "hatim takip"), so an English listing is
close to invisible there. Latin script, no RTL, moderate effort.

### 6. English variants: `en-US` is the default; add `en-GB` only for spelling
Play falls back to the default listing, so `en-GB` buys you "memorisation" vs
"memorization" and little else. Do it last, and do it because both spellings are
then indexed — that is the only real reason.

## Deliberately deferred

- **Malay (`ms`)** — Malaysia is in `REGION_RULES` (JAKIM) and is a good market,
  but Malaysian users search in both `ms` and `en`, so the English listing
  already reaches them. Add after `id`, since the copy translates cheaply from it.
- **Bengali (`bn`), Hausa, Somali, Pashto** — real and large audiences, but
  nothing in the app speaks to them yet, and a listing in a language whose users
  then meet an English UI is a rating problem, not a growth one.
- **Hindi, Russian, German, Spanish** — no evidence of fit and no region rules
  beyond `RU`. Skip until the search-terms report says otherwise.

## The honest caveat

I cannot verify market sizes, Play install-volume-by-country, or the search
behaviour in any of these locales from this environment. The ordering above is
reasoned from (a) which countries the app already has prayer-calculation rules
for, in `src/data/prayerRegion.ts`, and (b) widely-repeated facts about Android
share and Muslim population. Treat 2–6 as a hypothesis to test against Play
Console's country-level acquisition report once there is traffic.

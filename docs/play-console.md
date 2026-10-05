# Play Console, screen by screen

Written for a **new personal account**. Google requires those to run a
**closed test with at least 12 testers for 14 days in a row** before the app
can go to production. So the order is:

1. Create the app
2. Answer "App content"
3. Fill in the store listing
4. Upload the bundle to a closed test and invite 12 testers
5. Wait 14 days
6. Apply for production

Console moves its buttons around from time to time. If a label below doesn't
match exactly, look for the closest one. The answers stay the same.

---

## Files you will need

| What | Link |
|---|---|
| App bundle (upload this) | https://github.com/tahachaibi/QURAN1/releases/download/test-build/tasmee-hifz.aab |
| Icon 512×512 | https://github.com/tahachaibi/QURAN1/raw/claude/quran-habit-android-jr6hwv/store/assets/play-icon-512.png |
| Feature graphic 1024×500 | https://github.com/tahachaibi/QURAN1/raw/claude/quran-habit-android-jr6hwv/store/assets/feature-graphic-1024x500.png |
| Texts (English) | `store/listing/en-US.md` |
| Texts (Arabic) | `store/listing/ar.md` |
| Privacy policy URL | https://tahachaibi.github.io/QURAN1/privacy.html |
| Website | https://tahachaibi.github.io/QURAN1/ |
| Contact email | tasmee.app@gmail.com |

---

## 1. Create the app

**Home → Create app**

| Field | Answer |
|---|---|
| App name | `Tasmee Hifz` |
| Default language | English (United States) – en-US |
| App or game | App |
| Free or paid | **Free**. A free app can still add a subscription later; a free app can never become paid. |
| Declarations | Tick both |

---

## 2. App content

**Left menu → Policy → App content** (or the "Set up your app" list on the
dashboard). Answer each section:

**Privacy policy:** `https://tahachaibi.github.io/QURAN1/privacy.html`

**App access:** "All functionality is available without any access
restrictions". There is no login.

**Ads:** No, my app does not contain ads.

**Content rating:** start the questionnaire.

- Email: `tasmee.app@gmail.com`
- Category: **Reference, News, or Educational**
- Every content question: **No**. There is no violence, no sexual content, no
  bad language, no gambling, no drugs and no user-to-user chat. The app does
  not share location with other users, and it has no purchases.

**Target audience and content:** **13–15, 16–17, 18 and over**.

- Ticking any age under 13 puts the app under the Families policy, which
  brings more paperwork. It can be widened later.
- If asked whether the app could unintentionally appeal to children, answer
  honestly. It is a Quran app, so "Yes" is defensible. The only data the app
  collects is approximate location for prayer times, which is optional, so
  there is nothing to change either way.

**News app:** No. **Government app:** No. **Financial features:** none.
**Health:** none.

**Advertising ID:** No. CI fails the build if the advertising-ID permission
ever appears in the app, so this answer stays true.

**Data safety.** This is the one to get right.

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data encrypted in transit? | **Yes** (prayer times are fetched over HTTPS) |
| Account creation | My app does not allow users to create an account |
| Data deletion request URL | none needed: no account, nothing stored off the phone |

Then data types: tick only **Location → Approximate location**.

| For approximate location | Answer |
|---|---|
| Collected | Yes |
| Shared | **No**. Aladhan receives the coordinates only to answer the request. That makes it a service provider, which Play does not count as sharing. |
| Processed ephemerally | **Yes** |
| Required or optional | **Optional**: location is requested only when the user opens the Prayer tab, and they can deny it. The rest of the app works without it. |
| Purpose | **App functionality** |

Do **not** tick audio. The app never sends audio anywhere itself; the speech
recognition is Android's own system service. The privacy policy says this in
its microphone section.

**Exact alarm permission.** This declaration may appear after the first
upload.

- Core use: **"Prayer times: the app plays the adhan (call to prayer) at
  each of the five daily prayer times, which must be exact."**
- If Google refuses it, tell me. The fix is a small code change to the other
  exact-alarm permission, and nothing else in the app has to change.

---

## 3. Store listing

**Left menu → Grow users → Store presence → Main store listing**

| Field | What to enter |
|---|---|
| App name | `Tasmee Hifz: Quran Memorizer` |
| Short description | `It listens while you recite and follows you word by word on the mushaf.` |
| Full description | the block under "Full description" in `store/listing/en-US.md` |
| App icon | play-icon-512.png |
| Feature graphic | feature-graphic-1024x500.png |
| Phone screenshots | at least 2 (send them to me to crop first, see below) |

**Store settings** (same menu):

- Category: **Education**
- Tags: pick from Education / Reference / Religion if offered
- Email: `tasmee.app@gmail.com`
- Website: `https://tahachaibi.github.io/QURAN1/`

**Arabic listing**, optional now:

- Main store listing → **Manage translations → Add your own translation →
  Arabic**.
- Paste from `store/listing/ar.md`.
- Title: `Tasmee Hifz: حفظ وتلاوة القرآن`.

**Screenshots.** Play rejects any screenshot more than twice as tall as it
is wide, and most modern phones are taller than that. Send the originals to
me as files and I'll return them cropped to 1080×2160.

---

## 4. Closed test with 12 testers

**Left menu → Test and release → Testing → Closed testing → Create track**
(or use the default "Alpha").

1. **Countries:** add the countries your testers are in, e.g. Morocco.
2. **Testers:** create an email list called "Testers" and add at least
   **12 Gmail addresses**. These must be the Google accounts on their phones.
3. **Create release:**
   - The first time, it asks about **Play App Signing**. Accept "Use Google
     Play's signing key". This is what makes a lost upload key recoverable.
   - Upload `tasmee-hifz.aab`.
   - Release name: leave the suggested one.
   - Release notes: `First test build.`
4. **Next → Save → Send for review / Start rollout.**
5. Back on the track, copy the **"Join on Android"** link and send it to your
   12 testers. Each one opens it, taps **Become a tester**, then installs
   from Play.

**A phone that already has the test APK from the GitHub link** (yours, at
least) cannot install the Play version over it: the two are signed with
different keys, and Play shows "App not installed". On that phone:

1. Open Settings → **Save a backup** (Arabic: احفظ نسخة احتياطية) and keep the
   file somewhere outside the app, e.g. Drive or WhatsApp to yourself.
2. Uninstall the app, then install it from Play.
3. Open Settings → **Restore from a backup** (Arabic: استرجع من نسخة
   احتياطية) and pick that file.

From then on, testers should use only the Play version, not the GitHub APK.

**The 14 days only count while at least 12 testers are opted in.** Ask them to
keep the app installed and open it now and then. Google also looks at
whether testers actually use it.

---

## 5. After 14 days

The dashboard unlocks **Apply for production**. It asks a few questions
about the test, such as how testers were recruited, what feedback came in
and what changed. Answer plainly. Google then reviews the app, which usually
takes a few days. After approval: **Production → Create release →** reuse
the same bundle or a newer one **→ Rollout**.

---

## Every later update

Every CI build now gets a higher version code automatically, so any new
`tasmee-hifz.aab` from the same link can be uploaded. Play never accepts the
same version code twice. Upload it to the closed track during testing, and
to Production after launch.

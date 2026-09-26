# The three licence questions, and who to ask

Three assets in this app were fine to use while it lived on one phone and become
real questions the moment it is distributed. None of them is a reason to stop
building; all three are reasons to have an answer in writing before the app is
public.

Send all three now. Replies from institutions take weeks, and none of the other
work is blocked while you wait.

## Status

| # | Asset | Sent | Answer |
|---|---|---|---|
| 1 | KFGQPC font | email, 2026-09-26 | waiting |
| 2a | Hadith dataset (GitHub issue) | not yet | — |
| 2b | Hadith translations (sunnah.com) | email, 2026-09-26 | waiting |
| 3 | QUL layout | GitHub issue on TarteelAI/quranic-universal-library, 2026-09-26 (the resource page states no licence) | waiting |

**What QUL says (checked 2026-09-26).** Neither the "KFGQPC V2 layout (1421H
print)" page nor its related resources state a licence. The related resources
are the QPC V2 per-page fonts (`p1-v2` …), and their page is web-integration
instructions only. This app does not use those fonts anyway: it draws the page
in KFGQPC Uthmanic Hafs and takes only the line breaks from the layout. The
`TarteelAI/quranic-universal-library` repository is MIT-licensed, but that
licence covers the site's code, and its README says nothing about the data. So
the GitHub issue in `03-qul-layout.md` is the right next step.

Follow up once, politely, if nothing has come back by 2026-10-24 (four weeks).

**What the dataset itself says (checked 2026-09-26).** `AhmedBaset/hadith-json`
has no LICENSE file, and its README says only that the data was scraped from
sunnah.com. It names no translator or publisher. The English shipped in this
app matches, word for word, the translations sunnah.com publishes: Muhammad
Muhsin Khan's for Bukhari (hadith 1 opens "Narrated 'Umar bin Al-Khattab: I
heard Allah's Messenger (ﷺ) saying, 'The reward of deeds depends upon the
intentions…'") and Abdul Hamid Siddiqui's for Muslim (the "b." for "ibn" is
his). Both are published translations with their own publishers. The dataset
author cannot grant rights in them, so the sunnah.com letter (2b) is the one
that can actually settle this. The GitHub issue (2a) still costs nothing, and
it leaves a public record of having asked.

## I could not verify the email addresses

This is worth saying plainly rather than burying: the machine these drafts were
written on cannot reach the open internet, so **every address below has to be
taken from the organisation's own site before you send.** An invented address is
worse than none — it sends your correspondence to a stranger who now has a
letter about your app.

For two of the three, the right channel is a public issue tracker rather than
email, which needs no address at all.

| # | Asset | Where to find the channel |
|---|---|---|
| 1 | KFGQPC Uthmanic Hafs font | `qurancomplex.gov.sa` → Contact / اتصل بنا. The font itself came from `fonts.qurancomplex.gov.sa`. |
| 2 | Hadith English translations | A GitHub issue on `github.com/AhmedBaset/hadith-json/issues` **and** the contact page of `sunnah.com`. |
| 3 | QUL mushaf layout | `qul.tarteel.ai` — the resource's own page carries its licence; the site's contact or its GitHub project for anything unclear. |

## What a useful answer looks like

You are not asking for a favour or a contract. You are asking one factual
question each, and the answer you need is short enough to fit in a reply:

1. **Font** — may an app that bundles the font whole and unmodified be
   distributed free of charge, and separately, may that app charge for unrelated
   features?
2. **Hadith** — who holds the English translation copyright, and may it be
   redistributed inside a free app with attribution?
3. **Layout** — which licence covers the specific export, and what attribution
   does it require?

## What to do with each outcome

**A clear yes** — record it in `docs/decisions.md` with the date and who said
it, and add the attribution they ask for.

**A clear no** — that is useful, not a disaster, and each has a way out:

- *Font*: the app falls back to Amiri for ayah text. It will look less like the
  printed mushaf and everything will still work.
- *Hadith*: regenerate Arabic-only. `scripts/gen-hadith.mjs` already parses both
  fields; dropping the English is a small change, and the Arabic is classical
  text that is nobody's to license.
- *Layout*: the page and line breaks go back to being computed rather than the
  real printed ones. Worse, not fatal.

**No reply at all**, which is the likeliest outcome for at least one of them —
wait a reasonable time, send one polite follow-up, and then make a decision with
the silence recorded in `docs/decisions.md`. Silence is not permission, but a
documented good-faith attempt is a very different position from never having
asked. For the two on public issue trackers, the thread itself is the record.

## Before you send

Replace `[YOUR NAME]` and `[YOUR EMAIL]` in each draft. Keep them short —
these are written to be read by a busy person and answered in two lines, and
every paragraph you add lowers the chance of a reply.

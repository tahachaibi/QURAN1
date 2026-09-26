# The three licence questions, and who to ask

Three assets in this app were fine to use while it lived on one phone and become
real questions the moment it is distributed. None of them is a reason to stop
building; all three are reasons to have an answer in writing before the app is
public.

Send all three now. Replies from institutions take weeks, and none of the other
work is blocked while you wait.

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

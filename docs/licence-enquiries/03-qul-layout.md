# 3 — The QUL mushaf layout

**Channel:** `qul.tarteel.ai`. Start with the resource's own page — QUL states a
licence per resource, and `docs/mushaf-layout.md` already says so: *"QUL
resources are mostly community-contributed and vary: some public domain, some
under a specific licence. Their FAQ tells you to check per resource, so this
step is the one that actually matters."*

**Check the page before you send anything.** This is the one of the three most
likely to be answered already, in writing, on the resource you downloaded — in
which case there is no email to send, only a line to copy into
`docs/decisions.md`.

**What is at stake:** the export `qpcv215lines.db` — QCF V2 (1421H print), 604
pages, 15 lines, 9,046 line records — is what makes the app's pages the real
printed pages, with the real line breaks, rather than a plausible-looking
approximation. It is the difference between a mushaf and a text viewer.

---

## If the resource page does not say

> **Subject:** Licence and attribution for the QCF V2 15-line mushaf layout export
>
> Assalamu alaikum,
>
> Thank you for QUL — having the mushaf layouts available as clean, structured
> data rather than something to be reverse-engineered from images is a real
> service.
>
> I have used the **QCF V2 (1421H) 15-line layout** export in a free, offline
> Android app for reading and memorising the Quran. It gives the app the real
> page boundaries and line breaks, so a page on screen is the page as printed.
> I verified the export against my own word array before trusting it: 604 pages,
> every page non-empty, line counts matching, and no gaps or overlaps in the id
> space.
>
> I could not find a licence stated for this particular resource, so before I
> distribute the app I would like to ask directly:
>
> 1. What licence applies to this export?
> 2. What attribution would you like shown in the app, and in what wording?
>
> I am happy to credit QUL and the original contributor wherever you prefer.
>
> Jazakum Allahu khayran,
>
> [YOUR NAME]
> [YOUR EMAIL]

---

## If the answer is no, or never comes

The app computes its own pagination instead. This is the least painful of the
three fallbacks technically and the most visible to a reciter: line breaks stop
matching the printed mushaf, so somebody memorising by page position loses the
visual anchor they have built their memory on. For a memorisation app that is a
real cost, which is why it is worth asking properly rather than assuming.

Note that `scripts/analyse-mushaf-layout.mjs` and the four checks in
`gen-mushaf-lines.mjs` already prove the data is *correct*. This question is
only about whether it may be *redistributed*.

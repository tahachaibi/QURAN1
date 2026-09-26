# 2 — The hadith English translations

**This is the most serious of the three**, and the only one where the app
currently ships something whose terms are genuinely unknown rather than merely
unconfirmed.

`docs/hadith.md` records it: the dataset is `AhmedBaset/hadith-json`, scraped
from sunnah.com, and **the repository carries no licence file at all**. The
Arabic is classical text and is nobody's to license. The English is not — those
translations were made by identifiable translators and published by identifiable
publishers, and they are 14,734 narrations' worth of someone's work.

Two messages, because they answer different halves of the question.

---

## 2a — A public issue on the dataset

**Channel:** `https://github.com/AhmedBaset/hadith-json/issues` — no address
needed, and the thread is its own record of having asked.

> **Title:** What licence applies to this dataset, particularly the English translations?
>
> Thank you for assembling and publishing this dataset — it is far more usable
> than scraping sunnah.com directly, and the per-book structure saved me a great
> deal of work.
>
> I am using the Bukhari and Muslim files in a free, offline Android app for
> reading the Quran and hadith. Before I distribute it I want to be certain
> about the terms, and I cannot find a LICENSE file in the repository.
>
> Two questions:
>
> 1. Is there a licence for the dataset as a whole that I have missed?
> 2. More specifically, do you know the provenance of the **English
>    translations**? The Arabic is classical text, but the English is
>    translators' work, and I would like to attribute it correctly — or drop it
>    and ship Arabic only, if that is the right thing to do.
>
> Whatever the answer, I would rather know than assume. If it would help, I am
> happy to contribute whatever you tell me back as a note in the README so the
> next person does not have to ask.
>
> [YOUR NAME]

---

## 2b — sunnah.com

**Channel:** the contact page on `sunnah.com`. Take the address from that page.

> **Subject:** Permission and attribution for the English translations in a free hadith app
>
> Assalamu alaikum wa rahmatullahi wa barakatuh,
>
> I am building a free, offline Android application for reading the Quran, and
> it also includes the full texts of **Sahih al-Bukhari and Sahih Muslim** —
> 14,734 narrations, Arabic with an English translation beneath each one, each
> showing its collection and number so any of it can be checked against print.
>
> The texts came from a public dataset derived from sunnah.com. Before I
> distribute the app I want to be certain about the English translations
> specifically, and I would be grateful for your guidance:
>
> 1. Who holds the copyright in the English translations of Bukhari and Muslim
>    as published on sunnah.com?
> 2. May they be redistributed inside a free application, with attribution?
> 3. If so, what attribution would you like shown, and where?
>
> The app is free, has no advertising, and no account. If the answer is that the
> translations may not be redistributed, I will ship the Arabic only — I would
> much rather do that than use someone's work without permission.
>
> Jazakum Allahu khayran for sunnah.com, which is a service to a great many
> people.
>
> [YOUR NAME]
> [YOUR EMAIL]

---

## If the answer is no, or never comes

Ship Arabic only. `scripts/gen-hadith.mjs` already reads both fields from the
source, so dropping the English is a small, contained change to the generator
plus a regeneration — and it roughly halves the 22 MB the two collections
occupy, which is most of the app's download size.

The honest reading of silence here is stricter than for the font. The font ships
with its licence written inside it and the app demonstrably complies; the
translations ship with nothing at all. If nobody answers, **going Arabic-only
before publishing is the defensible choice**, and it is a small change.

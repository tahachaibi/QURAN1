# Adhkar text, as supplied

The two files in this directory are the *input* to `scripts/gen-adhkar-text.mjs`.
They exist because www.islambook.com cannot be reached from the machine this app
is built on — the egress proxy answers 403 to CONNECT for that host, an
organisation policy denial — so the text is supplied by hand instead of fetched.

Keeping the supplied text in the repo rather than only the generated JSON is the
point: what is on screen can always be diffed against what was actually handed
over, and the generator can be re-run and re-checked at any time.

## Format

One dhikr per block, blocks separated by a **blank line**. Inside a block:

- a line giving how many times it is said, if it is more than once. Any of these
  work: `×3`, `x3`, `3 مرات`, `(ثلاث مرات)`, `تكرارها: 3`
- the Arabic text itself, over as many lines as it takes
- optionally a line starting with `//` for a note to show under it

Lines starting with `#` are comments and are ignored, except the two headers the
generator reads:

    # title: أذكار الصباح
    # source: https://www.islambook.com/azkar/1/...

## Example

    # title: أذكار الصباح
    # source: https://www.islambook.com/azkar/1/أذكار-الصباح

    ×3
    أَعُوذُ بِاللهِ مِنَ الشَّيْطَانِ الرَّجِيمِ

    اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ
    // whatever note belongs under this one

Nothing about the text is rewritten by the generator: it strips the count marker
and the comment lines, collapses runs of whitespace, and stores the rest exactly
as given.

# Acceptance test log (spec §12)

Fill this in on a real device, reciting aloud, with the debug overlay ON
(Settings → Diagnostics → Show debug overlay). Any "mostly" is a **fail** —
write what was wrong instead of rounding it up.

Device: ______________  Android version: ______  App build (sha): ____________
Recognizer strategy shown in overlay: ____________  Arabic pack: ____________

---

### 1. Al-Fatiha, Follow mode, natural speed
Every word marks within ~300 ms; **zero** false mistakes.

**Half of this is now proved, on real data.** A recitation of 1:1–1:7 captured on
a phone on 2026-08-26 is `__tests__/fixtures/device-fatiha-full.json`, and
replayed through the real engine it reaches **cursor 29 of 29, all 29 words
matched, zero mistakes, one clean run of 29**, with the cursor never once moving
backwards. It survived two things I had not put in any hand-written fixture: the
recognizer restarting its transcript from empty twice mid-surah, and segment 2
opening on "الرحمن الرحيم" — a phrase that also sits four words behind in 1:1 and
could have dragged the cursor back to it.

What that does **not** prove is what you saw: whether the highlight actually
moved on screen, and how far behind your voice it felt. The engine matching a
transcript and the page keeping up with a voice are two different claims. So this
box still needs your eyes and your ears.

- [ ] pass  - [ ] fail
- Words that lagged noticeably: ______________________________________
- False mistakes (word, and what you actually said): _________________
- Overlay `engine latency` reading: ______ ms

### 2. Al-Fatiha, Hidden mode
Words reveal as recited; **page geometry never shifts**; hint ladder works
(first tap = first letter, second tap = whole word).

- [ ] pass  - [ ] fail
- Did the line ever jump or reflow when a word revealed? ______________
- Did the first tap show only the first letter? _______________________

### 3. Mid-verse breath
Stop, breathe, resume from a few words earlier. `livePos` follows back,
**revealed words stay revealed**, no mistakes logged.

- [ ] pass  - [ ] fail
- Did anything un-reveal? ____________________________________________
- Mistakes logged during the restart: ________________________________

### 4. Open Al-Fatiha, recite 2:6 WITHOUT basmala
Lands on 2:6 within ~1 s **and keeps following you through the rest of the
verse**. No screen flash, no freeze on the first word, mic never drops.

- [ ] pass  - [ ] fail
- Roughly how long until it landed? ______
- Did it keep following after landing, or stall on the first word? ____
- Overlay `jump` line at the moment it moved: ________________________

### 5. Same as 4, WITH basmala
- [ ] pass  - [ ] fail
- Notes: _____________________________________________________________

### 6. Recite continuously across the end of a surah into the next
No interruption of any kind.

- [ ] pass  - [ ] fail
- Which boundary did you try? ____ → ____
- Notes: _____________________________________________________________

### 7. Swipe from Al-Baqarah page 1 backwards into Al-Fatiha
"Return to my place" chip appears and works.

- [ ] pass  - [ ] fail
- Notes: _____________________________________________________________

### 8. Deliberately misread one word
Flagged **once**, correctly, **after** you pass it — not while you're still on
it. "I said it right" removes it permanently.

- [ ] pass  - [ ] fail
- Which word did you misread, and what did you say instead? __________
- Was it flagged while you were still on it? _________________________
- Did it come back after dismissing? ________________________________

### 9. Recite for 5 minutes straight
No deafness, no drift, no memory growth, no battery cliff; screen stays awake.

- [ ] pass  - [ ] fail
- Did it ever stop hearing you? At roughly what minute? ______________
- Overlay `watchdog restarts` after 5 min: ______
- Overlay `relay gap` after 5 min: ______ ms
- Did the screen dim or sleep? _______________________________________
- Battery % before ______ after ______

### 10. Kill the network mid-session (airplane mode)
Recitation tracking is unaffected.

- [ ] pass  - [ ] fail
- Did tracking change at all? ________________________________________
- Any scary error dialog? ____________________________________________

---

## Anything else you noticed

Free-form. Things that felt wrong, slow, ugly, or confusing are as useful to me
as a failed test.

_____________________________________________________________________
_____________________________________________________________________

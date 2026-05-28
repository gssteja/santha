---
name: santha-voice
description: >
  Naming and personality guide for all Santha apps. Apply when naming a new app,
  writing in-app copy, prompts, empty states, error messages, onboarding text, or
  any user-facing string. Indian-inflected, witty, dark, sassy. Refuses to be
  motivational-poster cheerful. Invoke before building any new app or writing copy.
---

# Santha Voice

## What it is

Indian. Witty. Dark. Sassy. The voice of a desi elder who loves you but will absolutely call you out — not cruel, just honest in the way only your aunty can be. Knows your excuses before you make them. Has opinions. Uses silence well.

**Not:** motivational poster, startup bro, hustle culture, British formal, cringe meme.
**Yes:** street-smart, a little tired, culturally specific, sharp.

---

## App Naming

Names come from Hindi/Urdu/Tamil words, desi idioms, or dark-English with subcontinental flavour.

| App type | Name options | Why |
|----------|-------------|-----|
| Workout | **Kasrat** (exercise/effort in Urdu) | Exact word. Sounds hard. |
| Habit | **Roz** (every day) or **Aadat** (habit) | Short, honest |
| Timer | **Ab** (now) | Demanding |
| Notes | **Kagaz** (paper) | Grounded |
| Finance | **Hisaab** (accounting/reckoning) | Implies judgment |
| Sleep | **Neend** (sleep) | Blunt |
| Food | **Pet** (stomach, literally) | Rude but accurate |

**Rules:**
- 1–2 syllables preferred. No camelCase. No exclamation marks in name.
- If English, must have an edge: "Dard" not "Pain", "Kal Se" not "Tomorrow", "Chal" not "Go".
- Avoid: words that mean "app", "tracker", "pro", "plus", "smart".

---

## In-App Copy Voice

### Personality traits
1. **Knows your excuses** — pre-empts them, doesn't baby you.
2. **Desi elder energy** — warm underneath but won't say it directly.
3. **Dark-optimistic** — acknowledges the suffering, proceeds anyway.
4. **Sarcastic but not mean** — the difference between "finally" and "loser".
5. **Culturally specific** — chai, amma, Sharma ji ka beta, log kya kahenge, IIT-pressure energy. Use sparingly but land it.

### Copy patterns

| Moment | Generic (avoid) | Santha voice |
|--------|----------------|--------------|
| Empty state (no workouts) | "No workouts yet! Start your journey." | "Nothing here. Kal se toh sab bolte hain." |
| Start workout | "Let's go! You got this!" | "Finally." |
| Set logged | "Great job! Keep it up!" | "Done. Log the next one." |
| Rest timer | "Rest up!" | "90 seconds. Don't waste them thinking about chai." |
| Finish workout | "Amazing work today!" | "That's it. Go eat something, you've earned it." |
| Rest timer done | "Time to get back!" | "Enough. Back to work." |
| Long rest | "Take your time!" | "You're resting, not sleeping. Come on." |
| Streak | "You're on a streak!" | "X days. Don't break it now, what will people say." |
| No history | "Log your first workout!" | "No history. Acchi baat hai — nothing to be ashamed of yet." |
| Error | "Something went wrong." | "Something broke. Very on-brand." |
| Slow load | "Loading..." | "Ruk." |

### Tone calibration

- Short sentences. Fragments OK.
- Imperatives over suggestions. "Log it." not "You can log it here."
- Humour via understatement, not exclamation.
- 1 desi reference per screen max. More = try-hard.
- Never use: "Amazing", "Awesome", "Let's go!", "You've got this", "Crush it", "Beast mode".

---

## App personality in code

When generating in-app strings, always pull from this file first. The voice must be consistent across:
- Button labels
- Empty states
- Timer labels
- Finish/confirm dialogs
- Onboarding
- Error states
- Notification copy (if any)

---

## Reference phrases (copy freely)

```
Kal se toh sab bolte hain.       (Everyone says "starting tomorrow")
Log kya kahenge.                 (What will people say — use as dark motivation)
Ruk.                             (Wait / hold on)
Chal.                            (Come on / let's go)
Bas.                             (Enough / that's it)
Thoda aur.                       (A little more)
Sharma ji ka beta kar leta hai.  (Sharma ji's son manages it — competitive pressure)
Jugaad.                          (Improvised fix — use for workaround states)
Acchi baat hai.                  (Good thing — ironic usage works well)
Ho jayega.                       (It'll happen / it'll be done)
```

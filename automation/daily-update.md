# Daily brand update — standing brief for the scheduled Claude layer

You are running the daily automated update of Stuart Crowley's personal
brand engine (this repo). The deterministic pass (`node
scripts/ideas-bank.mjs`) has already refreshed the ideas bank and
`data/strategy.json`. Your job is the judgement layer on top. Work
inside this repo only; read `CLAUDE.md` first and obey every rule in it.

## Do, in order

1. `node scripts/ideas-bank.mjs` if it has not run today
   (`data/strategy.json` → `generatedAt`).
2. Read the current state: `node scripts/today.mjs`, plus
   `data/strategy.json`, the open raw-ideas in `data/content.json`, the
   three pillars in `data/lanes.json`, recent insights, and the live
   calendar week.
3. **Sharpen the ideas bank.** For the 3 strongest raw-ideas (prefer
   starving pillars: check the pillar rollup), write a one-line hook and
   a `pov` onto the content item. British English, Stuart's voice
   (`data/voice/stuart-voice.md`), no em dashes. Lint anything you write
   with `lib/voice.mjs`. Do not fabricate facts, numbers or names; leave
   `[bracketed slots]` where Stuart's real material is needed.
4. **Refresh the strategy notes.** Append at most 3 items to
   `claudeNotes` in `data/strategy.json` (shape: `{date, note}`), each a
   specific, non-generic recommendation on WHERE or WHAT to post:
   pillar balance, a channel worth using this week and why, an angle the
   bank is missing, a verification gate to respect, a repurpose worth
   doing. Trim `claudeNotes` to the newest 10.
5. **Flag, never act.** No sending, no publishing, no outreach drafting
   to new contacts, no lead conversion, no deleting records. Suggestions
   land as data for Stuart to act on.
6. Run `node scripts/self-test.mjs` (it is hermetic). If it fails
   because of YOUR change, fix or revert; if it fails for a pre-existing
   reason, note it and do not force anything.
7. Commit `data/` with message `Daily brand update: ideas bank + strategy
   (automated)` and push.

## Hard rules (violating any of these is a failed run)

- Never run `scripts/seed.mjs --force` (real data lives in `data/`).
- Never invent statistics, client names, familiarity or pipeline values.
- Never weaken approval gates or touch `scripts/serve.mjs` safety code.
- NEXT.io-confidential material never enters public-safe output (R8).
- Keep the whole run additive: new ideas and notes, no rewrites of
  Stuart's own records.

# Strait Up Growth engine — working notes for Claude

Stuart Crowley's personal-brand / authority / outreach / pipeline OS for
**Strait Up Growth** (his consultancy). Local-first, zero dependencies.
Read `README.md` and `docs/ARCHITECTURE.md` before changing anything.

## The rules that matter

- **The system never sends or publishes.** Drafts end at `approved`;
  Stuart acts by hand and records it (`mark-sent` / `mark-published`).
  Never weaken these gates or the do-not-contact guard in
  `scripts/serve.mjs`.
- **Confidentiality (next-os R8 mirrored):** NEXT.io deals, margins,
  pipeline and people never enter public or Strait Up Growth output.
  `lib/confidentiality.mjs` suggests, Stuart confirms.
- **Never fabricate**: no invented emails, statistics, familiarity, client
  results or pipeline values. The mock AI provider writes bracketed slots
  instead of facts; keep it that way.
- **Voice:** `data/voice/stuart-voice.md` is the bible (copied from
  nextpredict-engine — keep the OFF_VOICE list in `lib/voice.mjs` in
  lockstep with that repo's `scripts/lint-drafts.mjs`). No em dashes, no
  hype phrases, no negative parallelism. "The part I keep coming back to"
  is banned even though old prompt material suggests it.
- **Offers/positioning are draft assumptions** until Stuart confirms them
  in the app. Do not present them as fact and do not attach invented proof.
- **Fictional seed data** carries `fictional: true`. `scripts/seed.mjs`
  refuses to overwrite non-fictional records without `--force`. Once
  Stuart starts entering real records, never re-seed with `--force`.

## Daily use

```bash
npm run dev      # the command centre on :4173
npm run today    # terminal briefing
npm test         # 36-check self-test (re-seeds; only safe while data is fictional)
```

## Process

- Develop on the assigned feature branch; commit data changes (git IS the
  database — uncommitted data dies with the container).
- Run `npm test` after any change to lib/, scripts/serve.mjs or seed.mjs.
  Note it re-seeds `data/`; once real data exists, back it up first or
  point the test at a scratch copy.
- Scores are opinions with editable weights (`data/settings.json`); if
  Stuart disagrees with a score, tune weights or `lib/scoring.mjs`, don't
  hand-edit stored score objects.

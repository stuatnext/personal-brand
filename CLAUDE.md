# Stuart Crowley's personal brand engine — working notes for Claude

Stuart's personal-brand / authority / outreach / pipeline OS. Strait Up
Growth (his consultancy) is ONE of four brand workspaces inside it
(Stuart personal, Strait Up Growth, NEXT.io, NEXTPredict). Local-first,
zero dependencies. Read `README.md` and `docs/ARCHITECTURE.md` before
changing anything.

## The daily job: ingest what Stuart drops

When Stuart hands over intel (notes, ZIPs, HTML captures, JSONL), run:

```bash
node scripts/ingest.mjs <path> [--source "label"]   # --dry-run to preview
```

Lossless raw text, hash-dedupe, confidentiality review, lane tags, entity
matches, candidate-entity list (research, never invent). Then distil the
strongest insights and draft channel versions (LinkedIn / X / Substack;
`repurpose` action rebuilds per channel, never copies). Commit `data/`
after — git is the database.

Ingestion also detects LEADS (buying signal + entity in the same drop):
funding, leadership hires, SEA expansion, CRM pain, explicit demand,
prediction-market launches/compliance hires. They queue in
`data/leads.json` → #/relationships. Convert creates only evidence-backed
skeleton records; extend `LEAD_SIGNALS` in `scripts/ingest.mjs` whenever a
real lead pattern repeats.

## The three authority pillars (never let them starve)

1. Strait Up Growth: AI, commercial & marketing strategy, operational
   efficiency — specifically Singapore & SEA.
2. Prediction markets.
3. iGaming & sports betting (the NEXT.io positioning). Sportsbook/casino
   vocabulary is fine here and in Stuart-personal copy; it stays BANNED in
   NEXTPredict copy (lib/voice.mjs enforces per-brand).

Lane tiers live on `data/lanes.json` (`tier: core|supporting`,
`pillar`). Core lanes are weighted up in scoring/Today/analytics; keep
new lanes tiered honestly and don't mark colour lanes core.

## Real data now lives in data/ — protect it

The NEXTPredict master social schedule (103 items) is REAL data in
`data/calendar.json` (source archived in `intel/`). NEVER run
`seed.mjs --force` on real data; use `--config-only --force` to refresh
lanes/brands/channels/prompts without touching records. The self-test is
hermetic (scratch ENGINE_DATA_DIR) and safe to run any time. Schedule
updates re-import with `scripts/import-schedule.mjs` (dedupes by
date+topic).

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
- **Voice:** Stuart's own LLM voice pack
  (`data/voice/llm-voice-pack-2026-07-15/` — voice guide, platform
  playbook, approved examples) is the newest canon and wins where it
  differs from `data/voice/stuart-voice.md` (the 2026-07-03 bible). Keep
  the OFF_VOICE list in `lib/voice.mjs` in lockstep with both and with
  nextpredict-engine's `scripts/lint-drafts.mjs`. No em dashes, no hype
  phrases, no negative parallelism; "inflection point", "this
  highlights", "broader trend" are hard-banned per the pack. Every social
  topic gets three platform versions (LinkedIn / Forum / X), never
  duplicated copy.
- **Offers/positioning are draft assumptions** until Stuart confirms them
  in the app. Do not present them as fact and do not attach invented proof.
- **Fictional seed data** carries `fictional: true`. `scripts/seed.mjs`
  refuses to overwrite non-fictional records without `--force`. Once
  Stuart starts entering real records, never re-seed with `--force`.

## The daily automation (ideas bank + posting strategy)

`node scripts/ideas-bank.mjs` is deterministic and safe to run any time:
it tops up a capped bank of post ideas (content items in `raw-idea`, each
with `generatedKey` + rationale; archiving one stops regeneration;
confidential insights never enter) and regenerates `data/strategy.json`
(7-day channel plan from the real calendar, themes per pillar, gaps,
verification gates, suggestions). It surfaces on the Today view.

The judgement layer on top is the scheduled Claude run working
`automation/daily-update.md` (invoked by the `daily-brand-update` GitHub
Actions workflow when the ANTHROPIC_API_KEY secret is set, and/or a
Claude Routine). Its contract: sharpen the 3 strongest ideas, append at
most 3 `claudeNotes` to the strategy doc, commit `data/` only, never
send or publish, never seed --force.

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

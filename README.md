# Strait Up Growth — Authority & Outreach Engine

Stuart Crowley's personal commercial operating system: one place that turns
real operating experience into insights, credible content, warm
relationships, honest outreach, and a tracked Strait Up Growth pipeline —
and measures whether any of it produces **qualified commercial
conversations** (never impressions).

The central flow the whole app is built around:

```
experience & insight → content & IP → audience & relationships
   → conversation → opportunity → commercial outcome → learning
```

## Run it

No install step. Requires Node ≥ 20 (zero npm dependencies).

```bash
npm run dev        # → http://localhost:4173
npm run today      # the daily briefing in the terminal
npm test           # end-to-end self-test (36 checks, re-seeds after)
npm run seed       # restore the fictional demo dataset (refuses to clobber real data)
```

Optional live AI drafting: `ANTHROPIC_API_KEY=... npm run dev`
(model override: `ANTHROPIC_MODEL`, default `claude-sonnet-5`). Without a
key the **mock provider** produces clearly labelled structural scaffolds
and never invents facts, so the whole system works offline.

## What's inside

| Area | Where | What it does |
|---|---|---|
| Today | `#/today` | 3–7 prioritised actions, each with why / why-now / next step / confidence, plus Focus Mode (one action at a time) and a "stop doing" recommendation |
| Insights | `#/insights` | lossless capture (`c` from anywhere) → mandatory confidentiality review → AI distillation → routing to content/outreach |
| Content | `#/content` | idea → draft → review → approved → published pipeline; voice linter; explainable 12-criterion scorecard (48+/36 thresholds, editable) |
| Calendar | `#/calendar` | 4-week editorial calendar; flags a lane repeated within a week |
| Relationships | `#/relationships` | engagement inbox + evidence-based relationship strength (never a bare number); repeat engagers surfaced |
| Outreach | `#/outreach` | draft-only engine: real reason + value + evidence required; 7-factor 0–100 qualification score; approval gate; Stuart sends by hand and records it |
| Opportunities | `#/opportunities` | 9-stage pipeline; values/probabilities entered by Stuart only; honest attribution (direct / strong / supporting / no-proven-influence) |
| Offers | `#/offers` | the 6 draft Strait Up Growth offers — **all flagged draft assumptions until confirmed** |
| Analytics | `#/analytics` | executive scorecard, explainable authority score (0–100, 8 weighted components), lane/content/outreach/pipeline intelligence |
| Reviews | `#/reviews` | weekly authority review drafted from the records; monthly strategic review |
| Knowledge | `#/knowledge` | voice rules (approved vs proposed), teach-by-edit rule extraction, knowledge base the AI retrieves before drafting |
| Settings | `#/settings` | accent colour, all score weights and thresholds, audit log |

## Architecture (deliberate)

Local-first, dependency-free Node, matching the proven house pattern of
Stuart's other working repos (nextpredict-engine, next-os):

```
data/*.json        the database — git is the persistence layer
lib/               store, voice linter, confidentiality filter, scoring,
                   recommendations, analytics, AI provider abstraction
scripts/serve.mjs  pure-Node HTTP server: REST API + static app
app/               the command centre (vanilla JS, hash routing)
```

Why not Next.js + Supabase (as the original prompt suggested): the prompt
itself said *"use this stack unless the repository already provides a
better supported stack."* The house stack runs anywhere Node runs, needs no
external database, survives ephemeral containers via git, and Stuart
already operates two systems built this way. Full reasoning:
`docs/ARCHITECTURE.md`. Schema: `docs/DATA-DICTIONARY.md`.

## Safety and integrity rules (enforced in the server, not the UI)

- **Nothing is ever sent or published by the system.** Outreach and content
  end at *approved*; Stuart acts by hand, then records the act. The
  `mark-sent` / `mark-published` endpoints reject unapproved records, and
  generic PATCH/POST cannot smuggle a record into a sent/published stage.
- **Do-not-contact is absolute**: suppressed contacts cannot be drafted to,
  approved, or recorded as sent.
- **Confidentiality filter** (mirrors next-os rule R8): every insight gets
  a suggested classification with reasons; drafting content from
  private/strictly-confidential insights is blocked; the brand gate flags
  NEXT.io material appearing in Strait Up Growth output.
- **No invented anything**: the mock provider writes `[bracketed slots]`
  instead of fabricating facts; unknown emails stay unknown; the engine
  never sets a pipeline value; unverified claims are marked.
- **Voice linter** blocks em dashes, Stuart's banned phrases (including
  "the part I keep coming back to" — banned by his own linter even though
  older prompt material suggested it), negative parallelism, fake
  familiarity in outreach, and betting/gambling vocabulary in NEXTPredict
  copy.
- **Every score is explainable**: components, evidence, missing data, and
  editable weights. Scores are suggestions, never verdicts.
- **Audit log** on every write; soft deletes; fictional seed data flagged
  `fictional: true` on every record and bannered in the UI.

## Demo data

`npm run seed` loads a fully fictional dataset (25 contacts, 12 companies,
20 insights, 16 content items, 12 engagements, 11 outreach records, 8
opportunities, 8 tasks, 10 knowledge items, a 4-week calendar, weekly +
monthly reviews) that demonstrates the complete flow, including a
deliberately weak outreach draft (scores "do not send"), a suppressed
contact, and an employer-confidential insight the filter catches. Seeding
refuses to overwrite non-fictional records unless `--force`.

## Integrations

| Integration | Status |
|---|---|
| Anthropic API | **implemented** (env key), with a safe mock fallback |
| Gmail / Outlook drafts | not built — deliberate; Stuart copies approved messages into his own client, keeping the human-send guarantee. A draft-to-mailbox path is a next-phase candidate |
| Calendar | not built — meetings are logged as interactions for now |
| LinkedIn | manual import only, by design (no scraping, ever) |
| CSV import/export | not built yet (next phase) |

## Known limitations / next build priorities

1. CSV import/export for contacts and opportunities.
2. A draft-to-mailbox integration (approval-gated) once Stuart picks Gmail
   or Outlook for Strait Up Growth.
3. Monthly strategic review generator (weekly exists; monthly is seeded
   but not yet auto-drafted).
4. Editorial-calendar → content-item linking flow (calendar slots exist;
   one-click "start this slot" is manual today).
5. Relationship map / warm-intro paths (data supports it; no visual yet).

## Assumptions Stuart should confirm

See `docs/ASSUMPTIONS.md` for the full list. The big ones: the six offers
and all positioning language are **drafts**; the authority-lane taxonomy
(15 lanes) is the prompt's suggestion; score weights/thresholds are
defaults; SGD is the default currency; "qualified conversation" needs
Stuart's written definition (there's a seeded insight holding that
question).

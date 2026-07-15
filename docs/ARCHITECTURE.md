# Architecture

## The decision

The build prompts proposed Next.js + TypeScript + Supabase, and also said:
*"Use this stack unless the repository already provides a better supported
stack."* The repository ecosystem does. Stuart's two working systems
(nextpredict-engine, next-os) are both **buildless Node + JSON-in-git +
static/local HTML**, run daily from Claude Code sessions in ephemeral
containers. That environment has no persistent Postgres, no Supabase, and
no long-lived server. A Next.js/Supabase app would demo well and then be
unrunnable in the place Stuart actually works.

So the engine is **local-first and dependency-free**:

```
sources (Stuart's notes, engagements, replies)
   → app/ capture UI  or  API  or  hand-edited JSON
   → data/*.json                (the database; git is persistence)
   → lib/*.mjs                  (deterministic engines)
   → scripts/serve.mjs          (pure-Node HTTP: API + static app)
   → app/                       (the command centre)
   → Stuart acts (posts, sends, meets) → records the act → learning loops
```

Trade-offs accepted, deliberately:

- **Single user, no auth.** The server binds to 127.0.0.1 only. Stuart is
  the only user (same as next-os). Auth arrives if/when this is ever
  deployed beyond localhost, and not before.
- **No reactive framework.** Vanilla JS re-renders views from state. At
  this data volume (hundreds of records) that is instant, debuggable, and
  has zero supply-chain surface.
- **JSON files, not SQL.** Referential integrity is by convention (id
  prefixes, `lib/store.mjs` accessors) and exercised by the self-test.
  If the data outgrows this (thousands of contacts), SQLite via
  `node:sqlite` is the upgrade path; the store module is the only thing
  that changes.

## Modules

| File | Responsibility |
|---|---|
| `lib/store.mjs` | collections, atomic writes, soft delete, audit log, ids |
| `lib/voice.mjs` | the voice linter: OFF_VOICE list (kept in lockstep with nextpredict-engine's `lint-drafts.mjs`), parallelism, brand vocabulary, fake familiarity, formatting |
| `lib/confidentiality.mjs` | 4-tier classification with explainable reasons; anonymisation checklist; the cross-brand gate (next-os R8) |
| `lib/scoring.mjs` | relationship strength, 12-criterion content scorecard, 7-factor outreach qualification, 8-component authority score — all explainable, all weights in `data/settings.json` |
| `lib/recommend.mjs` | the Today engine: composes and ranks actions with why/why-now/next-step, plus the stop-doing recommendation |
| `lib/analytics.mjs` | scorecard, lane/content/outreach/pipeline intelligence, honest attribution classes |
| `lib/ai.mjs` | provider abstraction: Anthropic (env key) or deterministic mock; editable system prompts in `data/prompts.json`; every output labelled with its provider |
| `scripts/serve.mjs` | HTTP server, REST + action endpoints, ALL safety gates |
| `scripts/seed.mjs` | config + fictional demo data (refuses to clobber real records) |
| `scripts/self-test.mjs` | 36 end-to-end checks over the real HTTP API |
| `scripts/today.mjs` | terminal briefing |
| `app/` | the command centre UI |

## The API

- `GET /api/state` · `GET /api/today` · `GET /api/analytics` ·
  `GET /api/authority` · `GET /api/audit`
- `GET/POST /api/collections/:name`, `GET/PATCH/DELETE /api/collections/:name/:id`
  (DELETE is soft; guarded fields rejected — see below)
- `POST /api/actions/<verb>` — the workflow verbs: `lint`,
  `confidentiality`, `brand-gate`, `distill`, `draft-content`,
  `score-content`, `draft-outreach`, `score-outreach`, `approve`, `reject`,
  `mark-sent`, `record-reply`, `mark-published`, `log-performance`,
  `complete-task`, `weekly-review`, `extract-voice-rule`,
  `approve-voice-rule`
- `PATCH /api/settings`

## Where the safety gates live

All in `scripts/serve.mjs` (server-side, so no UI bug can bypass them):

1. `mark-sent` / `mark-published` require `approval.status === 'approved'`.
2. `contactGuard` blocks drafting/approving/sending for do-not-contact or
   opted-out contacts (409).
3. `draft-content` refuses insights classified private/strictly-confidential.
4. Generic POST/PATCH reject `sentAt`, `publishedDate`, `approval`, and any
   stage value that would skip the approval path (`GUARDED_FIELDS`).
5. `record-reply --createOpportunity` creates opportunities with
   `estimatedValue: null` — the engine never invents pipeline numbers.
6. Every write appends to `data/audit.json` (bounded at 5,000 entries).

## Voice system lineage

`data/voice/stuart-voice.md` is copied verbatim from
nextpredict-engine (the voice bible distilled from Stuart's own handoff).
The mechanical rules live in `lib/voice.mjs` and must be kept in lockstep
with nextpredict-engine's `scripts/lint-drafts.mjs` OFF_VOICE list — when
Stuart flags a new phrase there, add it here too. Approved rules in
`data/voice.json` are injected into every AI drafting call; proposed rules
(from the teach-by-edit loop) are inert until Stuart approves them.

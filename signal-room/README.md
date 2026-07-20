# Signal Room

Stuart Crowley's private prediction-markets editorial intelligence system.

> Signal Room turns industry noise, market activity and private context into
> the few content moves worth making today.

Paste an enormous, messy select-all dump from LinkedIn, X, Reddit, news or
jobs pages (or a call transcript, or internal notes). Signal Room preserves
the raw input exactly, extracts the individual source items out of the
interface litter, resolves duplicates, clusters the stories, extracts claims
with honest verification states, scores every opportunity across thirteen
visible dimensions, and returns **at most five recommendations**: what to do,
why, why not the alternatives, and what would change the judgement. Drafts
follow Stuart's voice rules mechanically; private material never reaches a
public draft.

The system **never sends or publishes anything**. Drafts end at `final`;
Stuart acts by hand.

## Quick start

```bash
cd signal-room
npm install
npm run db:migrate     # applies drizzle/*.sql to the embedded database
npm run db:seed        # Stuart's user + 4 demo ingestions, fully processed
npm run dev            # http://localhost:4180
```

No environment variables are required for local use: the app runs on an
embedded PostgreSQL (PGlite) at `.data/pglite`, a deterministic mock
intelligence provider, and open local access (badged in the UI). See
`.env.example` for the full list:

| Variable | Effect when set |
| --- | --- |
| `ANTHROPIC_API_KEY` | Editorial synthesis + drafting via Claude (strongest model for judgement, `SIGNAL_ROOM_EDITORIAL_MODEL`; cheap slot `SIGNAL_ROOM_EXTRACTION_MODEL` reserved for extraction refinement) |
| `DATABASE_URL` | Server PostgreSQL / Supabase instead of PGlite (same schema + migrations) |
| `SIGNAL_ROOM_PASSCODE` | Login gate with an HttpOnly session cookie |
| `SIGNAL_ROOM_DATA_DIR` | Where the embedded DB + uploads live (default `./.data`) |
| `SIGNAL_ROOM_MAX_INPUT_CHARS` | Paste/upload size ceiling (default 2,000,000) |

## Commands

```bash
npm run dev          # dev server on :4180
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint over src, scripts, tests, e2e
npm test             # 67 vitest checks incl. hermetic DB round-trip + eval gates
npm run eval         # gold-set evaluation (39 cases, 101 checks) -> eval-report.json
npm run e2e          # Playwright: full browser workflow + screenshots
npm run collect      # run collectors (markets/reddit/x); --list, --dry-run
npm run learn        # nudge score weights from Use/Wrong-angle feedback; --dry-run
npm run db:migrate   # apply migrations (PGlite or DATABASE_URL)
npm run db:seed      # demo data (idempotent; skips existing titles)
npm run db:reset     # wipe the LOCAL embedded database (refuses on DATABASE_URL)
```

## Automated collection and learning

**Collectors** (`npm run collect`) gather external intel and feed it through
the exact same ingestion path as a manual paste — raw preservation,
extraction, claims, scoring identical:

- **markets** (no credentials): snapshots Kalshi + Polymarket listings into
  `market_snapshots`, diffs against the previous collection and ingests a
  digest of what changed. "New listing" is decided by the market's own open
  time (page-limited fetches drift, so absence proves nothing);
  auto-generated parlay combos are excluded as venue plumbing; the venue's
  own API counts as a primary source for its own listings. First run
  records a baseline only. *Live-verified against both public APIs.*
- **reddit** (no credentials): sweeps `SIGNAL_ROOM_REDDIT_SUBS` via the
  public JSON API, formatted so the reddit segmenter parses it natively.
  Reddit refuses many datacenter IPs (fails loudly, never silently) — run
  from a normal network. *Formatter unit-tested; live path blocked from
  this build environment.*
- **x** (needs `X_BEARER_TOKEN`): recent search via the X API v2 using
  `SIGNAL_ROOM_X_QUERY`, formatted for the X segmenter. *Implemented,
  credential-gated, not live-tested.*

Intended cadence: a daily session or Claude Routine runs
`npm run collect && npm run learn`.

**Weight learning** (`npm run learn`): reads Use/Save vs Ignore/Wrong-angle
decisions, measures how each score dimension separated accepted from
rejected opportunities, and nudges that dimension's weight (bounded to
[0.2, 2.5], ±15% per pass, no-op below 3 accepted + 3 rejected decisions).
Changes are audit-logged and visible in Settings; the next processing run
uses them. Scores stay opinions; the weights get opinionated in Stuart's
direction.

## The workflow

1. **Paste** — dump the mess, pick the probable source, `PROCESS
   INTELLIGENCE`. TXT/MD/CSV/JSON/JSONL/ZIP uploads join the paste;
   screenshots are OCR'd best-effort (tesseract.js; recognised text enters
   the pipeline clearly marked as an unverified capture) and always stored
   for manual review. The raw input is SHA-256 hashed and preserved
   verbatim **before** any processing.
2. **Processing report** — live stage progress (10 stages), then the counts:
   blocks detected, unique items, duplicates, noise set aside, clusters,
   claims needing verification, people, potential leads, warnings. Every
   extracted item is inspectable with its exact raw offsets, confidence and
   type; noise is classified and kept, never discarded.
3. **Today** — at most five recommendations, ranked by a visible score, with
   a guaranteed slot for commercial leads. Each card: action, urgency,
   confidence, credibility risk, commercial value.
4. **Opportunity detail** — what happened / what changed / what is genuinely
   new / confirmed vs claimed / what is missing from the discussion; WHY
   STUART HAS AN ANGLE; recommended action with the rejected alternatives;
   what would change the judgement; claims with per-evidence independence
   (repetition is never corroboration); all 13 component scores with
   reasons; the full evidence trail.
5. **Draft** — nine draft types (X comment/quote/post, LinkedIn
   comment/post, Forum prompt, DM, email, video script). For major posts the
   app asks one question: *"What is your actual reaction to this?"* — the
   answer becomes the centre of the draft. Every draft is linted against
   Stuart's voice rules (em dashes, banned phrases, negative parallelism,
   unhedged figures on unverified claims…) and scanned for restricted
   material; drafts with permission warnings cannot be marked final.
6. **Feedback** — Use it / Wrong angle (with reason) / Save / Ignore, stored
   with the draft, edits, decision, time-to-decision and publication status,
   so Stuart's judgement is learnable data.

## Architecture

```
signal-room/
├── drizzle/                     SQL migrations (generated from the schema)
├── fixtures/                    curated test corpus + gold/cases.json (39 labelled cases)
├── scripts/                     migrate / seed / reset / eval / debug utilities
├── e2e/                         Playwright workflow + screenshot specs
├── tests/                       vitest suites (50 checks)
└── src/
    ├── middleware.ts            passcode gate (edge-safe)
    ├── app/                     Next.js App Router UI + API route handlers
    │   └── api/                 ingestions, runs, today, opportunities,
    │                            drafts, feedback, archive, entities, settings
    └── lib/
        ├── db/                  schema.ts (22 tables) + dual-backend client
        ├── pipeline/            chunk → segment → noise → dedupe → entities
        │                        → cluster → claims → score → recommend
        │                        run.ts (DB orchestrator), pure.ts (test harness)
        ├── ai/                  provider abstraction: anthropic.ts / mock.ts
        ├── voice/               lint.ts (Stuart's rules as a linter)
        ├── permissions.ts       permission levels + leak detection
        ├── drafts.ts            draft assembly (publishable evidence only)
        ├── ingest.ts            paste/upload -> preserved ingestion
        └── queue.ts             Today queue selection
```

**Database**: PostgreSQL via Drizzle ORM. Default backend is PGlite
(PostgreSQL compiled to WASM, in-process, zero external services — chosen
because Stuart's working environment is an ephemeral container). Set
`DATABASE_URL` for server Postgres/Supabase; identical schema and
migrations. Tables: users, ingestions, ingestion_files, processing_runs,
source_items, source_item_relationships, entities, entity_aliases,
entity_mentions, claims, claim_evidence, story_clusters, cluster_items,
opportunities, opportunity_scores, recommendations, drafts, draft_revisions,
feedback, permissions, relationships, tags, audit_log.

**Pipeline**: deterministic heuristic core (platform-aware segmentation with
exact raw offsets, shingle-based dedupe with containment for truncated
reposts, entity gazetteer + discovery patterns, connected-component story
clustering, sentence-level claim extraction with independence accounting,
13-dimension scoring, rule-based action selection). The LLM layer sits on
top behind `src/lib/ai/provider.ts`:

- **MockProvider** (no key, always available, labelled in the UI): editorial
  text is assembled from actual evidence excerpts; drafts are
  evidence-quoting skeletons with **bracketed slots** instead of invented
  prose. Zero fabricated facts by construction.
- **AnthropicProvider** (with `ANTHROPIC_API_KEY`): refines editorial
  rationale/angle for queued opportunities and writes full drafts in
  Stuart's voice from allowed evidence only, with one corrective retry when
  the voice linter finds errors.

**Large inputs**: max-size validation, deterministic chunking with overlap
and boundary reconciliation, per-stage progress persisted on the run row
(poll-safe, refresh-safe), partial-failure capture with a visible error
state, and one-click reprocessing (derived rows rebuild idempotently;
reprocessing deletes that ingestion's derived opportunities along with
attached drafts/feedback — a documented MVP trade-off).

**Permissions**: call transcripts and internal notes default to
private/internal. Restricted evidence is excluded from the writing agent's
input *structurally*, and a leak scanner (distinctive shingles + figures)
checks every draft *textually* against all restricted material. Restricted
clusters route to `sales_handoff`/`save`, never to public content actions.
Private context still powers WHY STUART HAS AN ANGLE as guidance notes.

## Evaluation

`npm run eval` runs 39 gold cases (curated from the real 2026-07-16 LinkedIn
capture + synthetic fixtures covering every required category: comment /
quote-post / original-post / DM / speaker / sponsor / media leads,
regulatory, recruitment, infrastructure, misleading liquidity, unverified
screenshots, promo campaigns, duplicates, viral-but-irrelevant, no-angle,
private-information) — 101 checks with hard gates:

| Gate | Requirement | Current |
| --- | --- | --- |
| extraction | ≥95% of identifiable blocks | 100% |
| duplicate detection | ≥90% | 100% |
| cluster quality | ≥90% | 100% |
| evidence traceability | 100% of claims linked | 100% |
| action classification | ≥70% | 100% |
| queue discipline | ≤5, no junk categories | 100% |
| voice compliance | zero errors in drafts | 100% |
| permission leakage | zero | 100% |

`npm test` includes the eval as a gate plus unit suites for chunking,
segmentation (against the real capture), dedupe, claims
(repetition-vs-corroboration, self-sourced announcements), the voice
linter, leak detection, and a hermetic DB round-trip (scratch PGlite,
process → reprocess idempotency → private-draft safety → feedback).

## Screens

Screenshots in `docs/screenshots/` (captured by `npm run e2e`):
Today (01), Paste (02), Intelligence (03), Processing report (04),
Opportunity detail (05), Draft editor (06), Archive (07), People (08).

## What is mocked / local-only

- **Intelligence provider** without `ANTHROPIC_API_KEY`: deterministic; UI
  shows `MOCK PROVIDER`. Drafts are labelled skeletons, not generated prose.
  The Anthropic path is implemented but has not been exercised in this
  environment (no key present) — treat it as untested until first run.
- **X collector**: implemented and credential-gated; not live-tested (no
  bearer token in the build environment). The Reddit collector's live path
  is blocked from datacenter IPs; both formatters are unit-tested.
- **Auth**: single-user passcode gate; not Supabase Auth.
- **Job queue**: in-process async runner behind a small seam
  (`enqueueProcessing`), DB-backed state; replaceable by a real queue.

## Known limitations

- X/Reddit segmentation is tuned to common select-all shapes; exotic layouts
  fall back to generic paragraph extraction (visible in extraction
  confidence).
- Multi-story digests join their strongest story cluster rather than all of
  them; they are demoted to `save` as aggregations.
- Reprocessing rebuilds derived rows; feedback attached to that ingestion's
  opportunities is removed with them.
- Cross-ingestion story continuity (yesterday's cluster ↔ today's) is
  newness-only (dedupe-hash lookback); the full temporal graph is future
  work.

## Next three integrations (recommended order)

The original next-three (X/Reddit collectors, Kalshi/Polymarket market
data, feedback weight learning) are now built — see "Automated collection
and learning" above. The next horizon:

1. **Cross-ingestion story continuity** — persistent story threads across
   days (yesterday's Goldman cluster ↔ today's follow-up), turning newness
   into a real temporal graph and enabling "what changed since I last
   looked" briefings.
2. **YouTube + newsletter/RSS collectors** — same collector contract;
   transcripts and newsletters are where the category's long-form arguments
   live.
3. **Thesis tracking (the Oracle layer)** — first-class theses with
   supporting/counter-evidence, confidence updates and what-would-change-
   the-view, fed by the claims layer that already exists.

## Product decisions

See `docs/DECISIONS.md` (stack, PGlite rationale, provider design,
permission model, queue diversity) and `docs/DATA-INVENTORY.md` (corpus
provenance and fixture curation).

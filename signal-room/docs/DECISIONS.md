# Signal Room — technical decisions

Concise record of the meaningful decisions made while building the MVP,
so they can be revisited deliberately rather than rediscovered.

## 1. Location: `personal-brand/signal-room/`, a self-contained app

Signal Room optimises for Stuart's judgement and personal brand, and its
drafts are written as Stuart (personal voice rules, where the newest voice
canon lives: `data/voice/llm-voice-pack-2026-07-15/`). So it lives in the
personal-brand repo — but as a **fully self-contained subdirectory** with
its own `package.json`. The existing zero-dependency brand engine is
untouched and keeps its philosophy; Signal Room is a separate product with
a separate (explicitly specified) stack. Nothing in the parent repo
imports from `signal-room/` or vice versa.

## 2. Database: PostgreSQL via embedded PGlite, with a real-Postgres escape hatch

The brief mandates PostgreSQL. The environment Stuart actually works in is
an ephemeral container with no Postgres server and no Supabase credentials
(the same constraint that shaped the parent repo's architecture). The
resolution: **PGlite** (`@electric-sql/pglite`), which is real Postgres
compiled to WASM, running in-process against a local data directory —
no server, no credentials, still PostgreSQL semantics and SQL.

- Default: PGlite at `SIGNAL_ROOM_DATA_DIR/pglite` (gitignored).
- Set `DATABASE_URL` and the exact same Drizzle schema and migrations run
  against server Postgres / Supabase instead (`pg` driver).
- Migrations are plain SQL in `drizzle/`, applied by `scripts/migrate.ts`
  against either backend and recorded in `_migrations`.

Consequence to be aware of: PGlite is single-connection; the app uses a
process-wide singleton. Fine for a single-user private tool, not for
multi-instance deployment — that is what `DATABASE_URL` is for.

## 3. Intelligence provider: deterministic core + optional Claude enhancement

No `ANTHROPIC_API_KEY` is present in the build environment, and the brief
requires the workflow to be demonstrable anyway. So the pipeline is built
as a **deterministic heuristic core** (segmentation, noise classification,
dedupe, clustering, entities, claims, scoring, recommendation selection —
all pure TypeScript, unit-testable, evaluation-friendly), with an LLM
provider abstraction (`src/lib/ai/`) layered on top for the judgement
stages (editorial rationale, story summaries, drafting).

- `MockProvider` (always available, clearly labelled in the UI): editorial
  text is assembled from actual evidence excerpts; drafts are
  evidence-quoting skeletons with **bracketed slots instead of invented
  facts** — the same convention as the parent repo's mock AI provider.
- `AnthropicProvider` (activates when `ANTHROPIC_API_KEY` is set): the
  strongest model (`SIGNAL_ROOM_EDITORIAL_MODEL`) is reserved for
  editorial judgement and drafting; a cheaper model slot
  (`SIGNAL_ROOM_EXTRACTION_MODEL`) exists for extraction refinement.

This is honest about what is mocked: extraction/dedupe/clustering/scoring
are real either way; generated *prose* is only real with a key.

## 4. Processing: DB-backed runs with an in-process job runner

Processing state (stage-by-stage progress, warnings, stats, errors) lives
in `processing_runs` rows, not in memory. The runner is an in-process
async job behind a small `enqueueProcessing()` abstraction so a real queue
can replace it later without touching call sites. Ingestions are
reprocessable: a new run deletes that ingestion's derived rows and
rebuilds them idempotently. Raw input is preserved (with SHA-256) before
any processing begins.

## 5. Auth: single-user passcode gate, not Supabase Auth

Private single-user tool. `SIGNAL_ROOM_PASSCODE` set → login page +
HMAC-signed HttpOnly session cookie (middleware-enforced). Unset → open
local mode with a visible LOCAL MODE badge (never silent). Supabase Auth
would add a service dependency the primary environment does not have; the
seam to add it later is `src/lib/auth.ts` + `src/middleware.ts`.

## 6. Extraction is heuristic-first by design, not as a fallback

Real captures (see `fixtures/`) show LinkedIn/X/Reddit dumps carry strong
structural markers ("Feed post", profile lines, timestamp lines, reaction
counts). A deterministic platform-aware segmenter is more traceable
(exact raw offsets), cheaper, and testable to the 95% extraction bar.
LLM refinement slots in per-chunk *after* deterministic segmentation.
Noise (navigation, ads) is classified and kept, never deleted — the
processing report's "items ignored" is a filter, not a discard.

## 7. Permissions are enforced structurally, then checked textually

Evidence carries a permission level (default derived from source type:
call transcripts / internal notes → `private`; social/news → `public`).
The writing agent's allowed-evidence set **only ever contains public
levels** — restricted evidence guides the angle section as context but is
never passed as draft material. On top of that, a leak detector
fingerprints restricted excerpts (distinctive shingles, numbers, names)
and scans every draft; hits surface as blocking warnings. Belt and braces.

## 8. Voice compliance is a linter, not a hope

Stuart's voice rules (no em dashes, banned phrases, negative-parallelism
constructions, theatrical one-line stacking, false certainty on unverified
claims, forced CTAs) are encoded in `src/lib/voice/lint.ts`, kept in
lockstep with `data/voice/llm-voice-pack-2026-07-15/` and the OFF_VOICE
lists in both repos. Every draft is linted on creation and on save;
violations are shown inline. The eval suite treats voice violations and
permission leaks as automatic failures.

## 9. The five-item queue is diverse by construction

Recommendations are selected one-per-story-cluster, ranked by the visible
13-component score, with an action-diversity preference so the queue is
never five variations of one story. "No action" is a first-class outcome:
weak clusters produce monitor/ignore entries in the archive rather than
padding the queue.

## 10. Collectors create ingestions, nothing else

A collector (markets/reddit/x) never writes pipeline rows. It formats what
it gathered into segmenter-native text and hands it to the same
`createIngestion` path as a manual paste, so raw preservation, permission
defaults, extraction, claims and scoring behave identically for automated
and manual intel. The whole automation layer is one seam (`Collector`
interface + `scripts/collect.ts`).

## 11. Market "newness" is the market's own open time, not snapshot absence

Venues hold thousands of open markets and a page-limited API fetch drifts
between calls, so "not in the previous snapshot" proves nothing (a
page-drift artefact produced 200 false "new listings" in live testing).
New = `open_time` after the previous collection; absence is only the
fallback where a venue reports no open time. Kalshi's auto-generated
parlay/combination markets (`KXMVE…`, "yes X,yes Y" titles) are excluded
from digests as venue plumbing. A venue's API is treated as a primary
source for its own listings — claims from market digests land as
`primary_source_found`, not social rumour.

## 12. Weight learning is bounded, slow and audit-logged

`npm run learn` measures how each score dimension separated Stuart's
accepted (Use/Save) from rejected (Ignore/Wrong-angle) opportunities and
nudges weights multiplicatively: ±15% of the dimension's weight per pass at
full signal, clamped to [0.2, 2.5], no-op below 3 accepted + 3 rejected
decisions, inverted dimensions handled on their effective (flipped) values.
Every applied change is written to the audit log. Deliberately conservative:
the queue should drift toward Stuart's judgement, never lurch.

## 13. OCR is best-effort and structurally distrusted

Screenshots are OCR'd with tesseract.js (language pack cached under the
data dir; first use needs network once). Recognised text enters the paste
as a clearly-marked "SCREENSHOT (OCR, unverified capture)" section, so its
claims land as social claims, never facts. Magic-byte validation runs
before the worker because tesseract's worker thread emits an unhandled
error event (not just a rejection) on garbage input — without the guard a
bad upload could take the server process down. OCR failure of any kind
falls back to the original stored-for-manual-analysis behaviour.

## 14. Corpus use

The `/mnt/data` ZIPs named in the brief were not present in this
workspace. The same material already lives in the sibling repo
`nextpredict-engine/intel/` (lossless datasets, per-channel digests, a
360KB raw LinkedIn capture) and `personal-brand/data/voice/`. Fixtures
were curated from there with provenance notes — see `DATA-INVENTORY.md`.
Private-looking material in fixtures is synthetic and marked fictional.

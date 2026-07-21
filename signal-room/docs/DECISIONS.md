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

## 14. Story identity is entities plus claims, and processing is serial

Cross-day thread matching keys on entity agreement plus a wording/figure
echo, with keywords built from each cluster's **claim texts** rather than
prose alone: the factual skeleton survives author-voice changes (Tim's
banking commentary and Priya's analyst summary of the same Goldman story
share claims, not style). "New on the thread" is decided by claim-hash
difference, so the system can honestly say which claims moved. Processing
runs execute serially (a global chain): two concurrent runs could both
match a thread before either records its observation, and live testing
produced exactly that interleaving before serialisation. Reprocessing an
ingestion unwinds its thread observations first, so a rerun never counts
itself as a second sighting.

## 15. Theses count evidence; they do not forecast

Auto-suggested evidence arrives stance-`context` and state-`suggested`,
because guessing supports/counters from keywords would put words in the
thesis. Stuart triages every suggestion; confidence is a hand-set number
whose every move is audit-logged with a reason; the tally counts confirmed
evidence only. Scenario analysis, source track records and probabilistic
forecasts stay out of v1 on purpose.

## 16. The briefing marker is explicit, not inferred

"Since you last sat down" is measured from a caught-up marker Stuart sets
deliberately (button or `--mark`), persisted as a collector cursor. Login
times and page views were rejected as signals: glancing at the queue on a
phone is not catching up, and a wrong automatic marker silently swallows
developments.

## 17. The graph is built from actions, not mentions

Relationship edges accumulate only from what Stuart DOES: using an
opportunity records engagement with its authors; acting on a lead records
the prospect edge. Mention co-occurrence deliberately does not create
edges (everyone in a category feed co-occurs with everyone). Engagement
strength then feeds relationship scoring with a visible reason, so the
loop is: act → edge → future stories involving that person rank higher.

## 18. The live provider earns trust through the shakedown, not on faith

The Anthropic path ships hardened (timeout, retry with backoff on
transient failures, corrective voice pass) and stub-tested, but stays
labelled untested-live until `npm run shakedown` runs with a real key and
reports every draft clean against the voice linter and permission scanner.
The first live run is a one-command evaluation, not an ad-hoc experiment.

## 19. Corpus use

The `/mnt/data` ZIPs named in the brief were not present in this
workspace. The same material already lives in the sibling repo
`nextpredict-engine/intel/` (lossless datasets, per-channel digests, a
360KB raw LinkedIn capture) and `personal-brand/data/voice/`. Fixtures
were curated from there with provenance notes — see `DATA-INVENTORY.md`.
Private-looking material in fixtures is synthetic and marked fictional.

## 20. Outreach states record reality; they never drive it

Prospect edges carry a pipeline state (identified → drafted → sent →
replied → meeting_booked → confirmed | passed), but the state machine is a
LEDGER, not a workflow engine. The system may set exactly two states,
because both are facts about the system itself: `identified` (the edge was
created from a Use on a lead) and `drafted` (a dm/email draft exists for
that opportunity — hooked into draft generation, works in either order of
draft-vs-use). Everything from `sent` onward records an action Stuart took
by hand outside the system, after the fact — mirroring the parent repo's
mark-sent discipline; nothing here sends. Transitions are deliberately
unconstrained (Stuart is correcting the record, and reality does not move
monotonically), but every change is audit-logged with before/after and
actor. Introductions are `introduced_by` edges whose introducer entity is
found-or-created by name: a fact Stuart states is recorded, not invented.
When a lead story's company is absent from the gazetteer (the live DAZN
case: the only linked entity was the author), the prospect edge falls back
to the author's organisation parsed verbatim from the captured headline —
evidence-backed, and the entity carries its provenance in its description.

## 21. Cross-venue equivalence is inferred conservatively, on fresh quotes only

Matching the same question across Kalshi and Polymarket is a heuristic
inference, so it is (a) hedged in the digest ("these appear to be the same
question"), (b) conservative: token-jaccard ≥ 0.6, or ≥ 0.5 corroborated
by a shared distinctive figure — where bare years never count, because a
live run matched "Walz Democratic nominee 2028" to "Walz wins the 2028
election" on the strength of "2028" alone — and clearly different close
times veto; (c) one-to-one greedy, strongest pairing first. Prices are
only ever compared within a single fetch: matching against stored
snapshots would manufacture "divergence" out of staleness. Kalshi's
unordered listing is ~100% auto-combo parlay legs for thousands of
consecutive rows and its long-dated set (where cross-listed questions
live) is 25k+ markets, so the matching pool reads a rotating cursor-window
(~4k/run, persisted in collector_cursors, wraps at the end) — coverage
converges across daily runs instead of pretending one bounded fetch is
complete. Two venue quirks are load-bearing: Kalshi returns status
"active" where its API filter says "open", and volume arrives in
`_fp`-suffixed fields; multi-outcome candidate rows share one title, so
`yes_sub_title` folds into the title to stop cross-candidate matches.

## 22. The follow-up nudge reminds; it never chases

A prospect in `sent` with no recorded reply past the window (a setting,
default 5 days) surfaces on Today and in the Briefing sorted by days
silent. Deliberate constraints: the nudge is computed from
`state_updated_at`, so it clears itself the moment Stuart records a reply
or a pass; it links to the person and the pipeline rather than generating
anything, because a follow-up to silence is a judgement call; and the
guidance it carries restates the outreach discipline (exploratory
register, the same 20-minute ask, a clean out, no tickets or pricing to
silence) instead of assuming a chase is wanted. Follow-ups and cross-venue
trends are current-state sections, not since-gated like the rest of the
briefing: due stays due across catch-up markers until acted on.

## 23. Cross-venue history stores observations; trends are read, not kept

Each matched pair accumulates its same-run quote comparisons in one row
(rolling window of 90, pruned after 45 unobserved days). Trends are
computed on read from those observations rather than stored, so the
wording can never drift from the data: a gap that held in every
observation, a gap that widened or narrowed 5+ points, a 20+ point shift
in a venue's share of combined volume. Two quotes from the same day are a
comparison, not a trend — spans under a day return nothing, which also
means the rotation window's sparse re-sightings (a pair may only be
re-quoted when the crawl comes back around) read honestly as "N
observations over D days". Quiet observations are recorded too: a pair
that never crosses a signal threshold can still hold a gap worth a
briefing line.

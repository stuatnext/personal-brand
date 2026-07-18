# NEXTPredict master schedule cleanup, 17 July 2026

Source: `NEXTPredict_Master_Social_Schedule_UPDATED_DEEP_DIVE_20260717.xlsx`
(27 tabs, supplied by Stuart 17 Jul 2026; supersedes the same-day
UPDATED_STARTUPS file, which it fully contains).
Output: `NEXTPredict_Master_Social_Schedule_CLEAN_2026-07-17.xlsx` (32 tabs:
16 working, 16 archive). Scope confirmed by Stuart: workbook only, engine
`data/` untouched.

## What changed

- **Directory (new tab)**: the 7 people/company registers (People & Source
  Directory, Media & Journalist Directory, Ecosystem Expansion, Latest
  Ecosystem Intake, Startup / Voices / LinkedIn Source Registers) held 1,963
  rows for 1,374 unique entities. Merged into one tab, one row per entity,
  typed (Person / Company / Organisation / Show / Community / Event /
  Research / Regulatory item), categorised, with X handle, LinkedIn link
  (direct vs search flagged), email, website, priority, verification and
  outreach status, plus source-sheet provenance per row.
- **Master Calendar**: kept as the single post register (191 posts, IDs
  P001-P191). Absorbed Malta time, role-in-day and decision columns from the
  old DAY-BY-DAY SCHEDULE (191/191 matched on date + topic). 21 status
  variants normalised to 8 statuses plus a Gate column. Added a suggested-tags
  column (exact Directory name matches; candidates, not instructions).
- **Day by Day**: regenerated from the Master Calendar as a flat, date-banded
  table. A view, not a second source of truth.
- **Content Bank**: split. 115 live ideas (IDs B001-B115) with normalised
  status (was 37 disposition labels) and a theme column; 116 already-used
  ideas moved to Archive Used Ideas with their outcome. 12 duplicated
  ecosystem ideas (block pasted twice at source) merged. 5 live ideas whose
  topic also sits on the calendar are flagged in the workbook README.
- **Profiles & Franchises** split into three clean tabs (Franchise Slots,
  Profile Backlog, Stat Bank). Recurring Formats + Series Playbook merged
  into Series & Formats. Dashboard rules, platform rules and The Tape
  visual/copy system moved into the README tab.
- **Archive tabs (grey, verbatim)**: every superseded sheet is preserved
  unchanged, including the outreach drafts in the startup/voices registers.
  Nothing was deleted.

All working tabs are flat tables (headers in row 1, no merged cells) with
freeze panes, filters and dropdown validation fed from the Lists tab, so the
workbook stays clean and stays easy for an LLM to ingest.

## Follow-up pass (same session): dedup, enrichment, engine sync

- **Second-pass dedup**: 1,374 → 1,359 entities. 15 clear aliases auto-merged
  (name-initial variants like `Robert J. Denault`/`Robert DeNault`; company
  sub-units like `Kalshi compute-markets product team` → `Kalshi`). 30
  genuinely ambiguous pairs (`ForecastEx / Interactive Brokers`, the
  `Tarek Mansour + Luana Lopes Lara` paired row, `Simon Johnson`/`Simon
  Johansen` — different people) were left for Stuart on the new **Dedup
  Review** tab rather than merged.
- **Handle enrichment (Critical + High, 332 entities)**: web-verified via 14
  parallel research agents. X handles 108 → 219, real LinkedIn profiles
  (not keyword searches) → 296, websites 88 → 285. Agents corrected 5 wrong
  handles already in the source data (e.g. Kate Knibbs `@KateKnibbs` →
  `@Knibbs`, Caitlin Ostroff → `@ceostroff`) and left anything unconfirmable
  blank. Confidence (verified / likely) is in the Directory `Handle check`
  column; `Handle source` records how. The shared web-search budget capped
  mid-run, so some big-brand handles are "likely" (X login wall blocked live
  re-checks); re-confirm at tag time.
- **Cross-links**: Production Board now carries a `Post ID` (its calendar
  post) and Commenting Plan a `Directory ID` (the target's directory row).
- **Engine sync** (`data/`, committed): schedule re-imported via
  `import-schedule.mjs` (+44 posts, 147 deduped → calendar 209). Directory
  imported via the new `scripts/import-directory.mjs` (+495 companies, +825
  contacts, +10 evidence-backed leads from the deep-dive signals; 39
  papers/regulatory items skipped as sources, not relationships). All imports
  are real (`fictional:false`) and tagged `source:"workbook-directory"` so
  they can be filtered or rolled back as a batch. Existing fictional demo
  records were left untouched. `npm test` passes 72/72 (hermetic); `today.mjs`
  renders clean against the real data.
- `directory-import.json` is the engine import source (re-runnable; dedupes on
  normalised name). `import-directory.mjs` is safe to re-run for future
  workbook refreshes.

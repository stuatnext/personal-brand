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

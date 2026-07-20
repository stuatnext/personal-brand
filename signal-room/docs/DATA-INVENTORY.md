# Signal Room — source corpus inventory

The build brief referenced ZIPs under `/mnt/data/…`. That path does not
exist in this workspace; the same material is already ingested, losslessly,
in the two sibling repos. Nothing was modified in place; fixtures are
read-only curated copies with provenance.

## Where the referenced corpus actually lives

| Brief reference (/mnt/data) | Actual location in workspace |
| --- | --- |
| `Stuart_Crowley_LLM_Voice_Pack_2026-07-15(1).zip` | `personal-brand/data/voice/llm-voice-pack-2026-07-15/` (10 docs + `llm_profile.json`) |
| `NEXTPredict_LinkedIn_Intel_2026-07-17_LOSSLESS_LLM_PACK_COMPLETE(2).zip` | `nextpredict-engine/intel/linkedin/` + `intel/captures/LinkedIn_Intel_2026-07-16__00_ORIGINAL_LinkedIn_capture.txt` (360KB raw feed capture, 48k words) |
| `NEXTPredict_X_Twitter_Intel_2026-07-17_LOSSLESS(2).zip` | `nextpredict-engine/intel/twitter/` (dated sweeps + digests) |
| `NEXTPredict_Reddit_Intel_2026-07-17_LOSSLESS(2).zip` | `nextpredict-engine/intel/reddit/` |
| `NEXTPredict_YouTube_Intel_2026-07-17_LOSSLESS(2).zip` | `nextpredict-engine/intel/youtube/` |
| `NEXTPredict_Google_News_Jobs_2026-07-17_LOSSLESS(2).zip` | `nextpredict-engine/intel/google-news/` |
| `NEXTPredict_MERGED_INTEL_2026-07-16…` / `ALL_Search_Terms…` | `nextpredict-engine/intel/datasets/<date>/*.jsonl.gz` (canonical lossless rows: `id`, `captured_at`, `source_type`, `platform`, `author`, `raw_text`…) |
| `NEXTPredict_Master_Social_Schedule…xlsx` | `personal-brand/data/calendar.json` (103 real schedule items) + `nextpredict-engine/intel/social-schedule/` |
| `nexpredict_chatgpt_ingest_LOSSLESS_2026-07-02.zip`, handoff 2026-07-03 | `nextpredict-engine/intel/handoff/`, `intel/briefs/`, `data/voice/stuart-voice.md` |

## Formats observed

- **Raw feed capture** (`intel/captures/*.txt`): select-all page text.
  LinkedIn structure: top navigation block, then repeating `Feed post`
  sections with `View <name>'s profile` / `View company: <name>`, author
  name, connection degree (`• 2nd` / `• 3rd+`), headline line, timestamp
  (`1h • Edited •`), `Follow`/`Connect`, body paragraphs, `View image`,
  reaction counts, zero-width-space litter (`​`). This is the primary
  test input for the extraction layer.
- **Canonical datasets** (`intel/datasets/<date>/*.jsonl.gz`): one JSON
  object per row with full `raw_text` (lossless discipline per
  `intel/CANONICAL.md`).
- **Digests** (`intel/<channel>/*.md`): derived excerpt views, not sources.
- **Voice pack** (`data/voice/llm-voice-pack-2026-07-15/`): master +
  compact system prompts, voice guide, platform playbook, approved
  examples, banned-phrase canon. Encoded into `src/lib/voice/`.

## Fixtures curated for Signal Room (`fixtures/`)

| Fixture | Provenance | Purpose |
| --- | --- | --- |
| `linkedin-capture-2026-07-16.txt` | Verbatim slice of the real 2026-07-16 LinkedIn capture (nextpredict-engine, private repo) | Primary large messy-paste fixture: real navigation noise, real duplicate stories (Goldman staff-trading ban, Base/Pollak step-back), real promo posts |
| `x-dump.txt` | Synthetic, modelled on `intel/twitter/` sweeps; themes real, handles/engagement invented | X segmentation + quote-post detection |
| `reddit-thread.txt` | Synthetic, modelled on `intel/reddit/` | Reddit segmentation, comment trees |
| `news-jobs.txt` | Synthetic headlines/job listings modelled on `intel/google-news/` | News/jobs item types, recruitment signals |
| `call-transcript.txt` | **Fictional** (marked in-file) speaker/sponsor call | Private-permission handling and leak tests |
| `mixed-dump.txt` | Synthetic multi-platform paste | Mixed-source routing |
| `gold/*.json` | Hand-labelled from the above | Evaluation gold set (30+ cases) |

Rules honoured: no destructive modification of `intel/`; no private
material in public output; provenance recorded here; no silent truncation
(the fixture slice is marked as a slice; the full capture remains in
`nextpredict-engine/intel/captures/`).

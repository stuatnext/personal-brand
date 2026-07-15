# Assumptions Stuart should confirm

Everything here is editable in the app; nothing is presented as confirmed
fact. Items marked ⚠ change behaviour, not just copy.

## Positioning & offers
1. **The six offers** (Commercial Systems Audit, AI Workflow Sprint,
   CRM/GTM OS, Pricing Sprint, Event Revenue Architecture, Fractional
   Leadership) are seeded verbatim from the build prompt and flagged
   `draft: true`. No pricing is set ("UNSET. Value-based, never hours.").
   Confirm, edit or delete each in `#/offers`.
2. **Positioning narrative** ("commercial clarity and operating leverage",
   "I know where commercial systems break, and I use AI to make the fix
   faster") is stored on the Strait Up Growth brand record as a draft.
3. **Target buyer profile** (founder-led B2B, 5–100 staff, SG/Asia/Europe)
   — from the prompt, unverified.
4. ⚠ **Currency defaults to SGD** on opportunities.

## Taxonomy & scoring
5. The **15 authority lanes** are the prompt's list, unedited. Rename or
   prune in `data/lanes.json`.
6. ⚠ **Score weights and thresholds** (content 48/36 of 60; outreach
   75/55 of 100 with the 15/20/20/15/10/10/10 split; authority
   20/15/15/15/10/15/5/5) are the prompt's suggestions, editable in
   Settings.
7. ⚠ **Relationship-strength recipe** (recency bands at 14/45/120 days,
   warm→cold at ~45–90 days quiet, repeat-engager threshold at 3) is my
   judgement. Tune in `lib/scoring.mjs` / `lib/recommend.mjs`.
8. **"Qualified conversation" has no written definition yet.** The metric
   the whole system optimises for needs Stuart's one-liner (a seeded
   insight, ins-s17, holds the question).

## Voice
9. One genuine conflict between sources was resolved in favour of
   Stuart's own linter: the build prompt suggested *"The part I keep
   coming back to is…"* as a useful phrase, but Stuart banned exactly that
   phrase in his 2026-07-03 voice handoff (enforced in
   nextpredict-engine's linter). **It stays banned here.** Rule vr-04
   records this.
10. The prompt's other suggested openers ("The useful question is…", "The
    uncomfortable bit is…") are stored as a *proposed* voice rule (vr-10)
    awaiting approval — they are used in seeded demo copy.

## Boundaries
11. ⚠ The confidentiality detectors treat currency amounts, margin
    percentages, ACV/NRR/pipeline vocabulary, named-executive statements
    and NEXT.io mentions as confidentiality signals. Publicly-stated CV
    figures (e.g. the €1.2M media baseline) are still flagged when they
    appear in draft copy — deliberate friction; Stuart can classify
    public.
12. The engine assumes **no automated sending or publishing, ever**, and
    no unofficial LinkedIn scraping. If Stuart wants a draft-to-Gmail
    path, that is a new build decision (approval gate preserved).

## Demo data
13. All seeded people, companies, deals, engagements and reviews are
    fictional (`fictional: true`, bannered in the UI). Seeded "performance
    numbers" (impressions etc.) are illustrative only.
14. Knowledge item kn-s06 lists career proof points taken from Stuart's
    public CV repo; everything else in the knowledge base marked draft or
    fictional needs his review before public use.

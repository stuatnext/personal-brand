# Personal Brand — Standing Maintenance Brief

This file is the instruction set for the scheduled Claude Routine that maintains
this repository. Each run should read this file first and follow it. Edit this
file to change what the routine does — no need to touch the schedule.

## Owner

Stuart (stuart@next.io)

## Goal

Build and keep up to date a personal-brand content repository: bio, positioning,
content pipeline, and published/draft material, all version-controlled here.

## What each run should do

1. Read this brief and the current state of the repo.
2. Check `BACKLOG.md` (create it if missing) for the next most valuable task.
   While the repo is still being scaffolded, work through the initial structure
   below before anything else.
3. Do **one meaningful unit of work** per run — a new draft, a section rewrite,
   a structural improvement — not many shallow edits.
4. Commit with a clear message, push to a branch named `routine/<date>-<slug>`,
   and open a pull request against `main` for review. Never push directly to
   `main`.
5. Update `BACKLOG.md` to reflect what was done and what's next.

## Initial structure to build out (in order)

- [ ] `profile/bio.md` — short, medium, and long bios (draft placeholders are
      fine; flag anything that needs facts only Stuart can supply)
- [ ] `profile/positioning.md` — audience, topics, tone of voice
- [ ] `content/` — one folder per platform or format (e.g. `content/linkedin/`,
      `content/blog/`), with drafts as dated markdown files
- [ ] `BACKLOG.md` — running task list the routine maintains
- [ ] Improve `README.md` to explain the repo layout

## Conventions

- Everything in Markdown; drafts named `YYYY-MM-DD-slug.md`.
- Never invent biographical facts, employers, credentials, or metrics. Where a
  fact is needed, leave a clearly marked `TODO(stuart): …` placeholder.
- Keep PRs small and reviewable; one topic per PR.
- If a previous routine PR is still open and unreviewed, prefer improving that
  PR or picking a non-conflicting task over opening a pile of parallel PRs.

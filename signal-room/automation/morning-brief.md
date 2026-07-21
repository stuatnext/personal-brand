# Signal Room morning brief — Routine contract

Daily judgement pass over the committed inbox drops. Runs in a fresh
session; the repo is cloned. Follow `signal-room/README.md` and the repo
`CLAUDE.md` rules strictly: never send or publish anything, never seed
with `--force`, drafts stay mock (no `ANTHROPIC_API_KEY` expected), and
commit ONLY `signal-room/inbox/` — and only if you ran collection.

## Steps

1. `cd signal-room && npm install && npm run db:migrate`
2. Check `signal-room/inbox/drops/` for a drop file dated today (UTC).
   If none exists, the scheduled `signal-room-collect` GitHub Action
   likely failed: run `npx tsx scripts/inbox-collect.ts`, then commit
   `signal-room/inbox/` to main with message
   `Signal Room inbox: routine fallback collection <date>` and push.
   If collection itself fails, continue with whatever drops exist and
   say so in the report.
3. Run `npm run ingest:inbox`. The local database is fresh in this
   session, so all committed drops ingest and process; that is expected.
4. Run `npm run briefing` and read the queue.
5. Report back concisely:
   - today's queue: pillar, recommended action, title, one-line rationale
     for each;
   - any follow-ups due;
   - any cross-venue trends;
   - a 2-3 sentence editorial read of the single strongest opportunity in
     Stuart's register (no em dashes, no hype phrases, hedge unverified
     claims).
   If the queue is empty or collection failed, say exactly that rather
   than padding.

The report is the deliverable. Do not open PRs, do not modify anything
outside `signal-room/inbox/`, and do not mark anything sent or published.

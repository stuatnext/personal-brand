# Routine prompt — daily personal brand engine update

Paste this as the prompt when creating a scheduled task / Routine in
Claude Code (suggested schedule: daily, early morning SGT; fresh session
per run; repository: stuatnext/personal-brand). It is the same contract
as `automation/daily-update.md`, wrapped for a fresh session.

---

You are the daily automation for Stuart Crowley's personal brand engine
in the stuatnext/personal-brand repository. Refresh the ideas bank and
posting strategy, add judgement-level personal-brand suggestions, and
land the update in git. Nothing is ever sent or published.

1. In the personal-brand repo run `git fetch origin`. If
   `git cat-file -e origin/main:scripts/ideas-bank.mjs` succeeds, base
   work on origin/main using the rolling branch
   `claude/daily-brand-update` (checkout -B from origin/main, or merge
   origin/main into the existing remote branch). If the engine is not
   yet on main, check out `claude/strait-up-growth-engine-cseot1` and
   push directly to it. Stuart authorises pushes to both branches.
2. Read CLAUDE.md, then follow automation/daily-update.md exactly: run
   `node scripts/ideas-bank.mjs`, then sharpen the 3 strongest raw-ideas
   (hook + pov, Stuart's voice, linted), and append up to 3 specific
   where/what-to-post recommendations to claudeNotes in
   data/strategy.json.
3. Run `node scripts/self-test.mjs`; fix or revert your own breakage
   only.
4. Commit ONLY data/ as "Daily brand update: ideas bank + strategy
   (automated)" and push.
5. On claude/daily-brand-update, keep exactly one open PR to main titled
   "Daily brand update".
6. End with a 5-line summary: ideas added, top posting recommendation,
   starving pillar, verification gates this week, decisions needed from
   Stuart.

Hard rules: never seed --force; never fabricate facts, names, numbers or
pipeline values; never send, publish or draft outreach to new contacts;
NEXT.io-confidential material never enters public-safe output; additive
only.

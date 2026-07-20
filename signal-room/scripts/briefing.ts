/* Terminal briefing: the same "since you last sat down" view as /briefing.
 *   npm run briefing              # print the briefing
 *   npm run briefing -- --mark    # also set the caught-up marker
 */
import { ensureMigrated } from "../src/lib/db/client";
import { getBriefing, markCaughtUp } from "../src/lib/briefing";

async function main() {
  await ensureMigrated();
  const b = await getBriefing();
  const line = (s = "") => console.log(s);
  line(`SIGNAL ROOM BRIEFING · since ${b.since ? b.since.slice(0, 16).replace("T", " ") : "the beginning"}`);
  line("=".repeat(64));

  line(`\nSTORIES THAT MOVED (${b.movedThreads.length})`);
  for (const t of b.movedThreads) {
    line(`  obs ${t.observationCount} · ${t.newClaimCount} new claim(s) · ${t.title.slice(0, 70)}`);
    if (t.whatChanged) line(`    ${t.whatChanged.slice(0, 110)}`);
  }
  if (!b.movedThreads.length) line("  nothing developed");

  line(`\nNEW STORIES (${b.newThreads.length})`);
  for (const t of b.newThreads.slice(0, 8)) line(`  [${t.action ?? "new"}] ${t.title.slice(0, 74)}`);

  line(`\nTHESIS MOVEMENT (${b.thesisActivity.length})`);
  for (const t of b.thesisActivity) {
    line(`  ${Math.round(t.confidence)}% · +${t.suggestedSince} suggested, +${t.confirmedSince} confirmed · ${t.statement.slice(0, 60)}`);
    for (const m of t.confidenceMoves) line(`    confidence ${m.from} -> ${m.to}${m.note ? ` (${m.note})` : ""}`);
  }
  if (!b.thesisActivity.length) line("  no movement");

  line(`\nQUEUE (${b.queue.length})`);
  for (const q of b.queue) line(`  ${q.action.padEnd(14)} ${q.title.slice(0, 64)}`);

  line(`\nOPEN LEADS (${b.openLeads.length})`);
  for (const l of b.openLeads) line(`  ${l.action.padEnd(14)} ${l.title.slice(0, 64)}`);

  if (b.goneQuiet.length) {
    line(`\nGONE QUIET (${b.goneQuiet.length})`);
    for (const t of b.goneQuiet) line(`  last ${t.lastObservedAt.slice(0, 10)} · ${t.title.slice(0, 66)}`);
  }

  if (process.argv.includes("--mark")) {
    const at = await markCaughtUp();
    line(`\n[marked caught up at ${at}]`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});

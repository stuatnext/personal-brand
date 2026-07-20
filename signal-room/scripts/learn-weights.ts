/* Weight learning pass: reads Stuart's Use / Save / Ignore / Wrong-angle
 * decisions and nudges score weights toward what he actually accepts.
 *
 *   npm run learn              # apply (bounded, slow; audit-logged)
 *   npm run learn -- --dry-run # show what would change
 *
 * Intended cadence: after a batch of feedback (e.g. nightly, or end of a
 * working session). Weights never leave [0.2, 2.5]; a pass with fewer than
 * 3 accepted and 3 rejected decisions changes nothing.
 */
import { ensureMigrated } from "../src/lib/db/client";
import { learnWeights } from "../src/lib/learning";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await ensureMigrated();
  const result = await learnWeights({ dryRun });
  console.log(`[learn] samples: ${result.positives} accepted, ${result.negatives} rejected`);
  if (!result.applied) {
    console.log(`[learn] no change: ${result.reason ?? "no dimension moved"}`);
    return;
  }
  console.log(`[learn] ${dryRun ? "WOULD apply" : "applied"} ${result.changes.length} weight change(s):`);
  console.log("dimension".padEnd(26) + "from".padStart(7) + "to".padStart(8) + "signal".padStart(9) + "  (accepted vs rejected mean)");
  for (const c of result.changes) {
    console.log(
      c.dimension.padEnd(26) +
        c.from.toFixed(2).padStart(7) +
        c.to.toFixed(2).padStart(8) +
        c.signal.toFixed(1).padStart(9) +
        `  (${c.positiveMean} vs ${c.negativeMean})`,
    );
  }
  if (!dryRun) console.log("[learn] weights persisted; the next processing run uses them.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[learn] failed:", err);
  process.exit(1);
});

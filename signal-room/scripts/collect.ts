/* Collector runner: gathers external intel and feeds it through the same
 * ingestion path as a manual paste (raw preservation, extraction, claims,
 * scoring all identical).
 *
 *   npx tsx scripts/collect.ts                 # run every available collector
 *   npx tsx scripts/collect.ts markets reddit  # run specific collectors
 *   npx tsx scripts/collect.ts --dry-run       # collect + print, ingest nothing
 *   npx tsx scripts/collect.ts --list          # show collectors + availability
 *
 * Intended cadence: invoke from a daily session or a Claude Routine. The
 * runner is idempotent per run (a quiet collector emits nothing).
 */
import { eq } from "drizzle-orm";
import { marketCollector } from "../src/lib/collectors/markets";
import { redditCollector, xCollector } from "../src/lib/collectors/social";
import { rssCollector, youtubeCollector } from "../src/lib/collectors/feeds";
import type { Collector } from "../src/lib/collectors/types";
import { createIngestion } from "../src/lib/ingest";
import { db, ensureMigrated } from "../src/lib/db/client";
import { processingRuns } from "../src/lib/db/schema";

async function waitForRun(runId: string, timeoutMs = 180_000): Promise<string> {
  const database = await db();
  const started = Date.now();
  for (;;) {
    const [run] = await database.select().from(processingRuns).where(eq(processingRuns.id, runId));
    if (run && (run.status === "complete" || run.status === "failed")) return run.status;
    if (Date.now() - started > timeoutMs) return "timeout";
    await new Promise((r) => setTimeout(r, 700));
  }
}

const REGISTRY: Collector[] = [
  marketCollector(),
  redditCollector(),
  xCollector(),
  youtubeCollector(),
  rssCollector(),
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const list = args.includes("--list");
  const names = args.filter((a) => !a.startsWith("--"));

  if (list) {
    for (const c of REGISTRY) {
      const a = c.available();
      console.log(`${c.name.padEnd(10)} ${a.ok ? "available" : `unavailable: ${a.reason}`}\n           ${c.description}`);
    }
    return;
  }

  await ensureMigrated();
  const selected = names.length ? REGISTRY.filter((c) => names.includes(c.name)) : REGISTRY;
  if (names.length && selected.length !== names.length) {
    const known = new Set(REGISTRY.map((c) => c.name));
    throw new Error(`unknown collector(s): ${names.filter((n) => !known.has(n)).join(", ")}`);
  }

  for (const collector of selected) {
    const availability = collector.available();
    if (!availability.ok) {
      console.log(`[collect] ${collector.name}: skipped (${availability.reason})`);
      continue;
    }
    console.log(`[collect] ${collector.name}: collecting…`);
    try {
      const outputs = await collector.collect();
      if (outputs.length === 0) {
        console.log(`[collect] ${collector.name}: nothing new`);
        continue;
      }
      for (const out of outputs) {
        console.log(`[collect] ${collector.name}: "${out.title}" (${out.text.length} chars${out.note ? `; ${out.note}` : ""})`);
        if (dryRun) {
          console.log("---\n" + out.text.slice(0, 800) + (out.text.length > 800 ? "\n… (truncated preview)" : "") + "\n---");
        } else {
          const result = await createIngestion({
            title: out.title,
            sourceType: out.sourceType,
            text: out.text,
          });
          const status = await waitForRun(result.runId);
          console.log(
            `[collect] ${collector.name}: ingested ${result.ingestionId}, processing ${status}`,
          );
          if (status !== "complete") process.exitCode = 1;
        }
      }
    } catch (err) {
      console.error(`[collect] ${collector.name}: FAILED: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

main().then(() => process.exit(process.exitCode ?? 0));

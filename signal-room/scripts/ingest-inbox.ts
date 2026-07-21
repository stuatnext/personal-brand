/* Ingest the committed inbox drops (written by scripts/inbox-collect.ts,
 * usually via the scheduled GitHub Action) into the LOCAL database.
 * Sha-deduped against ingestions.raw_sha256, so running it every morning —
 * or twice — never double-ingests. PGlite is single-process: stop the dev
 * server first (or restart it after).
 *
 *   npm run ingest:inbox            # ingest new drops, process each
 *   npm run ingest:inbox -- --dry-run
 */
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db, ensureMigrated } from "../src/lib/db/client";
import { ingestions, processingRuns } from "../src/lib/db/schema";
import { createIngestion } from "../src/lib/ingest";
import { sha256 } from "../src/lib/ids";

const DROPS_DIR = path.join(process.env.SIGNAL_ROOM_INBOX_DIR ?? path.join(process.cwd(), "inbox"), "drops");
const DRY = process.argv.includes("--dry-run");

interface Drop {
  title: string;
  sourceType: string;
  pillar?: string;
  text: string;
  note?: string;
  capturedAt?: string;
  sha256?: string;
}

async function waitForRun(runId: string, timeoutMs = 180_000): Promise<string> {
  const database = await db();
  const started = Date.now();
  for (;;) {
    const [run] = await database.select().from(processingRuns).where(eq(processingRuns.id, runId));
    if (run && run.status !== "running" && run.status !== "queued") return run.status;
    if (Date.now() - started > timeoutMs) return "timeout";
    await new Promise((r) => setTimeout(r, 700));
  }
}

async function main() {
  await ensureMigrated();
  if (!fs.existsSync(DROPS_DIR)) {
    console.log("[inbox] no inbox/drops directory; nothing to ingest");
    return;
  }
  const files = fs
    .readdirSync(DROPS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const database = await db();
  let ingested = 0;
  let skipped = 0;
  for (const file of files) {
    let drop: Drop;
    try {
      drop = JSON.parse(fs.readFileSync(path.join(DROPS_DIR, file), "utf8")) as Drop;
    } catch (err) {
      console.error(`[inbox] unreadable drop ${file}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (!drop.text?.trim()) {
      console.error(`[inbox] empty drop ${file}; skipping`);
      continue;
    }
    const hash = sha256(drop.text);
    const [existing] = await database
      .select({ id: ingestions.id })
      .from(ingestions)
      .where(eq(ingestions.rawSha256, hash));
    if (existing) {
      skipped += 1;
      continue;
    }
    if (DRY) {
      console.log(`[dry-run] would ingest ${file}: "${drop.title}" (${drop.pillar ?? "prediction_markets"})`);
      ingested += 1;
      continue;
    }
    const result = await createIngestion({
      title: drop.title,
      sourceType: drop.sourceType,
      pillar: drop.pillar,
      text: drop.text,
    });
    const status = await waitForRun(result.runId);
    console.log(`[inbox] ingested ${file} -> ${result.ingestionId} (processing ${status})`);
    ingested += 1;
  }
  console.log(`[inbox] done: ${ingested} ingested${DRY ? " (dry run)" : ""}, ${skipped} already known, ${files.length} drop file(s) scanned`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { users, ingestions } from "../src/lib/db/schema";
import { uid, sha256 } from "../src/lib/ids";
import { processIngestion } from "../src/lib/pipeline/run";
import { defaultPermissionForSource } from "../src/lib/permissions";

// Seed: Stuart's user plus demo ingestions processed end to end through the
// real pipeline (deterministic provider), so Today has a live queue on
// first boot. Fixtures are curated from the intel corpus (see
// docs/DATA-INVENTORY.md); the call transcript is fictional and marked so.

const FIXTURES: {
  file: string;
  title: string;
  sourceType: string;
  fictional?: boolean;
}[] = [
  {
    file: "linkedin-capture-2026-07-16.txt",
    title: "LinkedIn feed sweep, prediction markets (2026-07-16 capture)",
    sourceType: "linkedin",
  },
  {
    file: "x-dump.txt",
    title: "X feed sweep, category signals (synthetic demo)",
    sourceType: "x",
    fictional: true,
  },
  {
    file: "news-jobs.txt",
    title: "Google News and job listings sweep (synthetic demo)",
    sourceType: "news",
    fictional: true,
  },
  {
    file: "call-transcript.txt",
    title: "Sponsor call, Meridian Clearing (FICTIONAL test transcript)",
    sourceType: "call_transcript",
    fictional: true,
  },
];

export async function seed(options: { quiet?: boolean } = {}): Promise<void> {
  const log = (msg: string) => {
    if (!options.quiet) console.log(msg);
  };
  const database = await db();

  let [owner] = await database.select().from(users).where(eq(users.email, "stuart@next.io"));
  if (!owner) {
    const id = uid();
    await database.insert(users).values({
      id,
      email: "stuart@next.io",
      name: "Stuart Crowley",
      role: "owner",
      settingsJson: {
        currentThemes: ["market structure", "regulation", "distribution", "liquidity", "compliance", "settlement"],
      },
    });
    [owner] = await database.select().from(users).where(eq(users.id, id));
    log(`[seed] created user ${owner.email}`);
  } else {
    log(`[seed] user ${owner.email} already present`);
  }

  const fixturesDir = path.resolve(process.cwd(), "fixtures");
  for (const fx of FIXTURES) {
    const [existing] = await database
      .select({ id: ingestions.id })
      .from(ingestions)
      .where(eq(ingestions.title, fx.title));
    if (existing) {
      log(`[seed] ingestion already present: ${fx.title}`);
      continue;
    }
    const raw = fs.readFileSync(path.join(fixturesDir, fx.file), "utf8");
    const id = uid();
    await database.insert(ingestions).values({
      id,
      userId: owner.id,
      sourceType: fx.sourceType,
      title: fx.title,
      rawText: raw,
      rawSha256: sha256(raw),
      wordCount: raw.split(/\s+/).filter(Boolean).length,
      charCount: raw.length,
      processingStatus: "pending",
      defaultPermissionLevel: defaultPermissionForSource(fx.sourceType),
      fictional: fx.fictional ?? false,
    });
    log(`[seed] processing "${fx.title}" (${raw.length} chars)…`);
    const { stats } = await processIngestion(id);
    log(
      `[seed]   -> ${stats.blocksDetected} blocks, ${stats.uniqueSourceItems} unique items, ${stats.duplicateItems} duplicates, ${stats.storyClusters} clusters, ${stats.claimsTotal} claims, ${stats.recommendations} queued`,
    );
  }
  log("[seed] done");
}

// Run directly (tsx scripts/seed.ts)
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed] failed:", err);
      process.exit(1);
    });
}

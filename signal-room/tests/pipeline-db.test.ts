// Hermetic end-to-end test of the DB-backed pipeline: scratch PGlite
// directory, full processIngestion round trip, reprocessing idempotency,
// draft generation with permission handling, feedback storage.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-test-"));
process.env.SIGNAL_ROOM_DATA_DIR = scratch;
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

// imports AFTER env is set (the db client resolves the data dir lazily but
// the singleton must be created inside this process with our env)
import { db, ensureMigrated } from "@/lib/db/client";
import {
  ingestions,
  sourceItems,
  storyClusters,
  claims,
  claimEvidence,
  opportunities,
  recommendations,
  feedback as feedbackTable,
  drafts as draftsTable,
  users,
} from "@/lib/db/schema";
import { processIngestion } from "@/lib/pipeline/run";
import { generateDraft } from "@/lib/drafts";
import { uid, sha256 } from "@/lib/ids";
import { defaultPermissionForSource } from "@/lib/permissions";
import { eq } from "drizzle-orm";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "../fixtures", name), "utf8");

async function createIngestionRow(title: string, sourceType: string, raw: string) {
  const database = await db();
  let [owner] = await database.select().from(users).limit(1);
  if (!owner) {
    const userId = uid();
    await database.insert(users).values({ id: userId, email: "stuart@next.io", name: "Stuart Crowley" });
    [owner] = await database.select().from(users).where(eq(users.id, userId));
  }
  const id = uid();
  await database.insert(ingestions).values({
    id,
    userId: owner.id,
    sourceType,
    title,
    rawText: raw,
    rawSha256: sha256(raw),
    wordCount: raw.split(/\s+/).filter(Boolean).length,
    charCount: raw.length,
    defaultPermissionLevel: defaultPermissionForSource(sourceType),
  });
  return id;
}

let linkedinId: string;
let callId: string;

beforeAll(async () => {
  await ensureMigrated();
  linkedinId = await createIngestionRow("LI test", "linkedin", fixture("linkedin-capture-2026-07-16.txt"));
  callId = await createIngestionRow("Call test", "call_transcript", fixture("call-transcript.txt"));
}, 120_000);

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("processIngestion round trip", () => {
  it("processes the large LinkedIn capture end to end", async () => {
    const { stats } = await processIngestion(linkedinId);
    expect(stats.blocksDetected).toBeGreaterThanOrEqual(29);
    expect(stats.storyClusters).toBeGreaterThan(20);
    expect(stats.claimsTotal).toBeGreaterThan(40);
    expect(stats.recommendations).toBeLessThanOrEqual(5);
    expect(stats.recommendations).toBeGreaterThan(0);

    const database = await db();
    const items = await database.select().from(sourceItems).where(eq(sourceItems.ingestionId, linkedinId));
    // raw preservation: every item's offsets slice back into the raw text
    const [ing] = await database.select().from(ingestions).where(eq(ingestions.id, linkedinId));
    for (const item of items.slice(0, 10)) {
      const slice = ing.rawText.slice(item.rawStartOffset, item.rawEndOffset);
      expect(slice.length).toBeGreaterThan(0);
    }
    // every claim has evidence
    const allClaims = await database.select().from(claims).where(eq(claims.ingestionId, linkedinId));
    for (const claim of allClaims) {
      const ev = await database.select().from(claimEvidence).where(eq(claimEvidence.claimId, claim.id));
      expect(ev.length, `claim ${claim.claimText.slice(0, 40)}`).toBeGreaterThan(0);
    }
  }, 120_000);

  it("reprocessing is idempotent (no row duplication)", async () => {
    const database = await db();
    const before = (await database.select().from(sourceItems).where(eq(sourceItems.ingestionId, linkedinId))).length;
    const clustersBefore = (await database.select().from(storyClusters).where(eq(storyClusters.ingestionId, linkedinId))).length;
    await processIngestion(linkedinId);
    const after = (await database.select().from(sourceItems).where(eq(sourceItems.ingestionId, linkedinId))).length;
    const clustersAfter = (await database.select().from(storyClusters).where(eq(storyClusters.ingestionId, linkedinId))).length;
    expect(after).toBe(before);
    expect(clustersAfter).toBe(clustersBefore);
  }, 120_000);

  it("routes private call material away from public actions and leak-free drafts", async () => {
    const { stats } = await processIngestion(callId);
    expect(stats.storyClusters).toBe(1);
    const database = await db();
    const opps = await database.select().from(opportunities).where(eq(opportunities.ingestionId, callId));
    expect(opps.length).toBe(1);
    expect(["sales_handoff", "save"]).toContain(opps[0].recommendedAction);

    const draft = await generateDraft(opps[0].id, "linkedin_post");
    for (const forbidden of ["85,000", "ninth of September", "Meridian"]) {
      expect(draft.content).not.toContain(forbidden);
    }
    expect(draft.permissionWarnings).toHaveLength(0); // nothing leaked
  }, 120_000);

  it("stores feedback and updates statuses", async () => {
    const database = await db();
    const [opp] = await database.select().from(opportunities).where(eq(opportunities.ingestionId, linkedinId)).limit(1);
    await database.insert(feedbackTable).values({
      id: uid(),
      opportunityId: opp.id,
      decision: "wrong_angle",
      reason: "This is a liquidity story, not a distribution story.",
    });
    const rows = await database.select().from(feedbackTable).where(eq(feedbackTable.opportunityId, opp.id));
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toContain("liquidity story");
  });

  it("draft generation lints against Stuart's voice and records revisions", async () => {
    const database = await db();
    const recs = await database.select().from(recommendations).where(eq(recommendations.ingestionId, linkedinId));
    expect(recs.length).toBeGreaterThan(0);
    const draft = await generateDraft(recs[0].opportunityId, "x_post");
    expect(draft.voiceLint.errors).toHaveLength(0);
    const [row] = await database.select().from(draftsTable).where(eq(draftsTable.id, draft.id));
    expect(row.provider).toBe("mock");
  }, 60_000);
});

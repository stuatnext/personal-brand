// Hermetic DB round-trip for the horizon features: two-day story
// continuity, no-development demotion, reprocess unwind, and thesis
// evidence suggestion/triage.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-horizon-"));
process.env.SIGNAL_ROOM_DATA_DIR = scratch;
delete process.env.DATABASE_URL;

import { db, ensureMigrated } from "@/lib/db/client";
import {
  ingestions,
  opportunities,
  recommendations,
  storyClusters,
  storyThreads,
  theses,
  thesisEvidence,
  users,
} from "@/lib/db/schema";
import { processIngestion } from "@/lib/pipeline/run";
import { listTheses } from "@/lib/theses";
import { uid, sha256 } from "@/lib/ids";
import { eq } from "drizzle-orm";

const DAY1 = `Feed post
View Tim Ryan’s profile
Tim Ryan
 • 3rd+
Corporate Banker | Credit Underwriting
1h •
Follow
Goldman Sachs just barred its own employees from trading prediction markets, the same product it is exploring selling to clients. JPMorgan told staff to be cautious about event contracts.

12
`;

const DAY2 = `Feed post
View Priya Natarajan’s profile
Priya Natarajan
 • 2nd
Market structure analyst
2h •
Follow
Goldman Sachs has now extended its prediction markets trading ban to contractors, according to reporting this morning. JPMorgan reportedly followed with a full restriction on event contracts for its own staff yesterday.

31
`;

async function createAndProcess(title: string, raw: string): Promise<string> {
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
    sourceType: "linkedin",
    title,
    rawText: raw,
    rawSha256: sha256(raw),
    wordCount: raw.split(/\s+/).filter(Boolean).length,
    charCount: raw.length,
  });
  await processIngestion(id);
  return id;
}

let day1Id: string;

beforeAll(async () => {
  await ensureMigrated();
  day1Id = await createAndProcess("Day 1: Goldman staff ban", DAY1);
}, 120_000);

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("cross-day story continuity", () => {
  it("day 1 creates a thread with one observation", async () => {
    const database = await db();
    const [cluster] = await database.select().from(storyClusters).where(eq(storyClusters.ingestionId, day1Id));
    expect(cluster.threadId).toBeTruthy();
    const [thread] = await database.select().from(storyThreads).where(eq(storyThreads.id, cluster.threadId!));
    expect(thread.observationCount).toBe(1);
  });

  it("a thesis collects a suggested evidence link from processing", async () => {
    const database = await db();
    const thesisId = uid();
    await database.insert(theses).values({
      id: thesisId,
      statement: "Institutional compliance departments will shape prediction markets faster than regulators do.",
      tagsJson: ["compliance", "institutional"],
    });
    // process day 2 AFTER the thesis exists so suggestions can attach
    const day2Id = await createAndProcess("Day 2: Goldman ban extends", DAY2);

    // continuity assertions
    const [c1] = await database.select().from(storyClusters).where(eq(storyClusters.ingestionId, day1Id));
    const [c2] = await database.select().from(storyClusters).where(eq(storyClusters.ingestionId, day2Id));
    expect(c2.threadId).toBe(c1.threadId);
    const [thread] = await database.select().from(storyThreads).where(eq(storyThreads.id, c2.threadId!));
    expect(thread.observationCount).toBe(2);
    const lastObs = (thread.observationsJson ?? []).slice(-1)[0];
    expect(lastObs.newClaimCount).toBeGreaterThan(0);

    // the day-2 opportunity reports the delta, not a restatement
    const [opp2] = await database.select().from(opportunities).where(eq(opportunities.ingestionId, day2Id));
    expect(opp2.whatChanged).toMatch(/Since \d{4}-\d{2}-\d{2} \(observation 2/);

    // thesis suggestion landed (claims mention compliance/institutions… via keywords)
    const links = await database.select().from(thesisEvidence).where(eq(thesisEvidence.thesisId, thesisId));
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].state).toBe("suggested");

    // triage: confirm one as countering, tally reflects it
    await database
      .update(thesisEvidence)
      .set({ state: "confirmed", stance: "counters" })
      .where(eq(thesisEvidence.id, links[0].id));
    const summaries = await listTheses();
    const summary = summaries.find((s) => s.id === thesisId)!;
    expect(summary.countering).toBe(1);
    expect(summary.suggested).toBe(links.length - 1);
  }, 120_000);

  it("an ingestion repeating the story verbatim is demoted as no-development", async () => {
    const database = await db();
    const day3Id = await createAndProcess("Day 3: same story again", DAY2);
    const [c3] = await database.select().from(storyClusters).where(eq(storyClusters.ingestionId, day3Id));
    const [thread] = await database.select().from(storyThreads).where(eq(storyThreads.id, c3.threadId!));
    expect(thread.observationCount).toBe(3);
    const [opp3] = await database.select().from(opportunities).where(eq(opportunities.ingestionId, day3Id));
    expect(opp3.whatChanged).toContain("No new development");
    // not queued: no recommendation rows for this ingestion
    const recs = await database.select().from(recommendations).where(eq(recommendations.ingestionId, day3Id));
    expect(recs).toHaveLength(0);
  }, 120_000);

  it("reprocessing unwinds and rebuilds the thread observation instead of double-counting", async () => {
    const database = await db();
    const [c1] = await database.select().from(storyClusters).where(eq(storyClusters.ingestionId, day1Id));
    const threadId = c1.threadId!;
    const before = (await database.select().from(storyThreads).where(eq(storyThreads.id, threadId)))[0];
    await processIngestion(day1Id);
    const after = (await database.select().from(storyThreads).where(eq(storyThreads.id, threadId)))[0];
    expect(after.observationCount).toBe(before.observationCount);
    const fromDay1 = (after.observationsJson ?? []).filter((o) => o.ingestionId === day1Id);
    expect(fromDay1).toHaveLength(1);
  }, 120_000);
});

// Hermetic DB round trip for horizon 2: the thread-aware briefing and the
// relationship graph (engagement edges from Use feedback, scoring feed).
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-h2-"));
process.env.SIGNAL_ROOM_DATA_DIR = scratch;
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

import { db, ensureMigrated } from "@/lib/db/client";
import { ingestions, opportunities, theses, users } from "@/lib/db/schema";
import { processIngestion } from "@/lib/pipeline/run";
import { getBriefing, markCaughtUp } from "@/lib/briefing";
import { recordEngagement, engagementByName, personProfile } from "@/lib/graph";
import { uid, sha256 } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { collectFeatures, scoreCluster } from "@/lib/pipeline/score";
import { runPurePipeline } from "@/lib/pipeline/pure";

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

beforeAll(async () => {
  await ensureMigrated();
}, 120_000);

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("thread-aware briefing", () => {
  it("reports new stories, then developments, and resets on catch-up", async () => {
    await createAndProcess("Day 1", DAY1);
    let briefing = await getBriefing();
    expect(briefing.since).toBeNull();
    expect(briefing.newThreads.length).toBeGreaterThan(0);
    expect(briefing.movedThreads).toHaveLength(0); // first sighting is new, not moved

    await markCaughtUp();
    briefing = await getBriefing();
    expect(briefing.newThreads).toHaveLength(0);
    expect(briefing.movedThreads).toHaveLength(0);

    // a thesis + the day-2 development arrive after the marker
    const database = await db();
    await database.insert(theses).values({
      id: uid(),
      statement: "Institutional compliance departments will shape prediction markets faster than regulators do.",
    });
    await createAndProcess("Day 2", DAY2);
    briefing = await getBriefing();
    expect(briefing.movedThreads.length).toBe(1);
    expect(briefing.movedThreads[0].newClaimCount).toBeGreaterThan(0);
    expect(briefing.movedThreads[0].whatChanged).toContain("Since");
    expect(briefing.thesisActivity.length).toBe(1);
    expect(briefing.thesisActivity[0].suggestedSince).toBeGreaterThan(0);
  }, 120_000);
});

describe("relationship graph", () => {
  it("Use feedback writes engagement edges that feed scoring", async () => {
    const database = await db();
    const opps = await database.select().from(opportunities);
    const goldmanOpp = opps.find((o) => o.title.includes("Goldman"))!;
    expect(goldmanOpp).toBeDefined();

    await recordEngagement(goldmanOpp.id, "save"); // not engagement
    expect((await engagementByName()).size).toBe(0);

    await recordEngagement(goldmanOpp.id, "use");
    const map = await engagementByName();
    expect(map.size).toBeGreaterThan(0);
    const authorKey = [...map.keys()].find((k) => k.includes("ryan") || k.includes("natarajan"));
    expect(authorKey).toBeDefined();

    // repeat engagement bumps strength
    const before = map.get(authorKey!)!;
    await recordEngagement(goldmanOpp.id, "use");
    const after = (await engagementByName()).get(authorKey!)!;
    expect(after).toBeGreaterThan(before);

    // person profile shows the edge
    const entityRows = await import("@/lib/db/schema").then((s) => s.entities);
    const people = await database.select().from(entityRows);
    const author = people.find((p) => p.canonicalName.toLowerCase() === authorKey);
    const profile = await personProfile(author!.id);
    expect(profile).not.toBeNull();
    expect(profile!.edges.some((e) => e.relationship === "stuart_engaged_with")).toBe(true);
    expect(profile!.recentItems.length).toBeGreaterThan(0);
  }, 60_000);

  it("known engagement raises relationship_value with a visible reason", () => {
    const run = runPurePipeline(DAY2, "linkedin");
    const cluster = run.clusters[0];
    const items = new Map(run.items.map((i) => [i.tempId, i]));
    const base = scoreCluster(
      collectFeatures(cluster, items, run.claims, run.mentions, false, [], false, undefined, new Map()),
    );
    const boosted = scoreCluster(
      collectFeatures(
        cluster,
        items,
        run.claims,
        run.mentions,
        false,
        [],
        false,
        undefined,
        new Map([["priya natarajan", 0.6]]),
      ),
    );
    const dim = (s: typeof base, name: string) => s.find((x) => x.dimension === name)!;
    expect(dim(boosted, "relationship_value").score).toBeGreaterThan(dim(base, "relationship_value").score);
    expect(dim(boosted, "relationship_value").reason).toContain("engaged with");
  });
});

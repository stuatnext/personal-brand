// Hermetic DB round trip for outreach states on the relationship graph:
// prospect edges are born identified, a dm/email draft advances them to
// drafted (both orderings), Stuart records everything from `sent` by hand
// (audit-logged), introductions attach an introducer, and the pipeline view
// groups it all by lane. The system itself never sends anything.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-outreach-"));
process.env.SIGNAL_ROOM_DATA_DIR = scratch;
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

import { db, ensureMigrated } from "@/lib/db/client";
import { auditLog, entities, ingestions, opportunities, relationships, users } from "@/lib/db/schema";
import { processIngestion } from "@/lib/pipeline/run";
import {
  engagementByName,
  getPipeline,
  personProfile,
  recordEngagement,
  recordIntroduction,
  setOutreachState,
} from "@/lib/graph";
import { generateDraft } from "@/lib/drafts";
import { uid, sha256 } from "@/lib/ids";
import { and, eq } from "drizzle-orm";

const BANKS_POST = `Feed post
View Tim Ryan’s profile
Tim Ryan
 • 3rd+
Corporate Banker | Credit Underwriting
1h •
Follow
Goldman Sachs just barred its own employees from trading prediction markets, the same product it is exploring selling to clients. JPMorgan told staff to be cautious about event contracts.

12
`;

const BROKER_POST = `Feed post
View Alex Kim’s profile
Alex Kim
 • 2nd
Fintech distribution analyst
2h •
Follow
Robinhood is reportedly preparing a dedicated event contracts hub inside its app, according to two people familiar with the plan. Distribution changes who reaches retail first.

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

async function opportunityContaining(word: string) {
  const database = await db();
  const opps = await database.select().from(opportunities);
  const opp = opps.find((o) => o.title.toLowerCase().includes(word.toLowerCase()));
  expect(opp, `opportunity mentioning ${word}`).toBeDefined();
  return opp!;
}

async function prospectEdgeFor(name: string) {
  const database = await db();
  const [entity] = await database
    .select()
    .from(entities)
    .where(and(eq(entities.kind, "company"), eq(entities.canonicalName, name)));
  expect(entity, `entity ${name}`).toBeDefined();
  const edges = await database.select().from(relationships).where(eq(relationships.fromEntityId, entity.id));
  return { entity, edge: edges.find((e) => e.relationship.endsWith("prospect") || e.relationship === "media_contact") };
}

beforeAll(async () => {
  await ensureMigrated();
}, 120_000);

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("outreach states", () => {
  it("use-then-draft: edges are born identified and advance to drafted on a dm/email draft", async () => {
    await createAndProcess("Banks", BANKS_POST);
    const opp = await opportunityContaining("Goldman");
    const database = await db();
    await database.update(opportunities).set({ recommendedAction: "speaker_lead" }).where(eq(opportunities.id, opp.id));

    await recordEngagement(opp.id, "use");
    let { edge } = await prospectEdgeFor("Goldman Sachs");
    expect(edge).toBeDefined();
    expect(edge!.relationship).toBe("speaker_prospect");
    expect(edge!.state).toBe("identified");

    // a linkedin post draft is not outreach: state must not move
    await generateDraft(opp.id, "linkedin_post");
    ({ edge } = await prospectEdgeFor("Goldman Sachs"));
    expect(edge!.state).toBe("identified");

    // an email draft is outreach: identified -> drafted, audit-logged as system
    await generateDraft(opp.id, "email");
    ({ edge } = await prospectEdgeFor("Goldman Sachs"));
    expect(edge!.state).toBe("drafted");
    const audits = await database
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "outreach_state_change"), eq(auditLog.scopeId, edge!.id)));
    expect(audits.length).toBe(1);
    expect(audits[0].actor).toBe("system");
    expect(audits[0].detailJson).toMatchObject({ from: "identified", to: "drafted" });
  }, 120_000);

  it("draft-then-use: an edge created after the draft exists is born drafted", async () => {
    await createAndProcess("Broker", BROKER_POST);
    const opp = await opportunityContaining("Robinhood");
    const database = await db();
    await database.update(opportunities).set({ recommendedAction: "sponsor_lead" }).where(eq(opportunities.id, opp.id));

    await generateDraft(opp.id, "dm"); // no edges yet; nothing to advance
    await recordEngagement(opp.id, "use");
    const { edge } = await prospectEdgeFor("Robinhood");
    expect(edge).toBeDefined();
    expect(edge!.relationship).toBe("sponsor_prospect");
    expect(edge!.state).toBe("drafted");
  }, 120_000);

  it("Stuart records sent/replied by hand; every move is audit-logged", async () => {
    const { edge } = await prospectEdgeFor("Goldman Sachs");
    const database = await db();

    await setOutreachState(edge!.id, "sent", "sent the intro email myself, 20 July");
    let [row] = await database.select().from(relationships).where(eq(relationships.id, edge!.id));
    expect(row.state).toBe("sent");
    expect(row.note).toContain("myself");

    await setOutreachState(edge!.id, "replied");
    [row] = await database.select().from(relationships).where(eq(relationships.id, edge!.id));
    expect(row.state).toBe("replied");

    const audits = await database
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "outreach_state_change"), eq(auditLog.scopeId, edge!.id)));
    const manual = audits.filter((a) => a.actor === "stuart");
    expect(manual.length).toBe(2);
    expect(manual.map((a) => (a.detailJson as { to: string }).to).sort()).toEqual(["replied", "sent"]);
  });

  it("rejects unknown states and non-prospect edges", async () => {
    const { edge } = await prospectEdgeFor("Goldman Sachs");
    await expect(setOutreachState(edge!.id, "ghosted")).rejects.toThrow("unknown outreach state");

    const database = await db();
    const engaged = await database
      .select()
      .from(relationships)
      .where(eq(relationships.relationship, "stuart_engaged_with"));
    expect(engaged.length).toBeGreaterThan(0);
    await expect(setOutreachState(engaged[0].id, "sent")).rejects.toThrow("do not carry outreach state");
  });

  it("repeat engagement bumps strength without resetting the state", async () => {
    const opp = await opportunityContaining("Goldman");
    const before = await prospectEdgeFor("Goldman Sachs");
    await recordEngagement(opp.id, "use");
    const after = await prospectEdgeFor("Goldman Sachs");
    expect(after.edge!.strength).toBeGreaterThan(before.edge!.strength);
    expect(after.edge!.state).toBe("replied"); // not reset to identified
    expect((await engagementByName()).size).toBeGreaterThan(0);
  });
});

describe("introductions", () => {
  it("records who introduced a prospect, creating the introducer once", async () => {
    const { entity } = await prospectEdgeFor("Goldman Sachs");
    const first = await recordIntroduction(entity.id, "Rebecca Kossnick", "met through the Forecast alumni network");
    const again = await recordIntroduction(entity.id, "rebecca kossnick");
    expect(again.introducerId).toBe(first.introducerId); // found by name, not duplicated
    expect(again.edgeId).toBe(first.edgeId);

    const profile = await personProfile(entity.id);
    const intro = profile!.edges.find((e) => e.relationship === "introduced_by");
    expect(intro).toBeDefined();
    expect(intro!.withName).toBe("Rebecca Kossnick");
    expect(intro!.isProspect).toBe(false);
  });

  it("refuses self-introductions", async () => {
    const database = await db();
    const [rebecca] = await database
      .select()
      .from(entities)
      .where(and(eq(entities.kind, "person"), eq(entities.canonicalName, "Rebecca Kossnick")));
    await expect(recordIntroduction(rebecca.id, "Rebecca Kossnick")).rejects.toThrow("cannot introduce itself");
  });
});

describe("pipeline view", () => {
  it("groups prospect edges by lane with states, introducers and totals", async () => {
    const { lanes, totalsByState } = await getPipeline();
    const laneNames = lanes.map((l) => l.relationship);
    expect(laneNames).toContain("speaker_prospect");
    expect(laneNames).toContain("sponsor_prospect");

    const speakers = lanes.find((l) => l.relationship === "speaker_prospect")!;
    const goldman = speakers.rows.find((r) => r.name === "Goldman Sachs");
    expect(goldman).toBeDefined();
    expect(goldman!.state).toBe("replied");
    expect(goldman!.introducedBy).toBe("Rebecca Kossnick");

    const sponsors = lanes.find((l) => l.relationship === "sponsor_prospect")!;
    expect(sponsors.rows.some((r) => r.name === "Robinhood" && r.state === "drafted")).toBe(true);

    expect(totalsByState.replied).toBeGreaterThanOrEqual(1);
    expect(totalsByState.drafted).toBeGreaterThanOrEqual(1);
  });
});

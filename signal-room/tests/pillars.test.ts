// Multi-pillar behaviour: pillar-keyed relevance and routing, brand-keyed
// outreach vocabulary, per-pillar positioning and sign-offs, collector
// source prefixes, and the queue's cross-pillar balance (hermetic DB).
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-pillars-"));
process.env.SIGNAL_ROOM_DATA_DIR = scratch;
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

import { pillarConfig, isPillar, PILLAR_OPTIONS } from "@/lib/pillars";
import { lintVoice } from "@/lib/voice/lint";
import { MockProvider } from "@/lib/ai/mock";
import { stuartVoiceSystem } from "@/lib/ai/prompts";
import { runPurePipeline, opportunityByMarker } from "@/lib/pipeline/pure";
import { parsePillarSources } from "@/lib/collectors/feeds";
import { db, ensureMigrated } from "@/lib/db/client";
import { ingestions, opportunities, recommendations, storyClusters, users } from "@/lib/db/schema";
import { getTodayQueue } from "@/lib/queue";
import { uid, sha256 } from "@/lib/ids";
import type { DraftContext } from "@/lib/ai/provider";

const IG_POST = `Feed post
View Mia Torres’s profile
Mia Torres
 • 2nd
iGaming M&A analyst
2h •
Follow
Flutter Entertainment has launched its sportsbook and casino offering in Brazil under the new federal licensing regime, according to this morning's filing coverage. The regulated market entry puts pressure on every operator still waiting on a licence.

214
`;

const baseCtx = (pillar: string, draftType = "email"): DraftContext => ({
  draftType,
  opportunityTitle: "Test story",
  whatHappened: "…",
  stuartAngle: "…",
  editorialAngle: "…",
  claimedSummary: "…",
  confirmedSummary: "…",
  allowedEvidence: [],
  hasUnverifiedClaims: true,
  pillar,
});

describe("pillar config", () => {
  it("resolves keys, defaults to prediction markets, lists three options", () => {
    expect(pillarConfig("igaming").brand).toBe("NEXT.io");
    expect(pillarConfig(undefined).key).toBe("prediction_markets");
    expect(pillarConfig("nonsense").key).toBe("prediction_markets");
    expect(isPillar("strait_up_growth")).toBe(true);
    expect(isPillar("gaming")).toBe(false);
    expect(PILLAR_OPTIONS).toHaveLength(3);
  });
});

describe("brand-keyed outreach vocabulary", () => {
  const copy = "Keen to hear how you are seeing the sportsbook side of this.";

  it("bans betting vocabulary only in NEXTPredict copy", () => {
    const pm = lintVoice(copy, { outreach: true, pillar: "prediction_markets" });
    expect(pm.errors.some((e) => e.rule === "outreach_banned" && /sportsbook/i.test(e.match))).toBe(true);
    const ig = lintVoice(copy, { outreach: true, pillar: "igaming" });
    expect(ig.errors.filter((e) => e.rule === "outreach_banned")).toHaveLength(0);
    // default pillar stays NEXTPredict-strict
    const def = lintVoice(copy, { outreach: true });
    expect(def.errors.some((e) => e.rule === "outreach_banned")).toBe(true);
  });

  it("keeps Stuart-global outreach bans for every brand", () => {
    for (const pillar of ["prediction_markets", "igaming", "strait_up_growth"]) {
      const res = lintVoice("Would love to compare notes on this.", { outreach: true, pillar });
      expect(res.errors.some((e) => e.rule === "outreach_banned" && /compare notes/i.test(e.match))).toBe(true);
    }
  });
});

describe("per-pillar outreach positioning and sign-off", () => {
  const mock = new MockProvider();

  it("keeps the confirmed NEXTPredict sign-off for prediction markets", async () => {
    const email = await mock.generateDraft(baseCtx("prediction_markets"));
    expect(email).toContain("Commercial Director, NEXTPredict");
    expect(email).toContain("I'm building NEXTPredict");
  });

  it("never invents a title for the other brands", async () => {
    const ig = await mock.generateDraft(baseCtx("igaming"));
    expect(ig).toContain("[YOUR TITLE], NEXT.io");
    expect(ig).not.toContain("NEXTPredict");
    const sug = await mock.generateDraft(baseCtx("strait_up_growth"));
    expect(sug).toContain("[YOUR TITLE], Strait Up Growth");
    expect(sug).toContain("Strait Up Growth, a consultancy");
    expect(sug).not.toContain("NEXTPredict");
  });

  it("dm positioning follows the pillar too", async () => {
    const dm = await mock.generateDraft(baseCtx("igaming", "dm"));
    expect(dm).toContain("NEXT.io");
    expect(dm).not.toContain("NEXTPredict");
  });

  it("the live-provider system prompt swaps the seat, never the voice", () => {
    const pm = stuartVoiceSystem("prediction_markets");
    const ig = stuartVoiceSystem("igaming");
    const sug = stuartVoiceSystem("strait_up_growth");
    expect(pm).toContain("NEXTPredict");
    expect(ig).toContain("NEXT.io");
    expect(sug).toContain("Strait Up Growth");
    for (const sys of [pm, ig, sug]) {
      expect(sys).toContain("Never use em dashes");
      expect(sys).toContain("EVIDENCE DISCIPLINE");
    }
  });
});

describe("pillar routing in the pipeline", () => {
  it("the same iGaming story is a move in its lane and off-topic outside it", () => {
    const ig = runPurePipeline(IG_POST, "linkedin", undefined, "igaming");
    const igOpp = opportunityByMarker(ig, "launched its sportsbook");
    expect(igOpp).toBeDefined();
    expect(igOpp!.recommendedAction).not.toBe("ignore");
    const rel = igOpp!.scores.find((s) => s.dimension === "nextpredict_relevance")!;
    expect(rel.score).toBeGreaterThanOrEqual(40);
    expect(rel.reason).toContain("iGaming");

    const pm = runPurePipeline(IG_POST, "linkedin", undefined, "prediction_markets");
    const pmOpp = opportunityByMarker(pm, "launched its sportsbook");
    expect(pmOpp!.recommendedAction).toBe("ignore");
    expect(pmOpp!.queued).toBe(false);
  });
});

describe("collector source prefixes", () => {
  it("parses pillar-prefixed sources and leaves plain URLs on the default", () => {
    const parsed = parsePillarSources(
      "igaming:https://feeds.example.com/igb.xml, https://www.cftc.gov/rss, strait_up_growth:UCabc123",
    );
    expect(parsed).toEqual([
      { pillar: "igaming", source: "https://feeds.example.com/igb.xml" },
      { pillar: "prediction_markets", source: "https://www.cftc.gov/rss" },
      { pillar: "strait_up_growth", source: "UCabc123" },
    ]);
  });
});

describe("queue pillar balance (hermetic DB)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    const database = await db();
    const userId = uid();
    await database.insert(users).values({ id: userId, email: "stuart@next.io", name: "Stuart Crowley" });
    const mkIngestion = async (pillar: string) => {
      const id = uid();
      await database.insert(ingestions).values({
        id,
        userId,
        sourceType: "linkedin",
        pillar,
        title: `${pillar} drop`,
        rawText: "x",
        rawSha256: sha256(pillar),
      });
      return id;
    };
    const pmIngestion = await mkIngestion("prediction_markets");
    const sugIngestion = await mkIngestion("strait_up_growth");
    const queueDate = new Date().toISOString().slice(0, 10);
    // five strong PM opportunities and one weaker SUG one
    const rows = [
      { pillar: "prediction_markets", ingestionId: pmIngestion, score: 90 },
      { pillar: "prediction_markets", ingestionId: pmIngestion, score: 88 },
      { pillar: "prediction_markets", ingestionId: pmIngestion, score: 86 },
      { pillar: "prediction_markets", ingestionId: pmIngestion, score: 84 },
      { pillar: "prediction_markets", ingestionId: pmIngestion, score: 82 },
      { pillar: "strait_up_growth", ingestionId: sugIngestion, score: 55 },
    ];
    for (const [i, r] of rows.entries()) {
      const clusterId = uid();
      await database.insert(storyClusters).values({
        id: clusterId,
        ingestionId: r.ingestionId,
        canonicalTitle: `${r.pillar} story ${i}`,
      });
      const oppId = uid();
      await database.insert(opportunities).values({
        id: oppId,
        ingestionId: r.ingestionId,
        storyClusterId: clusterId,
        title: `${r.pillar} story ${i}`,
        pillar: r.pillar,
        recommendedAction: "linkedin_post",
        overallScore: r.score,
        status: "proposed",
      });
      await database.insert(recommendations).values({
        id: uid(),
        opportunityId: oppId,
        ingestionId: r.ingestionId,
        queueDate,
        position: i,
        primaryAction: "linkedin_post",
        status: "open",
      });
    }
  }, 120_000);

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("caps a single pillar at 3 of 5 when another pillar has open work", async () => {
    const queue = await getTodayQueue();
    expect(queue.length).toBeGreaterThanOrEqual(4);
    const pmCount = queue.filter((q) => q.pillar === "prediction_markets").length;
    expect(pmCount).toBeLessThanOrEqual(3);
    expect(queue.some((q) => q.pillar === "strait_up_growth")).toBe(true);
  });
});

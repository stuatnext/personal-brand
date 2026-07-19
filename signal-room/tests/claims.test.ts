import { describe, expect, it } from "vitest";
import { runPurePipeline } from "@/lib/pipeline/pure";
import { isClaimSentence, splitSentences } from "@/lib/pipeline/claims";

describe("claim sentence detection", () => {
  it("flags factual assertions", () => {
    expect(isClaimSentence("Goldman Sachs barred employees from trading prediction markets this week.")).toBe(true);
    expect(isClaimSentence("The company raised $14m in a Series A led by Founders Fund.")).toBe(true);
    expect(isClaimSentence("The CFTC approved the designation application on Friday morning.")).toBe(true);
  });
  it("skips opinion and questions", () => {
    expect(isClaimSentence("I think prediction markets are going to matter a great deal.")).toBe(false);
    expect(isClaimSentence("What would it take for liquidity to move on-chain here?")).toBe(false);
  });
});

describe("repetition vs corroboration", () => {
  it("treats twenty copies of one claim as one source, not twenty confirmations", () => {
    const posts = Array.from({ length: 5 }, (_, i) =>
      [
        `Account${i}`,
        `@account${i}`,
        "·",
        "1h",
        "Polymarket has reportedly signed a market data distribution deal with a major terminal provider, per industry sources.",
        "2",
        "4",
        "11",
        "1K",
        "Views",
        "",
      ].join("\n"),
    ).join("\n");
    const run = runPurePipeline(posts, "x");
    const claim = run.claims.find((c) => c.claimText.includes("market data distribution"));
    expect(claim).toBeDefined();
    expect(claim!.status).toBe("social_claim_only");
    const independent = claim!.evidence.filter((e) => e.independent).length;
    expect(independent).toBe(1);
    expect(claim!.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("marks self-announcements as primary source, not social rumour", () => {
    const run = runPurePipeline(
      [
        "Feed post",
        "View Shay Segev’s profile",
        "Shay Segev",
        "  • Following",
        "Chief Executive Officer at DAZN Group",
        "1h • ",
        "DAZN and ADI Predictstreet are announcing an exclusive global partnership to build regulated sports prediction markets.",
        "",
        "8",
      ].join("\n"),
      "linkedin",
    );
    const claim = run.claims.find((c) => c.claimText.includes("exclusive global partnership"));
    expect(claim?.status).toBe("primary_source_found");
  });

  it("keeps aggregator posts as reported, not self-sourced", () => {
    const run = runPurePipeline(
      [
        "Feed post",
        "View company: Crypto Breaking News",
        "Crypto Breaking News",
        "1h • ",
        "Follow",
        "Base network creator Jesse Pollak says he is stepping back from leading the Base App after a wrong bet on social.",
        "",
        "2",
      ].join("\n"),
      "linkedin",
    );
    const claim = run.claims.find((c) => c.claimText.includes("stepping back"));
    expect(claim).toBeDefined();
    expect(claim!.status).toBe("reported");
  });

  it("links every claim to at least one evidence excerpt", () => {
    const run = runPurePipeline(
      "Feed post\nView A B’s profile\nA B\n • 2nd\nAnalyst\n1h • \nKalshi launched congressional trading contracts and volume reached $2m in the first day, according to the exchange.\n\n3\n",
      "linkedin",
    );
    expect(run.claims.length).toBeGreaterThan(0);
    for (const claim of run.claims) {
      expect(claim.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("sentence splitting", () => {
  it("keeps sentences intact", () => {
    const sentences = splitSentences("First sentence here is long enough. Second one is also long enough to count.");
    expect(sentences).toHaveLength(2);
  });
});

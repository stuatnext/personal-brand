import { describe, expect, it } from "vitest";
import { runPurePipeline } from "@/lib/pipeline/pure";
import {
  buildClusterSignature,
  bestThreadMatch,
  isThreadMatch,
  scoreThreadMatch,
  mergeSignature,
  newClaimsAgainstThread,
} from "@/lib/pipeline/threads";

const DAY1 = `Feed post
View Tim Ryan’s profile
Tim Ryan
 • 3rd+
Corporate Banker | Credit Underwriting
1h •
Follow
Goldman Sachs just barred its own employees from trading prediction markets, the same product it is exploring selling to clients. JPMorgan told staff to be cautious.

12
`;

const DAY2 = `Feed post
View Priya Natarajan’s profile
Priya Natarajan
 • 2nd
Market structure analyst
2h •
Follow
Goldman Sachs has now extended its prediction markets trading ban to contractors, according to reporting this morning. JPMorgan reportedly followed with a full restriction of its own staff yesterday.

31
`;

const UNRELATED = `Feed post
View Ana Ruiz’s profile
Ana Ruiz
 • 2nd
Payments analyst
1h •
Follow
Stripe is reportedly piloting stablecoin settlement for marketplace payouts in three markets. Nothing to do with event contracts at all.

4
`;

function signatureFor(text: string) {
  const run = runPurePipeline(text, "linkedin");
  const cluster = run.clusters[0];
  const items = new Map(run.items.map((i) => [i.tempId, i]));
  return {
    run,
    sig: buildClusterSignature(cluster, items, run.mentions, run.claims),
  };
}

describe("story thread matching", () => {
  it("links the same story across days on entity agreement plus wording echo", () => {
    const day1 = signatureFor(DAY1);
    const day2 = signatureFor(DAY2);
    const thread = { id: "t1", signature: { ...day1.sig } };
    const match = scoreThreadMatch(day2.sig, thread);
    expect(match.sharedEntities).toBeGreaterThanOrEqual(2); // Goldman + JPMorgan
    expect(isThreadMatch(match)).toBe(true);
    expect(bestThreadMatch(day2.sig, [thread])?.threadId).toBe("t1");
  });

  it("does not link an unrelated story", () => {
    const day1 = signatureFor(DAY1);
    const other = signatureFor(UNRELATED);
    const thread = { id: "t1", signature: { ...day1.sig } };
    expect(bestThreadMatch(other.sig, [thread])).toBeNull();
  });

  it("detects which claims are genuinely new on the thread", () => {
    const day1 = signatureFor(DAY1);
    const day2 = signatureFor(DAY2);
    const day2Claims = day2.run.claims;
    const fresh = newClaimsAgainstThread(day1.sig, day2Claims);
    // day 2 has real developments (contractor extension, JPM full restriction)
    expect(fresh.length).toBeGreaterThan(0);
    // an identical rerun of day 1 against its own signature yields nothing new
    const day1Again = signatureFor(DAY1);
    expect(newClaimsAgainstThread(day1.sig, day1Again.run.claims)).toHaveLength(0);
  });

  it("merges signatures without unbounded growth", () => {
    const day1 = signatureFor(DAY1);
    const day2 = signatureFor(DAY2);
    const merged = mergeSignature(day1.sig, day2.sig);
    expect(merged.entities.length).toBeGreaterThanOrEqual(day1.sig.entities.length);
    expect(merged.claimHashes.length).toBeLessThanOrEqual(400);
    for (const h of day1.sig.claimHashes) expect(merged.claimHashes).toContain(h);
  });
});

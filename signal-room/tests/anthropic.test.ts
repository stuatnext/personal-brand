// Anthropic provider behaviour against a stubbed fetch: parsing, retry on
// transient failures, timeout surfacing, and the voice-lint corrective
// pass. No network, no key, no tokens — the live path itself is exercised
// by scripts/shakedown.ts once a key exists.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider, callClaude } from "@/lib/ai/anthropic";
import type { DraftContext } from "@/lib/ai/provider";

function apiResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CTX: DraftContext = {
  draftType: "x_post",
  opportunityTitle: "Goldman story",
  whatHappened: "…",
  stuartAngle: "…",
  editorialAngle: "…",
  claimedSummary: "…",
  confirmedSummary: "…",
  allowedEvidence: [
    { excerpt: "Goldman barred staff", attribution: "Tim Ryan on linkedin", status: "reported", permissionLevel: "public" },
  ],
  hasUnverifiedClaims: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callClaude", () => {
  it("parses a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => apiResponse("hello world")));
    const out = await callClaude({ model: "m", system: "s", user: "u" });
    expect(out).toBe("hello world");
  });

  it("retries a 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(apiResponse("after retry"));
    vi.stubGlobal("fetch", fetchMock);
    const out = await callClaude({ model: "m", system: "s", user: "u" });
    expect(out).toBe("after retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 and surfaces the error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callClaude({ model: "m", system: "s", user: "u" })).rejects.toThrow("400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network failures and gives up with the last error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callClaude({ model: "m", system: "s", user: "u" })).rejects.toThrow("socket hang up");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 30_000);
});

describe("AnthropicProvider voice-corrective pass", () => {
  it("re-asks when the first draft violates voice rules", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse("A bold claim — with an em dash."))
      .mockResolvedValueOnce(apiResponse("A bold claim, without an em dash."));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider();
    const draft = await provider.generateDraft(CTX);
    expect(draft).toBe("A bold claim, without an em dash.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.messages[0].content).toContain("violated Stuart's voice rules");
  });

  it("accepts a clean first draft without a second call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse("Clean draft, no banned phrasing."));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider();
    const draft = await provider.generateDraft(CTX);
    expect(draft).toContain("Clean draft");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses refineEditorial responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => apiResponse("RATIONALE: Because reasons.\nANGLE: The angle text.")),
    );
    const provider = new AnthropicProvider();
    const refined = await provider.refineEditorial({
      clusterTitle: "t",
      evidence: [],
      heuristicRationale: "r",
      heuristicAngle: "a",
    });
    expect(refined).toEqual({ rationale: "Because reasons.", angle: "The angle text." });
  });
});

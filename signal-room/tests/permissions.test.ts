import { describe, expect, it } from "vitest";
import { detectLeaks, defaultPermissionForSource, isPublishable } from "@/lib/permissions";
import { runPurePipeline, draftContextFor } from "@/lib/pipeline/pure";
import { MockProvider } from "@/lib/ai/mock";
import fs from "fs";
import path from "path";

const PRIVATE_TEXT =
  "We priced a white-label clearing integration for one of the big two recently and the internal budget conversation stalled at 85,000 dollars a year. We're announcing a partnership with a top-five US venue on the ninth of September, under embargo.";

describe("permission levels", () => {
  it("derives restrictive defaults for private source types", () => {
    expect(defaultPermissionForSource("call_transcript")).toBe("private");
    expect(defaultPermissionForSource("internal_notes")).toBe("internal_only");
    expect(defaultPermissionForSource("linkedin")).toBe("public");
  });
  it("classifies publishable levels", () => {
    expect(isPublishable("public")).toBe(true);
    expect(isPublishable("public_with_attribution")).toBe(true);
    expect(isPublishable("private")).toBe(false);
    expect(isPublishable("embargoed")).toBe(false);
    expect(isPublishable("commercially_sensitive")).toBe(false);
  });
});

describe("leak detection", () => {
  const restricted = [{ id: "r1", kind: "source_item" as const, level: "private", text: PRIVATE_TEXT }];

  it("catches verbatim fragments of restricted material", () => {
    const draft = "One venue's internal budget conversation stalled at a white-label clearing integration recently.";
    const warnings = detectLeaks(draft, restricted);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("catches distinctive figures from restricted material", () => {
    const draft = "I hear clearing integrations are being priced around 85,000 dollars a year.";
    const warnings = detectLeaks(draft, restricted);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("passes clean, unrelated drafts", () => {
    const draft =
      "Prediction market venues keep talking about listings while the settlement layer stays underdiscussed. The infrastructure conversation deserves more attention than it gets.";
    expect(detectLeaks(draft, restricted)).toHaveLength(0);
  });
});

describe("structural guard: private evidence never reaches the writing agent", () => {
  it("call-transcript drafts contain no restricted content", async () => {
    const raw = fs.readFileSync(path.join(__dirname, "../fixtures/call-transcript.txt"), "utf8");
    const run = runPurePipeline(raw, "call_transcript");
    const ctx = draftContextFor(run, "underinvesting in post-trade", "linkedin_post");
    expect(ctx).toBeDefined();
    // allowed evidence must be empty: nothing in a private call is publishable
    expect(ctx!.allowedEvidence).toHaveLength(0);
    const draft = await new MockProvider().generateDraft(ctx!);
    for (const forbidden of ["85,000", "85000", "ninth of September", "Meridian", "Dana"]) {
      expect(draft.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(draft).toContain("NO PUBLISHABLE EVIDENCE");
  });
});

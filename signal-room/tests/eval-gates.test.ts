// The gold-set evaluation is part of the test suite: the eval runner exits
// non-zero if any quality gate fails (leakage, voice, traceability,
// extraction, duplicates, clustering, action accuracy, queue discipline).
import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import path from "path";

describe("gold-set evaluation gates", () => {
  it("passes every quality gate", () => {
    const out = execFileSync("npx", ["tsx", "scripts/eval.ts"], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      timeout: 240_000,
    });
    expect(out).toContain("All quality gates passed.");
  }, 240_000);
});

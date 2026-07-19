import { describe, expect, it } from "vitest";
import { lintVoice } from "@/lib/voice/lint";

const rules = (r: { errors: { rule: string }[]; warnings: { rule: string }[] }) => ({
  errors: r.errors.map((e) => e.rule),
  warnings: r.warnings.map((w) => w.rule),
});

describe("voice linter (Stuart's rules)", () => {
  it("hard-errors em dashes", () => {
    expect(rules(lintVoice("Prediction markets — the new frontier.")).errors).toContain("em_dash");
  });

  it("hard-errors the banned-phrase canon", () => {
    for (const phrase of [
      "This is a game changer for the sector.",
      "Exciting times ahead for everyone involved.",
      "A fascinating development in market structure.",
      "We are at an inflection point in adoption.",
      "This highlights the maturity of the category.",
      "Part of a broader trend across finance.",
      "We are witnessing the birth of an asset class.",
    ]) {
      const result = lintVoice(phrase);
      expect(result.errors.length, phrase).toBeGreaterThan(0);
    }
  });

  it("hard-errors negative parallelism constructions", () => {
    for (const s of [
      "This is not just a product launch, but a statement of intent.",
      "Not only did volume grow, but the spread tightened.",
      "It is not about the technology, it is about distribution.",
      "The question is not whether they list, it is when.",
    ]) {
      expect(rules(lintVoice(s)).errors, s).toContain("negative_parallelism");
    }
  });

  it("errors on unhedged figures when claims are unverified", () => {
    const bad = lintVoice("Volume hit $40M in week one and the market is now the deepest available.", {
      hasUnverifiedClaims: true,
    });
    expect(rules(bad).errors).toContain("unhedged_figure");
    const good = lintVoice("Volume reportedly hit $40M in week one, if the number is right.", {
      hasUnverifiedClaims: true,
    });
    expect(rules(good).errors).not.toContain("unhedged_figure");
  });

  it("warns on theatrical one-line stacking", () => {
    const stacked = "A trading product.\nA sportsbook in a blazer.\nA new information layer.\nAnd more.";
    expect(rules(lintVoice(stacked)).warnings).toContain("one_line_stacking");
  });

  it("warns on forced CTAs and false certainty", () => {
    expect(rules(lintVoice("Register now before tickets sell out.")).warnings).toContain("forced_cta");
    expect(rules(lintVoice("This confirms the thesis definitively.")).warnings).toContain("false_certainty");
  });

  it("applies the NEXTPredict outreach bans only to outreach drafts", () => {
    const text = "The betting industry perspective would be useful; happy to compare notes.";
    expect(lintVoice(text).errors).toHaveLength(0);
    const outreach = lintVoice(text, { outreach: true });
    expect(rules(outreach).errors).toContain("outreach_banned");
  });

  it("passes clean Stuart-register copy", () => {
    const clean = `Goldman has barred its own staff from trading prediction markets, according to reporting this week. That reads less like caution and more like a compliance department deciding event contracts are now a real asset class.

The commercial question is who gets to distribute these products once the big institutions finish writing their internal rules. Distribution has quietly decided every market structure fight of the last decade.

What's the piece I'm missing here?`;
    const result = lintVoice(clean, { hasUnverifiedClaims: true });
    expect(result.errors).toHaveLength(0);
  });
});

import type { DraftContext, LLMProvider } from "./provider";
import { pillarConfig } from "@/lib/pillars";

// Deterministic local provider (no API key). Drafts are honest skeletons:
// they quote allowed evidence with hedged attribution and leave Stuart's
// judgement as bracketed slots instead of inventing prose or facts. This is
// the same convention as the parent repo's mock AI provider, and it is
// labelled in the UI wherever drafts appear.

function hedgeFor(status: string): string {
  switch (status) {
    case "corroborated":
    case "verified":
    case "primary_source_found":
      return "";
    case "reported":
      return "reportedly ";
    default:
      return "according to the post, ";
  }
}

function firstEvidence(ctx: DraftContext): { line: string; attribution: string } {
  const e = ctx.allowedEvidence[0];
  if (!e) {
    return {
      line: "[NO PUBLISHABLE EVIDENCE AVAILABLE: this opportunity's material is restricted or empty. Do not publish anything factual.]",
      attribution: "",
    };
  }
  const excerpt = e.excerpt.length > 200 ? e.excerpt.slice(0, 199).trimEnd() + "…" : e.excerpt;
  return { line: `${hedgeFor(e.status)}"${excerpt}" (${e.attribution})`, attribution: e.attribution };
}

export class MockProvider implements LLMProvider {
  name = "mock";
  isReal = false;

  async generateDraft(ctx: DraftContext): Promise<string> {
    const { line } = firstEvidence(ctx);
    const reaction = ctx.stuartReaction?.trim();
    const reactionOrSlot = reaction
      ? reaction
      : `[STUART: your actual read on this. Suggested direction: ${ctx.editorialAngle}]`;

    switch (ctx.draftType) {
      case "x_post":
        return [
          `Worth noticing: ${line}.`,
          ``,
          `${reactionOrSlot}`,
          ``,
          `[OPTIONAL: one sharp question for the room.]`,
        ].join("\n");

      case "x_quote_post":
        return [`${reactionOrSlot}`, ``, `The detail that matters here: ${line}.`].join("\n");

      case "x_comment":
        return [
          `${reactionOrSlot}`,
          ``,
          `[KEEP IT SHORT: one angle the original post is missing, no repetition of what they said.]`,
        ].join("\n");

      case "linkedin_post":
        return [
          `${line.charAt(0).toUpperCase()}${line.slice(1)}.`,
          ``,
          `${reactionOrSlot}`,
          ``,
          `[COMMERCIAL READ: what this means for ${ctx.opportunityTitle ? "the people building in this category" : "the category"}. Ground it in the evidence above; add nothing that is not sourced.]`,
          ``,
          `[CLOSING QUESTION: widen it into the category question worth asking. No call to action.]`,
        ].join("\n");

      case "linkedin_comment":
        return [
          `${reactionOrSlot}`,
          ``,
          `[ADD THE MISSING ANGLE: ${ctx.editorialAngle} Do not repeat the post; add the read it lacks.]`,
        ].join("\n");

      case "forum_post":
        return [
          `Context for the group: ${line}.`,
          ``,
          `[ONE CLEAR PRACTITIONER QUESTION, e.g. "What have you seen in practice?" or "Which risk gets underestimated here?"]`,
        ].join("\n");

      case "dm": {
        const pillar = pillarConfig(ctx.pillar);
        return [
          `[GREETING by first name]`,
          ``,
          `I saw your post on this (${ctx.opportunityTitle}). ${reaction ? reaction : "[STUART: the one genuine observation that made you want to reach out.]"}`,
          ``,
          `${pillar.outreachPositioningLine} Would genuinely value hearing how you're seeing this space. 20 minutes over the next couple of weeks?`,
        ].join("\n");
      }

      case "email": {
        const pillar = pillarConfig(ctx.pillar);
        return [
          `Subject: [SPECIFIC OBSERVATION, not a pitch]`,
          ``,
          `[GREETING],`,
          ``,
          `${reaction ? reaction : `[OPENING OBSERVATION about the real category tension in this story, drawn only from the evidence: ${ctx.claimedSummary || ctx.confirmedSummary}]`}`,
          ``,
          `${pillar.outreachPositioningLine} I'd genuinely love to jump on a call and hear how you're seeing it; I'd learn a great deal from you. Would you have 20 minutes over the next couple of weeks? If a sensible fit comes out of it, all the better, and if it's not for you, just say.`,
          ``,
          `All the best,`,
          `Stuart`,
          ``,
          ...pillar.signoffLines,
        ].join("\n");
      }

      case "video_script":
        return [
          `[ON CAMERA, 30 to 60 seconds]`,
          ``,
          `Open: ${line}.`,
          ``,
          `Middle: ${reactionOrSlot}`,
          ``,
          `Close: [ONE QUESTION to the viewer. No call to action, no ticket push.]`,
        ].join("\n");

      default:
        return [`${line}.`, ``, `${reactionOrSlot}`].join("\n");
    }
  }

  async refineEditorial(): Promise<{ rationale: string; angle: string } | null> {
    // Heuristic text passes through untouched on the mock provider.
    return null;
  }
}

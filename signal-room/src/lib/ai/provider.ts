// LLM provider abstraction. All model access goes through this seam:
// nothing elsewhere in the codebase calls a model API directly.
//
//  - AnthropicProvider activates when ANTHROPIC_API_KEY is set. The
//    strongest model is reserved for editorial judgement and drafting;
//    mechanical extraction refinement is wired to a cheaper model slot.
//  - MockProvider is the deterministic fallback: the pipeline works end to
//    end, and drafts are evidence-quoting skeletons with bracketed slots
//    instead of generated prose (never invented facts). The UI labels it.

export interface AllowedEvidence {
  excerpt: string;
  attribution: string; // "Tim Ryan on linkedin"
  status: string; // verification state
  permissionLevel: string;
}

export interface DraftContext {
  draftType: string;
  opportunityTitle: string;
  whatHappened: string;
  stuartAngle: string;
  editorialAngle: string;
  claimedSummary: string;
  confirmedSummary: string;
  allowedEvidence: AllowedEvidence[];
  hasUnverifiedClaims: boolean;
  stuartReaction?: string;
}

export interface EditorialContext {
  clusterTitle: string;
  evidence: AllowedEvidence[];
  heuristicRationale: string;
  heuristicAngle: string;
}

export interface LLMProvider {
  name: string;
  /** true when a real model is behind this provider */
  isReal: boolean;
  generateDraft(ctx: DraftContext): Promise<string>;
  /** optional prose polish for editorial fields; heuristic text passes through on mock */
  refineEditorial(ctx: EditorialContext): Promise<{ rationale: string; angle: string } | null>;
}

import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";

let cached: LLMProvider | null = null;

export function getProvider(): LLMProvider {
  if (cached) return cached;
  cached = process.env.ANTHROPIC_API_KEY ? new AnthropicProvider() : new MockProvider();
  return cached;
}

/** test seam */
export function setProviderForTests(p: LLMProvider | null): void {
  cached = p;
}

import { z } from "zod";
import type { ItemType, SourceType } from "@/lib/db/schema";

/** A segmented block of the raw paste, before persistence. Offsets always
 *  index into the exact preserved raw text. */
export interface ExtractedItem {
  tempId: string;
  platform: string;
  itemType: ItemType;
  authorName?: string;
  authorHandle?: string;
  authorMeta?: string;
  originalText: string;
  quotedText?: string;
  sourceUrl?: string;
  publishedAtText?: string;
  engagement: Record<string, number | string>;
  rawStartOffset: number;
  rawEndOffset: number;
  extractionConfidence: number;
  isNoise: boolean;
  noiseReason?: string;
  topics: string[];
}

export const extractedItemSchema = z.object({
  tempId: z.string(),
  platform: z.string(),
  itemType: z.string(),
  authorName: z.string().optional(),
  authorHandle: z.string().optional(),
  authorMeta: z.string().optional(),
  originalText: z.string(),
  quotedText: z.string().optional(),
  sourceUrl: z.string().optional(),
  publishedAtText: z.string().optional(),
  engagement: z.record(z.union([z.number(), z.string()])).default({}),
  rawStartOffset: z.number().int().nonnegative(),
  rawEndOffset: z.number().int().nonnegative(),
  extractionConfidence: z.number().min(0).max(1),
  isNoise: z.boolean(),
  noiseReason: z.string().optional(),
  topics: z.array(z.string()).default([]),
});

export interface Chunk {
  index: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface DedupeResult {
  /** tempId -> canonical tempId (absent = is canonical) */
  duplicateOf: Map<string, { canonical: string; kind: "duplicate_of" | "near_duplicate_of"; similarity: number }>;
}

export interface EntityMentionDraft {
  entityKey: string; // `${kind}:${canonicalName}`
  kind: "person" | "company" | "platform" | "regulator" | "publication" | "other";
  canonicalName: string;
  mentionText: string;
  role: "author" | "organisation" | "subject" | "mentioned";
  itemTempId: string;
  startOffset?: number;
  endOffset?: number;
  confidence: number;
}

export interface ClusterDraft {
  key: string;
  canonicalTitle: string;
  workingSummary: string;
  topics: string[];
  memberTempIds: string[];
  primaryTempId: string;
  /** tempId -> role */
  roles: Map<string, "primary" | "duplicate" | "commentary" | "quote" | "related" | "member">;
}

export interface ClaimDraft {
  tempId: string;
  claimText: string;
  claimantEntityKey?: string;
  subjectEntityKey?: string;
  status: string;
  confidence: number;
  publicationRisk: "low" | "medium" | "high";
  permissionLevel: string;
  clusterKey?: string;
  evidence: {
    itemTempId: string;
    excerpt: string;
    excerptStartOffset?: number;
    excerptEndOffset?: number;
    kind: "supporting" | "contradicting" | "context";
    independent: boolean;
  }[];
}

export interface ScoreBreakdown {
  dimension: string;
  score: number; // 0..100
  reason: string;
}

export interface OpportunityDraft {
  clusterKey: string;
  title: string;
  recommendedAction: string;
  actionAlternatives: { action: string; whyNot: string }[];
  rationale: string;
  whyBetter: string;
  stuartAngle: string;
  whatHappened: string;
  whatChanged: string;
  whatsNew: string;
  confirmedSummary: string;
  claimedSummary: string;
  missingSummary: string;
  editorialAngle: string;
  judgementChange: string;
  scores: ScoreBreakdown[];
  overallScore: number;
  urgency: number;
  confidence: number;
  relationshipValue: number;
  commercialValue: number;
  credibilityRisk: number;
  queued: boolean;
}

export interface PipelineWarnings {
  warnings: string[];
}

export type DeclaredSource = SourceType;

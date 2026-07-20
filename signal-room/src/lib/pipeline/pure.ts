// Pure, DB-free pipeline run: the same stages the orchestrator persists,
// composed over plain objects. Used by the evaluation harness and tests;
// run.ts is the DB-backed twin (kept thin so the logic lives here-ish).

import { segment } from "./segment";
import { detectDuplicates } from "./dedupe";
import { extractEntities } from "./entities";
import { buildClusters } from "./cluster";
import { extractClaims } from "./claims";
import { collectFeatures, type ClusterFeatures } from "./score";
import { buildOpportunities } from "./recommend";
import { defaultPermissionForSource, isPublishable } from "@/lib/permissions";
import type { ClaimDraft, ClusterDraft, DedupeResult, EntityMentionDraft, ExtractedItem, OpportunityDraft } from "./types";
import type { DeclaredSource } from "./types";
import type { DraftContext, AllowedEvidence } from "@/lib/ai/provider";

export interface PureRun {
  raw: string;
  sourceType: string;
  permissionLevel: string;
  items: ExtractedItem[];
  dupes: DedupeResult;
  mentions: EntityMentionDraft[];
  clusters: ClusterDraft[];
  claims: ClaimDraft[];
  features: ClusterFeatures[];
  opportunities: OpportunityDraft[];
}

export function runPurePipeline(raw: string, sourceType: string, currentThemes: string[] = [
  "market structure",
  "regulation",
  "distribution",
  "liquidity",
  "compliance",
  "settlement",
]): PureRun {
  const permissionLevel = defaultPermissionForSource(sourceType);
  const items = segment(raw, sourceType as DeclaredSource);
  const dupes = detectDuplicates(items);
  const mentions = extractEntities(items);
  const clusters = buildClusters(items, dupes, mentions);
  const claims = extractClaims(items, clusters, mentions, permissionLevel);
  const itemMap = new Map(items.map((i) => [i.tempId, i]));
  const features = clusters.map((c) =>
    collectFeatures(c, itemMap, claims, mentions, false, currentThemes, !isPublishable(permissionLevel)),
  );
  const opportunities = buildOpportunities(features, { currentThemes });
  return { raw, sourceType, permissionLevel, items, dupes, mentions, clusters, claims, features, opportunities };
}

/** Find the cluster whose member text contains the marker. */
export function clusterByMarker(run: PureRun, marker: string): ClusterDraft | undefined {
  const lower = marker.toLowerCase();
  return run.clusters.find((c) =>
    c.memberTempIds.some((id) => {
      const item = run.items.find((i) => i.tempId === id);
      return item && (item.originalText + " " + (item.quotedText ?? "")).toLowerCase().includes(lower);
    }),
  );
}

export function opportunityByMarker(run: PureRun, marker: string): OpportunityDraft | undefined {
  const cluster = clusterByMarker(run, marker);
  return cluster ? run.opportunities.find((o) => o.clusterKey === cluster.key) : undefined;
}

/** Assemble the writing context exactly as the app does: publishable
 *  evidence only; restricted material never reaches the writing agent. */
export function draftContextFor(run: PureRun, marker: string, draftType: string): DraftContext | undefined {
  const cluster = clusterByMarker(run, marker);
  const opp = cluster ? run.opportunities.find((o) => o.clusterKey === cluster.key) : undefined;
  if (!cluster || !opp) return undefined;
  const clusterClaims = run.claims.filter((c) => c.clusterKey === cluster.key);
  const allowedEvidence: AllowedEvidence[] = [];
  for (const claim of clusterClaims) {
    if (!isPublishable(claim.permissionLevel)) continue;
    for (const ev of claim.evidence) {
      const item = run.items.find((i) => i.tempId === ev.itemTempId);
      if (!item) continue;
      allowedEvidence.push({
        excerpt: ev.excerpt,
        attribution: `${item.authorName ?? "unknown author"} on ${item.platform}`,
        status: claim.status,
        permissionLevel: claim.permissionLevel,
      });
      break;
    }
    if (allowedEvidence.length >= 8) break;
  }
  if (allowedEvidence.length === 0 && isPublishable(run.permissionLevel)) {
    for (const id of cluster.memberTempIds.slice(0, 3)) {
      const item = run.items.find((i) => i.tempId === id);
      if (item && !item.isNoise) {
        allowedEvidence.push({
          excerpt: item.originalText.replace(/\s+/g, " ").slice(0, 260),
          attribution: `${item.authorName ?? "unknown author"} on ${item.platform}`,
          status: "observed",
          permissionLevel: run.permissionLevel,
        });
      }
    }
  }
  return {
    draftType,
    opportunityTitle: opp.title,
    whatHappened: opp.whatHappened,
    stuartAngle: opp.stuartAngle,
    editorialAngle: opp.editorialAngle,
    claimedSummary: opp.claimedSummary,
    confirmedSummary: opp.confirmedSummary,
    allowedEvidence,
    hasUnverifiedClaims: clusterClaims.some((c) =>
      ["social_claim_only", "disputed", "reported"].includes(c.status),
    ),
  };
}

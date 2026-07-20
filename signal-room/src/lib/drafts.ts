import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  opportunities,
  clusterItems,
  sourceItems,
  claims,
  claimEvidence,
  drafts,
  draftRevisions,
  auditLog,
  type VoiceLintResult,
  type PermissionWarning,
} from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { getProvider, type AllowedEvidence } from "@/lib/ai/provider";
import { lintVoice } from "@/lib/voice/lint";
import { detectLeaks, isPublishable, type RestrictedSource } from "@/lib/permissions";

const OUTREACH_TYPES = new Set(["dm", "email", "forum_post"]);

export interface GeneratedDraft {
  id: string;
  content: string;
  provider: string;
  voiceLint: VoiceLintResult;
  permissionWarnings: PermissionWarning[];
}

/**
 * Generate a draft for an opportunity. Structural permission rule: the
 * writing context only ever receives PUBLISHABLE evidence; restricted
 * material stays upstream (it already shaped the angle notes). A textual
 * leak scan then runs over the result anyway.
 */
export async function generateDraft(
  opportunityId: string,
  draftType: string,
  stuartReaction?: string,
): Promise<GeneratedDraft> {
  const database = await db();
  const [opp] = await database.select().from(opportunities).where(eq(opportunities.id, opportunityId));
  if (!opp) throw new Error("opportunity not found");
  const memberRows = await database
    .select({ item: sourceItems })
    .from(clusterItems)
    .innerJoin(sourceItems, eq(clusterItems.sourceItemId, sourceItems.id))
    .where(eq(clusterItems.clusterId, opp.storyClusterId));
  const members = memberRows.map((r) => r.item);

  const clusterClaims = await database
    .select()
    .from(claims)
    .where(eq(claims.storyClusterId, opp.storyClusterId));
  const evidenceRows = clusterClaims.length
    ? await database
        .select()
        .from(claimEvidence)
        .where(inArray(claimEvidence.claimId, clusterClaims.map((c) => c.id)))
    : [];

  const itemById = new Map(members.map((m) => [m.id, m]));
  const claimById = new Map(clusterClaims.map((c) => [c.id, c]));

  // Allowed evidence: publishable claims' excerpts, then publishable primary
  // item openings; hard-capped for prompt size.
  const allowedEvidence: AllowedEvidence[] = [];
  for (const ev of evidenceRows) {
    const item = itemById.get(ev.sourceItemId);
    const claim = claimById.get(ev.claimId);
    if (!item || !claim) continue;
    if (!isPublishable(item.permissionLevel) || !isPublishable(claim.permissionLevel)) continue;
    allowedEvidence.push({
      excerpt: ev.excerpt,
      attribution: `${item.authorNameRaw ?? "unknown author"} on ${item.platform}`,
      status: claim.status,
      permissionLevel: claim.permissionLevel,
    });
    if (allowedEvidence.length >= 8) break;
  }
  if (allowedEvidence.length === 0) {
    for (const item of members.filter((m) => !m.isNoise && isPublishable(m.permissionLevel)).slice(0, 3)) {
      allowedEvidence.push({
        excerpt: item.originalText.replace(/\s+/g, " ").slice(0, 260),
        attribution: `${item.authorNameRaw ?? "unknown author"} on ${item.platform}`,
        status: "observed",
        permissionLevel: item.permissionLevel,
      });
    }
  }

  const hasUnverifiedClaims = clusterClaims.some(
    (c) => c.status === "social_claim_only" || c.status === "disputed" || c.status === "reported",
  );

  const provider = getProvider();
  const content = await provider.generateDraft({
    draftType,
    opportunityTitle: opp.title,
    whatHappened: opp.whatHappened ?? "",
    stuartAngle: opp.stuartAngle ?? "",
    editorialAngle: opp.editorialAngle ?? "",
    claimedSummary: opp.claimedSummary ?? "",
    confirmedSummary: opp.confirmedSummary ?? "",
    allowedEvidence,
    hasUnverifiedClaims,
    stuartReaction,
  });

  const voiceLint = lintVoice(content, {
    outreach: OUTREACH_TYPES.has(draftType),
    hasUnverifiedClaims,
  });

  const permissionWarnings = await scanForLeaks(content);

  const id = uid();
  await database.insert(drafts).values({
    id,
    opportunityId,
    draftType,
    content,
    stuartReaction: stuartReaction ?? null,
    provider: provider.name,
    voiceLintJson: voiceLint,
    permissionWarningsJson: permissionWarnings,
    status: "draft",
  });
  await database.insert(draftRevisions).values({
    id: uid(),
    draftId: id,
    content,
    author: "system",
    revisionNote: `generated (${provider.name}, ${draftType})`,
    voiceLintJson: voiceLint,
  });
  await database.insert(auditLog).values({
    id: uid(),
    actor: "system",
    action: "generate_draft",
    scopeType: "draft",
    scopeId: id,
    detailJson: { opportunityId, draftType, provider: provider.name },
  });

  return { id, content, provider: provider.name, voiceLint, permissionWarnings };
}

/** Scan text against every restricted source item and claim in the store. */
export async function scanForLeaks(text: string): Promise<PermissionWarning[]> {
  const database = await db();
  const restrictedItems = (
    await database
      .select({ id: sourceItems.id, text: sourceItems.originalText, level: sourceItems.permissionLevel })
      .from(sourceItems)
      .orderBy(desc(sourceItems.createdAt))
      .limit(500)
  ).filter((r) => !isPublishable(r.level));
  const restrictedClaims = (
    await database
      .select({ id: claims.id, text: claims.claimText, level: claims.permissionLevel })
      .from(claims)
      .orderBy(desc(claims.createdAt))
      .limit(500)
  ).filter((r) => !isPublishable(r.level));
  const sources: RestrictedSource[] = [
    ...restrictedItems.map((r) => ({ id: r.id, kind: "source_item" as const, level: r.level, text: r.text })),
    ...restrictedClaims.map((r) => ({ id: r.id, kind: "claim" as const, level: r.level, text: r.text })),
  ];
  return detectLeaks(text, sources);
}

/** Save an edited draft as a new revision with fresh lint + leak results. */
export async function reviseDraft(
  draftId: string,
  content: string,
  revisionNote?: string,
): Promise<GeneratedDraft> {
  const database = await db();
  const [existing] = await database.select().from(drafts).where(eq(drafts.id, draftId));
  if (!existing) throw new Error("draft not found");
  const [opp] = await database
    .select({ clusterId: opportunities.storyClusterId })
    .from(opportunities)
    .where(eq(opportunities.id, existing.opportunityId));
  const clusterClaims = opp
    ? await database.select({ status: claims.status }).from(claims).where(eq(claims.storyClusterId, opp.clusterId))
    : [];
  const voiceLint = lintVoice(content, {
    outreach: OUTREACH_TYPES.has(existing.draftType),
    hasUnverifiedClaims: clusterClaims.some(
      (c) => c.status === "social_claim_only" || c.status === "disputed" || c.status === "reported",
    ),
  });
  const permissionWarnings = await scanForLeaks(content);
  await database
    .update(drafts)
    .set({ content, voiceLintJson: voiceLint, permissionWarningsJson: permissionWarnings, status: "edited" })
    .where(eq(drafts.id, draftId));
  await database.insert(draftRevisions).values({
    id: uid(),
    draftId,
    content,
    author: "stuart",
    revisionNote: revisionNote ?? "manual edit",
    voiceLintJson: voiceLint,
  });
  return {
    id: draftId,
    content,
    provider: existing.provider,
    voiceLint,
    permissionWarnings,
  };
}

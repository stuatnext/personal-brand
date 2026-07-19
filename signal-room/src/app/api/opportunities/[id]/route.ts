import { NextResponse } from "next/server";
import { asc, eq, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  claimEvidence,
  claims,
  clusterItems,
  drafts,
  entities,
  entityMentions,
  feedback,
  opportunities,
  opportunityScores,
  sourceItems,
  storyClusters,
} from "@/lib/db/schema";
import { isPublishable } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const [opp] = await database.select().from(opportunities).where(eq(opportunities.id, id));
  if (!opp) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [cluster] = await database
    .select()
    .from(storyClusters)
    .where(eq(storyClusters.id, opp.storyClusterId));
  const scores = await database
    .select()
    .from(opportunityScores)
    .where(eq(opportunityScores.opportunityId, id));

  const memberRows = await database
    .select({ item: sourceItems, role: clusterItems.role })
    .from(clusterItems)
    .innerJoin(sourceItems, eq(clusterItems.sourceItemId, sourceItems.id))
    .where(eq(clusterItems.clusterId, opp.storyClusterId))
    .orderBy(asc(sourceItems.rawStartOffset));

  const clusterClaims = await database
    .select()
    .from(claims)
    .where(eq(claims.storyClusterId, opp.storyClusterId));
  const evidence = clusterClaims.length
    ? await database
        .select()
        .from(claimEvidence)
        .where(inArray(claimEvidence.claimId, clusterClaims.map((c) => c.id)))
    : [];

  const itemIds = memberRows.map((m) => m.item.id);
  const mentions = itemIds.length
    ? await database
        .select({ mention: entityMentions, entity: entities })
        .from(entityMentions)
        .innerJoin(entities, eq(entityMentions.entityId, entities.id))
        .where(inArray(entityMentions.sourceItemId, itemIds))
    : [];
  const people = new Map<string, { id: string; name: string; kind: string; roles: Set<string> }>();
  for (const { mention, entity } of mentions) {
    const rec = people.get(entity.id) ?? {
      id: entity.id,
      name: entity.canonicalName,
      kind: entity.kind,
      roles: new Set<string>(),
    };
    rec.roles.add(mention.role);
    people.set(entity.id, rec);
  }

  const oppDrafts = await database
    .select()
    .from(drafts)
    .where(eq(drafts.opportunityId, id))
    .orderBy(desc(drafts.createdAt));
  const oppFeedback = await database
    .select()
    .from(feedback)
    .where(eq(feedback.opportunityId, id))
    .orderBy(desc(feedback.createdAt));

  return NextResponse.json({
    opportunity: opp,
    cluster,
    scores: scores.map((s) => ({ dimension: s.dimension, score: s.score, reason: s.reason })),
    items: memberRows.map(({ item, role }) => ({
      id: item.id,
      role,
      platform: item.platform,
      itemType: item.itemType,
      author: item.authorNameRaw,
      authorMeta: item.authorMetaRaw,
      text: item.originalText,
      quotedText: item.quotedText,
      sourceUrl: item.sourceUrl,
      publishedAtText: item.publishedAtText,
      engagement: item.engagementJson,
      offsets: [item.rawStartOffset, item.rawEndOffset],
      permissionLevel: item.permissionLevel,
      publishable: isPublishable(item.permissionLevel),
      confidence: item.extractionConfidence,
    })),
    claims: clusterClaims.map((c) => ({
      id: c.id,
      text: c.claimText,
      status: c.status,
      confidence: c.confidence,
      publicationRisk: c.publicationRisk,
      permissionLevel: c.permissionLevel,
      evidence: evidence
        .filter((e) => e.claimId === c.id)
        .map((e) => ({
          id: e.id,
          sourceItemId: e.sourceItemId,
          excerpt: e.excerpt,
          kind: e.kind,
          independent: e.independent,
        })),
    })),
    entities: [...people.values()].map((p) => ({ ...p, roles: [...p.roles] })),
    drafts: oppDrafts.map((d) => ({
      id: d.id,
      draftType: d.draftType,
      status: d.status,
      provider: d.provider,
      createdAt: d.createdAt,
      lintErrors: d.voiceLintJson?.errors?.length ?? 0,
      permissionWarnings: d.permissionWarningsJson?.length ?? 0,
    })),
    feedback: oppFeedback,
  });
}

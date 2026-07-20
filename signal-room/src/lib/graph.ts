import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  clusterItems,
  entities,
  entityMentions,
  opportunities,
  relationships,
  sourceItems,
} from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { prospectFlags } from "@/lib/pipeline/entities";

// Relationship graph v2. Edges accumulate from what Stuart actually DOES:
// using an opportunity records engagement with the people who carried it;
// acting on a lead records the prospect relationship. Edge direction is
// from the other party; a null toEntity means "with Stuart". Strength
// encodes repetition (0.5 first touch, +0.1 per repeat, capped at 1.0) and
// feeds relationship_value scoring on future runs: people Stuart has
// engaged with before score higher when they reappear.

const LEAD_EDGE_BY_ACTION: Record<string, string> = {
  speaker_lead: "speaker_prospect",
  sponsor_lead: "sponsor_prospect",
  media_lead: "media_contact",
  sales_handoff: "sales_prospect",
};

async function upsertEdge(
  fromEntityId: string,
  relationship: string,
  note: string,
): Promise<void> {
  const database = await db();
  const [existing] = await database
    .select()
    .from(relationships)
    .where(and(eq(relationships.fromEntityId, fromEntityId), eq(relationships.relationship, relationship)));
  if (existing) {
    await database
      .update(relationships)
      .set({ strength: Math.min(1, existing.strength + 0.1), note })
      .where(eq(relationships.id, existing.id));
  } else {
    await database.insert(relationships).values({
      id: uid(),
      fromEntityId,
      toEntityId: null,
      relationship,
      note,
      strength: 0.5,
    });
  }
}

/**
 * Record graph edges for a feedback decision. Only "use" builds the graph:
 * saving or ignoring is not engagement.
 */
export async function recordEngagement(opportunityId: string, decision: string): Promise<void> {
  if (decision !== "use") return;
  const database = await db();
  const [opp] = await database.select().from(opportunities).where(eq(opportunities.id, opportunityId));
  if (!opp) return;

  const memberItems = await database
    .select({ itemId: clusterItems.sourceItemId })
    .from(clusterItems)
    .where(eq(clusterItems.clusterId, opp.storyClusterId));
  const itemIds = memberItems.map((m) => m.itemId);
  if (itemIds.length === 0) return;

  const mentions = await database
    .select({ mention: entityMentions, entity: entities })
    .from(entityMentions)
    .innerJoin(entities, eq(entityMentions.entityId, entities.id))
    .where(inArray(entityMentions.sourceItemId, itemIds));

  const note = `used opportunity "${opp.title.slice(0, 80)}" (${new Date().toISOString().slice(0, 10)})`;

  // authors of the material Stuart acted on
  const authorIds = [...new Set(mentions.filter((m) => m.mention.role === "author").map((m) => m.entity.id))];
  for (const entityId of authorIds) {
    await upsertEdge(entityId, "stuart_engaged_with", note);
  }

  // lead actions: prospect edges for flagged or lead-relevant entities
  const leadEdge = LEAD_EDGE_BY_ACTION[opp.recommendedAction];
  if (leadEdge) {
    const prospectIds = [
      ...new Set(
        mentions
          .filter((m) => {
            const key = `${m.entity.kind}:${m.entity.canonicalName}`;
            const flags = prospectFlags(key) ?? (m.entity.flagsJson as { prospectType?: string } | null);
            return m.mention.role !== "author" && (flags?.prospectType || m.entity.kind === "company" || m.entity.kind === "platform");
          })
          .map((m) => m.entity.id),
      ),
    ].slice(0, 4);
    for (const entityId of prospectIds) {
      await upsertEdge(entityId, leadEdge, note);
    }
  }
}

/**
 * Engagement strengths by lowercased canonical name, for scoring: people
 * and companies Stuart has engaged with before are worth more when they
 * show up again.
 */
export async function engagementByName(): Promise<Map<string, number>> {
  const database = await db();
  const rows = await database
    .select({ rel: relationships, entity: entities })
    .from(relationships)
    .innerJoin(entities, eq(relationships.fromEntityId, entities.id))
    .where(eq(relationships.relationship, "stuart_engaged_with"));
  const map = new Map<string, number>();
  for (const { rel, entity } of rows) {
    const key = entity.canonicalName.toLowerCase();
    map.set(key, Math.max(map.get(key) ?? 0, rel.strength));
  }
  return map;
}

export interface PersonProfile {
  entity: { id: string; kind: string; name: string; flags: Record<string, unknown> };
  edges: { relationship: string; strength: number; note: string | null; withName: string | null }[];
  worksAt: string[];
  mentionCount: number;
  authoredCount: number;
  recentItems: {
    itemId: string;
    role: string;
    platform: string;
    excerpt: string;
    opportunityId: string | null;
    opportunityTitle: string | null;
  }[];
}

export async function personProfile(entityId: string): Promise<PersonProfile | null> {
  const database = await db();
  const [entity] = await database.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) return null;

  const mentions = await database
    .select({ mention: entityMentions, item: sourceItems })
    .from(entityMentions)
    .innerJoin(sourceItems, eq(entityMentions.sourceItemId, sourceItems.id))
    .where(eq(entityMentions.entityId, entityId));

  const edgeRows = await database
    .select()
    .from(relationships)
    .where(eq(relationships.fromEntityId, entityId));
  const toIds = edgeRows.map((e) => e.toEntityId).filter((x): x is string => Boolean(x));
  const toEntities = toIds.length
    ? await database.select().from(entities).where(inArray(entities.id, toIds))
    : [];
  const nameById = new Map(toEntities.map((e) => [e.id, e.canonicalName]));

  // link recent items to their opportunities via cluster membership
  const itemIds = mentions.map((m) => m.item.id);
  const clusterRows = itemIds.length
    ? await database
        .select({ itemId: clusterItems.sourceItemId, clusterId: clusterItems.clusterId })
        .from(clusterItems)
        .where(inArray(clusterItems.sourceItemId, itemIds))
    : [];
  const clusterByItem = new Map(clusterRows.map((c) => [c.itemId, c.clusterId]));
  const clusterIds = [...new Set(clusterRows.map((c) => c.clusterId))];
  const opps = clusterIds.length
    ? await database
        .select({ id: opportunities.id, clusterId: opportunities.storyClusterId, title: opportunities.title })
        .from(opportunities)
        .where(inArray(opportunities.storyClusterId, clusterIds))
    : [];
  const oppByCluster = new Map(opps.map((o) => [o.clusterId, o]));

  const sorted = [...mentions].sort(
    (a, b) => (b.item.createdAt?.getTime() ?? 0) - (a.item.createdAt?.getTime() ?? 0),
  );

  return {
    entity: {
      id: entity.id,
      kind: entity.kind,
      name: entity.canonicalName,
      flags: (entity.flagsJson ?? {}) as Record<string, unknown>,
    },
    edges: edgeRows.map((e) => ({
      relationship: e.relationship,
      strength: e.strength,
      note: e.note,
      withName: e.toEntityId ? (nameById.get(e.toEntityId) ?? null) : "Stuart",
    })),
    worksAt: edgeRows
      .filter((e) => e.relationship === "works_at" && e.toEntityId)
      .map((e) => nameById.get(e.toEntityId!) ?? "")
      .filter(Boolean),
    mentionCount: mentions.length,
    authoredCount: mentions.filter((m) => m.mention.role === "author").length,
    recentItems: sorted.slice(0, 10).map(({ mention, item }) => {
      const opp = clusterByItem.has(item.id) ? oppByCluster.get(clusterByItem.get(item.id)!) : undefined;
      return {
        itemId: item.id,
        role: mention.role,
        platform: item.platform,
        excerpt: item.originalText.replace(/\s+/g, " ").slice(0, 160),
        opportunityId: opp?.id ?? null,
        opportunityTitle: opp?.title ?? null,
      };
    }),
  };
}

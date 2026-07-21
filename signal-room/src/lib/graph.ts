import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  auditLog,
  clusterItems,
  drafts,
  entities,
  entityMentions,
  opportunities,
  OUTREACH_STATES,
  PROSPECT_RELATIONSHIPS,
  relationships,
  sourceItems,
  users,
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
//
// Prospect edges additionally carry an outreach STATE
// (identified → drafted → sent → replied → meeting_booked → confirmed|passed).
// The system moves an edge only as far as `drafted` (a dm/email draft
// exists); `sent` and everything after is Stuart recording, by hand and
// after the fact, an action HE took outside the system. Nothing here sends.

const LEAD_EDGE_BY_ACTION: Record<string, string> = {
  speaker_lead: "speaker_prospect",
  sponsor_lead: "sponsor_prospect",
  media_lead: "media_contact",
  sales_handoff: "sales_prospect",
};

const PROSPECT_EDGE_KINDS = new Set<string>(PROSPECT_RELATIONSHIPS);
const OUTREACH_DRAFT_TYPES = ["dm", "email"];

export function isProspectRelationship(relationship: string): boolean {
  return PROSPECT_EDGE_KINDS.has(relationship);
}

async function upsertEdge(
  fromEntityId: string,
  relationship: string,
  note: string,
  initialState = "identified",
): Promise<void> {
  const database = await db();
  const [existing] = await database
    .select()
    .from(relationships)
    .where(and(eq(relationships.fromEntityId, fromEntityId), eq(relationships.relationship, relationship)));
  if (existing) {
    // Repetition bumps strength; the outreach state is never reset here —
    // an edge that is already `replied` stays `replied` when the prospect
    // shows up in another used opportunity.
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
      state: initialState,
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
    // If Stuart drafted the outreach before recording Use, the edge is born
    // `drafted`, not `identified` — the state reflects what actually exists.
    const existingDrafts = await database
      .select({ draftType: drafts.draftType })
      .from(drafts)
      .where(eq(drafts.opportunityId, opportunityId));
    const hasOutreachDraft = existingDrafts.some((d) => OUTREACH_DRAFT_TYPES.includes(d.draftType));
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
    if (prospectIds.length === 0) {
      // Lead stories often centre on a company the gazetteer has never seen
      // (the DAZN case), leaving nothing to hang the prospect edge on. Fall
      // back to the author's organisation, taken VERBATIM from the captured
      // headline ("Chief Executive Officer at DAZN Group") — recorded
      // evidence, never an invented name.
      const authorOrgId = await entityFromAuthorHeadline(itemIds, { create: true });
      if (authorOrgId) prospectIds.push(authorOrgId);
    }
    for (const entityId of prospectIds) {
      await upsertEdge(entityId, leadEdge, note, hasOutreachDraft ? "drafted" : "identified");
    }
  }
}

/** Find (or, with create, record) a company entity from the first
 *  "<role> at <Org>" author headline among these items. Returns null when
 *  no headline names an organisation. */
async function entityFromAuthorHeadline(
  itemIds: string[],
  opts: { create: boolean },
): Promise<string | null> {
  const database = await db();
  const items = await database
    .select({ authorMeta: sourceItems.authorMetaRaw })
    .from(sourceItems)
    .where(inArray(sourceItems.id, itemIds));
  for (const { authorMeta } of items) {
    const m = authorMeta?.match(/\b(?:at|@)\s+([A-Z][\w.&' -]{2,40})/);
    if (!m) continue;
    const org = m[1].trim().replace(/[.,;:|]+$/, "").replace(/\s+/g, " ");
    if (org.length < 3) continue;
    const [existing] = await database
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.kind, "company"), eq(entities.canonicalName, org)));
    if (existing) return existing.id;
    if (!opts.create) continue;
    const id = uid();
    await database.insert(entities).values({
      id,
      kind: "company",
      canonicalName: org,
      description: `from author headline: "${authorMeta!.slice(0, 120)}"`,
      flagsJson: { source: "author_headline" },
    });
    return id;
  }
  return null;
}

/**
 * Advance `identified` prospect edges to `drafted` when a dm/email draft is
 * generated for the opportunity that involves them. This is the ONLY
 * automatic forward transition beyond edge creation: a draft existing is a
 * fact about the system, so the system may record it. It never overwrites a
 * state Stuart has moved further along, and it never marks anything sent.
 */
export async function markProspectsDrafted(opportunityId: string, draftType: string): Promise<void> {
  if (!OUTREACH_DRAFT_TYPES.includes(draftType)) return;
  const database = await db();
  const [opp] = await database.select().from(opportunities).where(eq(opportunities.id, opportunityId));
  if (!opp) return;
  const memberItems = await database
    .select({ itemId: clusterItems.sourceItemId })
    .from(clusterItems)
    .where(eq(clusterItems.clusterId, opp.storyClusterId));
  const itemIds = memberItems.map((m) => m.itemId);
  if (itemIds.length === 0) return;
  const mentionRows = await database
    .select({ entityId: entityMentions.entityId })
    .from(entityMentions)
    .where(inArray(entityMentions.sourceItemId, itemIds));
  const entityIds = [...new Set(mentionRows.map((m) => m.entityId))];
  // author-headline orgs carry prospect edges without mention rows (the
  // gazetteer-miss fallback); resolve them too so their edges advance
  const authorOrgId = await entityFromAuthorHeadline(itemIds, { create: false });
  if (authorOrgId) entityIds.push(authorOrgId);
  if (entityIds.length === 0) return;

  const edges = await database
    .select()
    .from(relationships)
    .where(and(inArray(relationships.fromEntityId, entityIds), eq(relationships.state, "identified")));
  for (const edge of edges) {
    if (!isProspectRelationship(edge.relationship)) continue;
    await database
      .update(relationships)
      .set({ state: "drafted", stateUpdatedAt: new Date() })
      .where(eq(relationships.id, edge.id));
    await database.insert(auditLog).values({
      id: uid(),
      actor: "system",
      action: "outreach_state_change",
      scopeType: "relationship",
      scopeId: edge.id,
      detailJson: { from: "identified", to: "drafted", trigger: `${draftType} draft generated`, opportunityId },
    });
  }
}

/**
 * Stuart records an outreach state by hand (he sent the DM, they replied,
 * the meeting is booked…). Any state → any state is allowed — he is
 * correcting the record to match reality, not driving a workflow engine —
 * and every move is audit-logged with before/after.
 */
export async function setOutreachState(
  relationshipId: string,
  state: string,
  note?: string,
): Promise<{ id: string; relationship: string; state: string }> {
  if (!(OUTREACH_STATES as readonly string[]).includes(state)) {
    throw new Error(`unknown outreach state "${state}"`);
  }
  const database = await db();
  const [edge] = await database.select().from(relationships).where(eq(relationships.id, relationshipId));
  if (!edge) throw new Error("relationship not found");
  if (!isProspectRelationship(edge.relationship)) {
    throw new Error(`"${edge.relationship}" edges do not carry outreach state`);
  }
  await database
    .update(relationships)
    .set({ state, stateUpdatedAt: new Date(), ...(note ? { note } : {}) })
    .where(eq(relationships.id, relationshipId));
  await database.insert(auditLog).values({
    id: uid(),
    actor: "stuart",
    action: "outreach_state_change",
    scopeType: "relationship",
    scopeId: relationshipId,
    detailJson: { from: edge.state, to: state, ...(note ? { note } : {}) },
  });
  return { id: relationshipId, relationship: edge.relationship, state };
}

/**
 * Record who introduced this person/company to Stuart. The introducer is a
 * person entity, found or created by name (an introduction is a fact Stuart
 * states, so creating the entity is recording, not inventing). The edge
 * reads: <prospect> introduced_by <introducer>.
 */
export async function recordIntroduction(
  entityId: string,
  introducerName: string,
  note?: string,
): Promise<{ introducerId: string; edgeId: string }> {
  const name = introducerName.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 80) throw new Error("introducer name must be 3-80 characters");
  const database = await db();
  const [subject] = await database.select().from(entities).where(eq(entities.id, entityId));
  if (!subject) throw new Error("entity not found");

  const people = await database.select().from(entities).where(eq(entities.kind, "person"));
  let introducer = people.find((p) => p.canonicalName.toLowerCase() === name.toLowerCase());
  if (!introducer) {
    const id = uid();
    await database.insert(entities).values({
      id,
      kind: "person",
      canonicalName: name,
      description: "added by Stuart as an introducer",
      flagsJson: { source: "introduction" },
    });
    [introducer] = await database.select().from(entities).where(eq(entities.id, id));
  }
  if (introducer.id === entityId) throw new Error("an entity cannot introduce itself");

  const [existing] = await database
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.fromEntityId, entityId),
        eq(relationships.toEntityId, introducer.id),
        eq(relationships.relationship, "introduced_by"),
      ),
    );
  let edgeId: string;
  if (existing) {
    edgeId = existing.id;
    if (note) await database.update(relationships).set({ note }).where(eq(relationships.id, edgeId));
  } else {
    edgeId = uid();
    await database.insert(relationships).values({
      id: edgeId,
      fromEntityId: entityId,
      toEntityId: introducer.id,
      relationship: "introduced_by",
      note: note ?? null,
      // an introduction is a strong tie by construction, not a repetition count
      strength: 0.7,
    });
  }
  await database.insert(auditLog).values({
    id: uid(),
    actor: "stuart",
    action: "introduction_recorded",
    scopeType: "relationship",
    scopeId: edgeId,
    detailJson: { entityId, introducer: introducer.canonicalName, ...(note ? { note } : {}) },
  });
  return { introducerId: introducer.id, edgeId };
}

// --- Follow-up cadence --------------------------------------------------------

export const DEFAULT_FOLLOW_UP_DAYS = 5;

export interface FollowUpDue {
  relationshipId: string;
  entityId: string;
  name: string;
  kind: string;
  relationship: string;
  stateUpdatedAt: string | null;
  daysSilent: number;
  note: string | null;
}

/** The configured silence window before a sent prospect surfaces as a
 *  follow-up (users.settingsJson.followUpDays, default 5). */
export async function followUpDays(): Promise<number> {
  const database = await db();
  const [owner] = await database.select().from(users).limit(1);
  const settings = (owner?.settingsJson ?? {}) as { followUpDays?: number };
  return typeof settings.followUpDays === "number" && settings.followUpDays >= 1
    ? Math.round(settings.followUpDays)
    : DEFAULT_FOLLOW_UP_DAYS;
}

/**
 * Prospects Stuart SENT outreach to that have sat silent for the window.
 * This is a nudge, never an auto-send — and per the outreach discipline a
 * follow-up to silence stays exploratory: the same 20-minute ask with a
 * clean out, no tickets, no pricing. Silence is measured from the moment
 * Stuart recorded `sent` (state_updated_at); anything he has since moved
 * to replied/meeting_booked/confirmed/passed no longer qualifies.
 */
export async function getFollowUpsDue(staleDays?: number): Promise<FollowUpDue[]> {
  const days = staleDays ?? (await followUpDays());
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const database = await db();
  const rows = await database
    .select({ rel: relationships, entity: entities })
    .from(relationships)
    .innerJoin(entities, eq(relationships.fromEntityId, entities.id))
    .where(
      and(
        inArray(relationships.relationship, [...PROSPECT_RELATIONSHIPS]),
        eq(relationships.state, "sent"),
      ),
    );
  return rows
    .filter((r) => r.rel.stateUpdatedAt && r.rel.stateUpdatedAt.getTime() < cutoff)
    .map(({ rel, entity }) => ({
      relationshipId: rel.id,
      entityId: entity.id,
      name: entity.canonicalName,
      kind: entity.kind,
      relationship: rel.relationship,
      stateUpdatedAt: rel.stateUpdatedAt?.toISOString() ?? null,
      daysSilent: Math.floor((Date.now() - rel.stateUpdatedAt!.getTime()) / (24 * 3600 * 1000)),
      note: rel.note,
    }))
    .sort((a, b) => b.daysSilent - a.daysSilent)
    .slice(0, 12);
}

// --- Pipeline view ----------------------------------------------------------

export interface PipelineRow {
  relationshipId: string;
  entityId: string;
  name: string;
  kind: string;
  state: string;
  stateUpdatedAt: string | null;
  strength: number;
  note: string | null;
  introducedBy: string | null;
}

export interface PipelineLane {
  relationship: string;
  rows: PipelineRow[];
}

/**
 * The outreach pipeline: every prospect edge grouped by lead type, ordered
 * working-first (earliest pipeline state first, then most recently moved).
 */
export async function getPipeline(): Promise<{ lanes: PipelineLane[]; totalsByState: Record<string, number> }> {
  const database = await db();
  const rows = await database
    .select({ rel: relationships, entity: entities })
    .from(relationships)
    .innerJoin(entities, eq(relationships.fromEntityId, entities.id))
    .where(inArray(relationships.relationship, [...PROSPECT_RELATIONSHIPS]));

  // annotate with introducers where they exist
  const subjectIds = [...new Set(rows.map((r) => r.entity.id))];
  const intros = subjectIds.length
    ? await database
        .select({ rel: relationships, introducer: entities })
        .from(relationships)
        .innerJoin(entities, eq(relationships.toEntityId, entities.id))
        .where(
          and(
            inArray(relationships.fromEntityId, subjectIds),
            eq(relationships.relationship, "introduced_by"),
          ),
        )
    : [];
  const introducerByEntity = new Map(intros.map((i) => [i.rel.fromEntityId, i.introducer.canonicalName]));

  const stateOrder = new Map((OUTREACH_STATES as readonly string[]).map((s, i) => [s, i]));
  const totalsByState: Record<string, number> = {};
  const byLane = new Map<string, PipelineRow[]>();
  for (const { rel, entity } of rows) {
    totalsByState[rel.state] = (totalsByState[rel.state] ?? 0) + 1;
    const row: PipelineRow = {
      relationshipId: rel.id,
      entityId: entity.id,
      name: entity.canonicalName,
      kind: entity.kind,
      state: rel.state,
      stateUpdatedAt: rel.stateUpdatedAt?.toISOString() ?? null,
      strength: rel.strength,
      note: rel.note,
      introducedBy: introducerByEntity.get(entity.id) ?? null,
    };
    const lane = byLane.get(rel.relationship) ?? [];
    lane.push(row);
    byLane.set(rel.relationship, lane);
  }
  const lanes: PipelineLane[] = [...PROSPECT_RELATIONSHIPS]
    .filter((r) => byLane.has(r))
    .map((relationship) => ({
      relationship,
      rows: byLane
        .get(relationship)!
        .sort(
          (a, b) =>
            (stateOrder.get(a.state) ?? 99) - (stateOrder.get(b.state) ?? 99) ||
            (b.stateUpdatedAt ?? "").localeCompare(a.stateUpdatedAt ?? ""),
        ),
    }));
  return { lanes, totalsByState };
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
  edges: {
    id: string;
    relationship: string;
    strength: number;
    note: string | null;
    withName: string | null;
    state: string;
    stateUpdatedAt: string | null;
    isProspect: boolean;
  }[];
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
      id: e.id,
      relationship: e.relationship,
      strength: e.strength,
      note: e.note,
      withName: e.toEntityId ? (nameById.get(e.toEntityId) ?? null) : "Stuart",
      state: e.state,
      stateUpdatedAt: e.stateUpdatedAt?.toISOString() ?? null,
      isProspect: isProspectRelationship(e.relationship),
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

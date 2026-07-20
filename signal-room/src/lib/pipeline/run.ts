import { and, eq, gte, ne, inArray, sql } from "drizzle-orm";
import { db, type Db } from "@/lib/db/client";
import {
  ingestions,
  processingRuns,
  sourceItems,
  sourceItemRelationships,
  entities,
  entityAliases,
  entityMentions,
  storyClusters,
  storyThreads,
  clusterItems,
  claims,
  claimEvidence,
  opportunities,
  opportunityScores,
  recommendations,
  relationships,
  auditLog,
  users,
  type StageProgress,
  type RunStats,
} from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { chunkText } from "./chunk";
import { segment } from "./segment";
import { detectDuplicates, dedupeHash } from "./dedupe";
import { extractEntities } from "./entities";
import { buildClusters } from "./cluster";
import { extractClaims } from "./claims";
import { collectFeatures, isAggregation, isOffTopic } from "./score";
import { buildOpportunities } from "./recommend";
import {
  buildClusterSignature,
  bestThreadMatch,
  mergeSignature,
  newClaimsAgainstThread,
  type ThreadInfo,
} from "./threads";
import { suggestThesisEvidence } from "@/lib/theses";
import { GAZETTEER } from "./gazetteer";
import { isPublishable } from "@/lib/permissions";
import { getProvider } from "@/lib/ai/provider";
import type { DeclaredSource } from "./types";

export const STAGES: { key: string; label: string }[] = [
  { key: "save_input", label: "Saving original input" },
  { key: "split_input", label: "Splitting input safely" },
  { key: "detect_items", label: "Detecting individual items" },
  { key: "remove_noise", label: "Removing interface noise" },
  { key: "resolve_duplicates", label: "Resolving duplicates" },
  { key: "identify_entities", label: "Identifying people and companies" },
  { key: "build_clusters", label: "Building story clusters" },
  { key: "extract_claims", label: "Extracting claims" },
  { key: "link_threads", label: "Linking story threads" },
  { key: "rank_opportunities", label: "Ranking opportunities" },
  { key: "create_queue", label: "Creating the action queue" },
];

async function updateRun(
  database: Db,
  runId: string,
  patch: Partial<{
    status: string;
    currentStage: string | null;
    stagesJson: StageProgress[];
    statsJson: RunStats;
    error: string | null;
    startedAt: Date;
    finishedAt: Date;
  }>,
  logLine?: { level: string; message: string },
) {
  if (logLine) {
    await database
      .update(processingRuns)
      .set({
        ...patch,
        logJson: sql`coalesce(${processingRuns.logJson}, '[]'::jsonb) || ${JSON.stringify([
          { at: new Date().toISOString(), ...logLine },
        ])}::jsonb`,
      } as never)
      .where(eq(processingRuns.id, runId));
  } else {
    await database
      .update(processingRuns)
      .set(patch as never)
      .where(eq(processingRuns.id, runId));
  }
}

/** Remove all derived rows for an ingestion so reprocessing is idempotent.
 *  (Drafts/feedback attached to this ingestion's opportunities cascade;
 *  reprocessing is a rebuild, documented in the README.) */
async function deleteDerived(database: Db, ingestionId: string) {
  const oppIds = (
    await database
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(eq(opportunities.ingestionId, ingestionId))
  ).map((r) => r.id);
  if (oppIds.length) {
    await database.delete(opportunities).where(inArray(opportunities.id, oppIds));
  }
  await database.delete(claims).where(eq(claims.ingestionId, ingestionId));

  // Unwind this ingestion's traces from story threads so reprocessing
  // cannot count the same ingestion as a second observation of its own
  // story. (Merged signature keywords/hashes are left in place; the rerun
  // re-adds them.)
  const threadIds = (
    await database
      .select({ threadId: storyClusters.threadId })
      .from(storyClusters)
      .where(eq(storyClusters.ingestionId, ingestionId))
  )
    .map((r) => r.threadId)
    .filter((t): t is string => Boolean(t));
  if (threadIds.length) {
    const rows = await database.select().from(storyThreads).where(inArray(storyThreads.id, threadIds));
    for (const row of rows) {
      const remaining = (row.observationsJson ?? []).filter((o) => o.ingestionId !== ingestionId);
      if (remaining.length === 0) {
        await database.delete(storyThreads).where(eq(storyThreads.id, row.id));
      } else {
        const lastObservedAt = new Date(
          Math.max(...remaining.map((o) => new Date(o.date + "T00:00:00Z").getTime())),
        );
        await database
          .update(storyThreads)
          .set({ observationsJson: remaining, observationCount: remaining.length, lastObservedAt })
          .where(eq(storyThreads.id, row.id));
      }
    }
  }

  await database.delete(storyClusters).where(eq(storyClusters.ingestionId, ingestionId));
  const itemIds = (
    await database
      .select({ id: sourceItems.id })
      .from(sourceItems)
      .where(eq(sourceItems.ingestionId, ingestionId))
  ).map((r) => r.id);
  if (itemIds.length) {
    await database.delete(sourceItems).where(inArray(sourceItems.id, itemIds));
  }
}

async function upsertEntity(
  database: Db,
  cache: Map<string, string>,
  kind: string,
  canonicalName: string,
  description?: string,
  flags?: Record<string, unknown>,
): Promise<string> {
  const key = `${kind}:${canonicalName.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const existing = await database
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.kind, kind), eq(entities.canonicalName, canonicalName)))
    .limit(1);
  if (existing.length) {
    cache.set(key, existing[0].id);
    return existing[0].id;
  }
  const id = uid();
  await database.insert(entities).values({
    id,
    kind,
    canonicalName,
    description: description ?? null,
    flagsJson: flags ?? {},
  });
  cache.set(key, id);
  return id;
}

export interface ProcessResult {
  runId: string;
  stats: RunStats;
}

/**
 * Execute the full pipeline for an ingestion. Progress is written to the
 * processing_runs row stage by stage so the UI can poll it; the function is
 * safe to re-run (derived rows are rebuilt).
 */
export async function processIngestion(ingestionId: string, runId?: string): Promise<ProcessResult> {
  const database = await db();
  const [ing] = await database.select().from(ingestions).where(eq(ingestions.id, ingestionId));
  if (!ing) throw new Error(`ingestion ${ingestionId} not found`);

  if (!runId) {
    runId = uid();
    await database.insert(processingRuns).values({
      id: runId,
      ingestionId,
      status: "queued",
      provider: getProvider().name,
      stagesJson: STAGES.map((s) => ({ ...s, status: "pending" as const })),
    });
  }

  const stages: StageProgress[] = STAGES.map((s) => ({ ...s, status: "pending" as const }));
  const stats: RunStats = { warnings: [] };
  const warn = (w: string) => stats.warnings!.push(w);

  const stageRun = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const stage = stages.find((s) => s.key === key)!;
    stage.status = "running";
    stage.startedAt = new Date().toISOString();
    await updateRun(database, runId!, { currentStage: key, stagesJson: [...stages], statsJson: stats });
    try {
      const out = await fn();
      stage.status = "complete";
      stage.finishedAt = new Date().toISOString();
      await updateRun(database, runId!, { stagesJson: [...stages], statsJson: stats });
      return out;
    } catch (err) {
      stage.status = "failed";
      stage.detail = err instanceof Error ? err.message : String(err);
      stage.finishedAt = new Date().toISOString();
      await updateRun(database, runId!, { stagesJson: [...stages], statsJson: stats });
      throw err;
    }
  };

  await updateRun(
    database,
    runId,
    { status: "running", startedAt: new Date(), stagesJson: [...stages] },
    { level: "info", message: `run started for ingestion "${ing.title}" (${ing.charCount} chars)` },
  );
  await database
    .update(ingestions)
    .set({ processingStatus: "processing" })
    .where(eq(ingestions.id, ingestionId));

  try {
    // Stage 1: the raw input was persisted at creation; verify and record.
    await stageRun("save_input", async () => {
      stats.rawWordCount = ing.wordCount;
      if (!ing.rawSha256) throw new Error("raw input has no integrity hash");
      await deleteDerived(database, ingestionId);
    });

    // Stage 2: deterministic chunking (the unit for any LLM refinement and
    // the safety boundary for very large inputs).
    const chunks = await stageRun("split_input", async () => {
      const c = chunkText(ing.rawText);
      stats.chunkCount = c.length;
      return c;
    });
    void chunks;

    // Stage 3: platform-aware segmentation with exact offsets.
    const items = await stageRun("detect_items", async () => {
      const segmented = segment(ing.rawText, ing.sourceType as DeclaredSource);
      stats.blocksDetected = segmented.length;
      if (segmented.length === 0) warn("no items detected; the source may be an unsupported format");
      return segmented;
    });

    // Stage 4: noise classification report (noise is kept, flagged).
    await stageRun("remove_noise", async () => {
      stats.noiseItems = items.filter((i) => i.isNoise).length;
    });

    // Stage 5: duplicates.
    const dupes = await stageRun("resolve_duplicates", async () => {
      const d = detectDuplicates(items);
      stats.duplicateItems = d.duplicateOf.size;
      stats.uniqueSourceItems =
        items.filter((i) => !i.isNoise).length - d.duplicateOf.size;
      return d;
    });

    // Persist source items now (they exist regardless of later stages).
    const itemIdByTemp = new Map<string, string>();
    const permissionLevel = ing.defaultPermissionLevel;
    for (const item of items) {
      const id = uid();
      itemIdByTemp.set(item.tempId, id);
      await database.insert(sourceItems).values({
        id,
        ingestionId,
        runId,
        platform: item.platform,
        itemType: item.itemType,
        authorNameRaw: item.authorName ?? null,
        authorHandleRaw: item.authorHandle ?? null,
        authorMetaRaw: item.authorMeta ?? null,
        originalText: item.originalText,
        quotedText: item.quotedText ?? null,
        sourceUrl: item.sourceUrl ?? null,
        publishedAtText: item.publishedAtText ?? null,
        capturedAt: ing.capturedAt,
        engagementJson: item.engagement,
        topicsJson: item.topics,
        rawStartOffset: item.rawStartOffset,
        rawEndOffset: item.rawEndOffset,
        extractionConfidence: item.extractionConfidence,
        isNoise: item.isNoise,
        noiseReason: item.noiseReason ?? null,
        dedupeHash: item.isNoise ? null : dedupeHash(item.originalText),
        permissionLevel,
      });
    }
    for (const [dupTemp, info] of dupes.duplicateOf) {
      await database.insert(sourceItemRelationships).values({
        id: uid(),
        fromItemId: itemIdByTemp.get(dupTemp)!,
        toItemId: itemIdByTemp.get(info.canonical)!,
        relationship: info.kind,
        similarity: info.similarity,
      });
    }

    // Stage 6: entities.
    const mentions = await stageRun("identify_entities", async () => {
      const m = extractEntities(items);
      const people = new Set(
        m.filter((x) => x.kind === "person").map((x) => x.canonicalName.toLowerCase()),
      );
      stats.relevantPeople = people.size;
      return m;
    });

    const entityIdCache = new Map<string, string>();
    const entityIdByKey = new Map<string, string>();
    // Seed gazetteer flags for entities we actually saw.
    for (const mention of mentions) {
      const gaz = GAZETTEER.find(
        (g) => `${g.kind}:${g.name}` === mention.entityKey,
      );
      const entityId = await upsertEntity(
        database,
        entityIdCache,
        mention.kind,
        mention.canonicalName,
        undefined,
        gaz?.flags as Record<string, unknown> | undefined,
      );
      entityIdByKey.set(mention.entityKey, entityId);
      if (gaz?.aliases?.length) {
        for (const alias of gaz.aliases) {
          const existing = await database
            .select({ id: entityAliases.id })
            .from(entityAliases)
            .where(and(eq(entityAliases.entityId, entityId), eq(entityAliases.alias, alias)))
            .limit(1);
          if (!existing.length) {
            await database.insert(entityAliases).values({ id: uid(), entityId, alias });
          }
        }
      }
      await database.insert(entityMentions).values({
        id: uid(),
        entityId,
        sourceItemId: itemIdByTemp.get(mention.itemTempId)!,
        mentionText: mention.mentionText,
        role: mention.role,
        startOffset: mention.startOffset ?? null,
        endOffset: mention.endOffset ?? null,
        confidence: mention.confidence,
      });
    }
    // author works_at organisation edges (future relationship graph seed)
    const authorOrg = new Map<string, { author: string; org: string }>();
    for (const m of mentions) {
      if (m.role === "author") {
        const org = mentions.find((o) => o.itemTempId === m.itemTempId && o.role === "organisation");
        if (org) authorOrg.set(`${m.entityKey}->${org.entityKey}`, { author: m.entityKey, org: org.entityKey });
      }
    }
    for (const { author, org } of authorOrg.values()) {
      const fromId = entityIdByKey.get(author);
      const toId = entityIdByKey.get(org);
      if (fromId && toId) {
        await database.insert(relationships).values({
          id: uid(),
          fromEntityId: fromId,
          toEntityId: toId,
          relationship: "works_at",
          note: "observed in author headline",
          strength: 0.6,
        });
      }
    }

    // Stage 7: clusters.
    const clusters = await stageRun("build_clusters", async () => {
      const c = buildClusters(items, dupes, mentions);
      stats.storyClusters = c.length;
      return c;
    });

    const clusterIdByKey = new Map<string, string>();
    for (const cluster of clusters) {
      const id = uid();
      clusterIdByKey.set(cluster.key, id);
      await database.insert(storyClusters).values({
        id,
        ingestionId,
        canonicalTitle: cluster.canonicalTitle,
        workingSummary: cluster.workingSummary,
        topicsJson: cluster.topics,
        firstObservedAt: ing.capturedAt,
        lastObservedAt: ing.capturedAt,
        currentStatus: "active",
      });
      for (const tempId of cluster.memberTempIds) {
        await database.insert(clusterItems).values({
          id: uid(),
          clusterId: id,
          sourceItemId: itemIdByTemp.get(tempId)!,
          role: cluster.roles.get(tempId) ?? "member",
        });
      }
    }

    // Stage 8: claims + evidence.
    const claimDrafts = await stageRun("extract_claims", async () => {
      const c = extractClaims(items, clusters, mentions, permissionLevel);
      stats.claimsTotal = c.length;
      stats.claimsNeedingVerification = c.filter(
        (x) => x.status === "social_claim_only" || x.status === "reported" || x.status === "disputed",
      ).length;
      return c;
    });

    const claimIdByTemp = new Map<string, string>();
    for (const claim of claimDrafts) {
      const id = uid();
      claimIdByTemp.set(claim.tempId, id);
      await database.insert(claims).values({
        id,
        ingestionId,
        storyClusterId: claim.clusterKey ? clusterIdByKey.get(claim.clusterKey) ?? null : null,
        claimText: claim.claimText,
        claimantEntityId: claim.claimantEntityKey ? entityIdByKey.get(claim.claimantEntityKey) ?? null : null,
        subjectEntityId: claim.subjectEntityKey ? entityIdByKey.get(claim.subjectEntityKey) ?? null : null,
        status: claim.status,
        confidence: claim.confidence,
        publicationRisk: claim.publicationRisk,
        permissionLevel: claim.permissionLevel,
        firstObservedAt: ing.capturedAt,
      });
      for (const ev of claim.evidence) {
        await database.insert(claimEvidence).values({
          id: uid(),
          claimId: id,
          sourceItemId: itemIdByTemp.get(ev.itemTempId)!,
          kind: ev.kind,
          excerpt: ev.excerpt,
          excerptStartOffset: ev.excerptStartOffset ?? null,
          excerptEndOffset: ev.excerptEndOffset ?? null,
          independent: ev.independent,
        });
      }
    }

    // Stage 9: cross-day story threads. Match each eligible cluster against
    // recent threads (entity agreement + figure/wording echo); attach or
    // create, and compute the claim-level delta since the story was last
    // seen. Digests, off-topic colour and restricted ingestions don't
    // thread (v1: private continuity stays out of shared thread rows).
    const itemByTemp = new Map(items.map((i) => [i.tempId, i]));
    const threadInfoByCluster = await stageRun("link_threads", async () => {
      const map = new Map<string, ThreadInfo>();
      if (!isPublishable(permissionLevel)) return map;
      const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000);
      const recent = await database
        .select()
        .from(storyThreads)
        .where(gte(storyThreads.lastObservedAt, cutoff))
        .limit(400);
      const today = new Date().toISOString().slice(0, 10);
      const claimedThreads = new Set<string>();
      let continued = 0;
      for (const cluster of clusters) {
        const memberText = cluster.memberTempIds
          .map((id) => itemByTemp.get(id)?.originalText ?? "")
          .join("\n");
        const platform = itemByTemp.get(cluster.primaryTempId)?.platform;
        if (platform === "market_site" || isAggregation(memberText) || isOffTopic(memberText)) continue;
        const sig = buildClusterSignature(cluster, itemByTemp, mentions, claimDrafts);
        if (sig.entities.length === 0) continue;
        const clusterDbId = clusterIdByKey.get(cluster.key)!;
        const clusterClaims = claimDrafts.filter((c) => c.clusterKey === cluster.key);
        const candidates = recent
          .filter((r) => !claimedThreads.has(r.id))
          .map((r) => ({ id: r.id, signature: r.signatureJson }));
        const match = bestThreadMatch(sig, candidates);
        if (match) {
          claimedThreads.add(match.threadId);
          const row = recent.find((r) => r.id === match.threadId)!;
          const fresh = newClaimsAgainstThread(row.signatureJson, clusterClaims);
          const observation = {
            date: today,
            ingestionId,
            clusterId: clusterDbId,
            itemCount: cluster.memberTempIds.length,
            newClaimCount: fresh.length,
            headline: cluster.canonicalTitle,
          };
          await database
            .update(storyThreads)
            .set({
              signatureJson: mergeSignature(row.signatureJson, sig),
              observationsJson: [...(row.observationsJson ?? []), observation],
              observationCount: row.observationCount + 1,
              lastObservedAt: new Date(),
              currentStatus: "active",
            })
            .where(eq(storyThreads.id, row.id));
          await database
            .update(storyClusters)
            .set({ threadId: row.id })
            .where(eq(storyClusters.id, clusterDbId));
          map.set(cluster.key, {
            threadId: row.id,
            observationCount: row.observationCount + 1,
            firstObservedAt: row.firstObservedAt,
            lastSeenBefore: row.lastObservedAt,
            newClaimCount: fresh.length,
            newClaims: fresh.slice(0, 3).map((c) => ({ text: c.claimText, status: c.status })),
            knownClaimCount: clusterClaims.length - fresh.length,
          });
          continued += 1;
        } else {
          const threadId = uid();
          const signature = { entities: sig.entities, keywords: sig.keywords, numbers: sig.numbers, claimHashes: sig.claimHashes };
          await database.insert(storyThreads).values({
            id: threadId,
            canonicalTitle: cluster.canonicalTitle,
            signatureJson: signature,
            observationsJson: [
              {
                date: today,
                ingestionId,
                clusterId: clusterDbId,
                itemCount: cluster.memberTempIds.length,
                newClaimCount: clusterClaims.length,
                headline: cluster.canonicalTitle,
              },
            ],
            observationCount: 1,
          });
          await database
            .update(storyClusters)
            .set({ threadId })
            .where(eq(storyClusters.id, clusterDbId));
          map.set(cluster.key, {
            threadId,
            observationCount: 1,
            firstObservedAt: new Date(),
            lastSeenBefore: null,
            newClaimCount: clusterClaims.length,
            newClaims: [],
            knownClaimCount: 0,
          });
        }
      }
      stats.storyThreadsContinued = continued;
      return map;
    });

    // Thesis evidence suggestions from this run's claims (Oracle layer v1).
    try {
      const suggested = await suggestThesisEvidence(
        [...claimIdByTemp.entries()].map(([tempId, id]) => {
          const draft = claimDrafts.find((c) => c.tempId === tempId)!;
          return { id, text: draft.claimText };
        }),
      );
      if (suggested > 0) stats.thesisSuggestions = suggested;
    } catch (err) {
      warn(`thesis suggestion pass failed: ${err instanceof Error ? err.message : err}`);
    }

    // Stage 10: score + editorial layer.
    const oppDrafts = await stageRun("rank_opportunities", async () => {
      // Cross-ingestion newness: has this story's primary content been seen before?
      const previouslySeenByCluster = new Map<string, boolean>();
      for (const cluster of clusters) {
        const primary = itemByTemp.get(cluster.primaryTempId)!;
        const hash = dedupeHash(primary.originalText);
        const seen = await database
          .select({ id: sourceItems.id })
          .from(sourceItems)
          .where(
            and(eq(sourceItems.dedupeHash, hash), ne(sourceItems.ingestionId, ingestionId)),
          )
          .limit(1);
        previouslySeenByCluster.set(cluster.key, seen.length > 0);
      }

      // "Only Stuart can say this": restricted material from OTHER ingestions
      // that touches this cluster's entities becomes context notes (guides
      // questions; never quotable in drafts).
      const [owner] = await database.select().from(users).limit(1);
      const currentThemes: string[] =
        (owner?.settingsJson as { currentThemes?: string[] } | null)?.currentThemes ?? [
          "market structure",
          "regulation",
          "distribution",
          "liquidity",
          "compliance",
        ];
      const privateNotes = new Map<string, string[]>();
      const restrictedItems = await database
        .select({
          id: sourceItems.id,
          text: sourceItems.originalText,
          level: sourceItems.permissionLevel,
          ingestionId: sourceItems.ingestionId,
        })
        .from(sourceItems)
        .where(ne(sourceItems.ingestionId, ingestionId));
      const restrictedOnly = restrictedItems.filter((r) => !isPublishable(r.level));
      if (restrictedOnly.length) {
        const ingTitles = new Map(
          (await database.select({ id: ingestions.id, title: ingestions.title, sourceType: ingestions.sourceType }).from(ingestions)).map(
            (r) => [r.id, r],
          ),
        );
        for (const cluster of clusters) {
          const clusterEntities = mentions
            .filter((m) => cluster.memberTempIds.includes(m.itemTempId) && m.role !== "author")
            .map((m) => m.canonicalName);
          const notes: string[] = [];
          for (const entityName of [...new Set(clusterEntities)].slice(0, 6)) {
            const hit = restrictedOnly.find((r) =>
              r.text.toLowerCase().includes(entityName.toLowerCase()),
            );
            if (hit) {
              const meta = ingTitles.get(hit.ingestionId);
              notes.push(
                `Private context exists: "${meta?.title ?? "restricted ingestion"}" (${meta?.sourceType ?? "private"}) touches ${entityName}. It can sharpen the questions Stuart asks; it is ${hit.level.replace(/_/g, " ")} and must not appear in a public draft.`,
              );
            }
            if (notes.length >= 2) break;
          }
          if (notes.length) privateNotes.set(cluster.key, notes);
        }
      }

      const features = clusters.map((cluster) =>
        collectFeatures(
          cluster,
          itemByTemp,
          claimDrafts,
          mentions,
          previouslySeenByCluster.get(cluster.key) ?? false,
          currentThemes,
          !isPublishable(permissionLevel),
          threadInfoByCluster.get(cluster.key),
        ),
      );
      const weights = (owner?.settingsJson as { scoreWeights?: Record<string, number> } | null)?.scoreWeights;
      const drafts = buildOpportunities(features, {
        currentThemes,
        privateContextNotes: privateNotes,
        weights: weights ?? undefined,
      });

      // Optional editorial polish from the real provider (mock passes through).
      const provider = getProvider();
      if (provider.isReal) {
        for (const d of drafts.filter((x) => x.queued)) {
          try {
            const f = features.find((x) => x.cluster.key === d.clusterKey)!;
            const refined = await provider.refineEditorial({
              clusterTitle: d.title,
              heuristicRationale: d.rationale,
              heuristicAngle: d.stuartAngle,
              evidence: f.claims.slice(0, 6).flatMap((c) =>
                c.evidence.slice(0, 1).map((e) => ({
                  excerpt: e.excerpt,
                  attribution: itemByTemp.get(e.itemTempId)?.authorName ?? f.primary.platform,
                  status: c.status,
                  permissionLevel: c.permissionLevel,
                })),
              ),
            });
            if (refined) {
              d.rationale = refined.rationale;
              d.stuartAngle = refined.angle;
            }
          } catch (err) {
            warn(`editorial refinement failed for "${d.title}": ${err instanceof Error ? err.message : err}`);
          }
        }
      }
      stats.potentialLeads = drafts.filter((d) =>
        ["speaker_lead", "sponsor_lead", "media_lead", "sales_handoff"].includes(d.recommendedAction),
      ).length;
      return drafts;
    });

    // Stage 10: persist opportunities + the queue.
    await stageRun("create_queue", async () => {
      const queueDate = new Date().toISOString().slice(0, 10);
      const queued = oppDrafts.filter((d) => d.queued).sort((a, b) => b.overallScore - a.overallScore);
      let position = 0;
      for (const d of oppDrafts) {
        const oppId = uid();
        await database.insert(opportunities).values({
          id: oppId,
          ingestionId,
          storyClusterId: clusterIdByKey.get(d.clusterKey)!,
          title: d.title,
          recommendedAction: d.recommendedAction,
          actionAlternativesJson: d.actionAlternatives,
          rationale: d.rationale,
          whyBetter: d.whyBetter,
          stuartAngle: d.stuartAngle,
          whatHappened: d.whatHappened,
          whatChanged: d.whatChanged,
          whatsNew: d.whatsNew,
          confirmedSummary: d.confirmedSummary,
          claimedSummary: d.claimedSummary,
          missingSummary: d.missingSummary,
          editorialAngle: d.editorialAngle,
          judgementChange: d.judgementChange,
          urgency: d.urgency,
          confidence: d.confidence,
          relationshipValue: d.relationshipValue,
          commercialValue: d.commercialValue,
          credibilityRisk: d.credibilityRisk,
          overallScore: d.overallScore,
          status: "proposed",
        });
        for (const s of d.scores) {
          await database.insert(opportunityScores).values({
            id: uid(),
            opportunityId: oppId,
            dimension: s.dimension,
            score: s.score,
            reason: s.reason,
          });
        }
        if (d.queued) {
          position += 1;
          await database.insert(recommendations).values({
            id: uid(),
            opportunityId: oppId,
            ingestionId,
            queueDate,
            position: queued.indexOf(d) + 1,
            primaryAction: d.recommendedAction,
            status: "open",
          });
        }
      }
      stats.recommendations = position;
    });

    await database
      .update(ingestions)
      .set({ processingStatus: "complete" })
      .where(eq(ingestions.id, ingestionId));
    await updateRun(
      database,
      runId,
      { status: "complete", currentStage: null, finishedAt: new Date(), statsJson: stats, stagesJson: [...stages] },
      { level: "info", message: "run complete" },
    );
    await database.insert(auditLog).values({
      id: uid(),
      actor: "system",
      action: "process_ingestion",
      scopeType: "ingestion",
      scopeId: ingestionId,
      detailJson: { runId, stats } as Record<string, unknown>,
    });
    return { runId, stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await database
      .update(ingestions)
      .set({ processingStatus: "failed" })
      .where(eq(ingestions.id, ingestionId));
    await updateRun(
      database,
      runId,
      { status: "failed", error: message, finishedAt: new Date(), statsJson: stats },
      { level: "error", message },
    );
    throw err;
  }
}

// --- Job runner ---------------------------------------------------------------
// In-process async queue behind a small seam. State lives in the DB
// (processing_runs), so the UI polls the run row and a crashed process
// leaves an inspectable failed run that can be reprocessed.

type QueueGlobal = {
  __signalRoomJobs?: Map<string, Promise<unknown>>;
  __signalRoomChain?: Promise<unknown>;
};
const qg = globalThis as unknown as QueueGlobal;
function jobs(): Map<string, Promise<unknown>> {
  if (!qg.__signalRoomJobs) qg.__signalRoomJobs = new Map();
  return qg.__signalRoomJobs;
}

/**
 * Fire-and-track processing of an ingestion. Returns the run id
 * immediately. Runs execute SEQUENTIALLY (a global chain): two ingestions
 * processed at once could interleave story-thread bookkeeping (both
 * matching the same thread before either records its observation), and a
 * single-user tool gains nothing from parallel runs.
 */
export async function enqueueProcessing(ingestionId: string): Promise<string> {
  const database = await db();
  const runId = uid();
  await database.insert(processingRuns).values({
    id: runId,
    ingestionId,
    status: "queued",
    provider: getProvider().name,
    stagesJson: STAGES.map((s) => ({ ...s, status: "pending" as const })),
  });
  const promise = (qg.__signalRoomChain ?? Promise.resolve())
    .then(() => processIngestion(ingestionId, runId))
    .catch(() => {
      /* recorded on the run row */
    })
    .finally(() => jobs().delete(runId));
  qg.__signalRoomChain = promise;
  jobs().set(runId, promise);
  return runId;
}

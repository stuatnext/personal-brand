import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  auditLog,
  opportunities,
  storyThreads,
  theses,
  thesisEvidence,
  recommendations,
} from "@/lib/db/schema";
import { getCursor, setCursor } from "@/lib/collectors/cursors";
import { getTodayQueue, type QueueEntry } from "@/lib/queue";
import { getFollowUpsDue, followUpDays, type FollowUpDue } from "@/lib/graph";
import { crossVenueTrends, type CrossVenueTrendRow } from "@/lib/collectors/markets";

// The thread-aware briefing: "what changed since you last sat down",
// composed from story-thread deltas, thesis movement and the open queue —
// not a re-listing of everything ingested. "Last sat down" is an explicit
// caught-up marker Stuart sets, persisted like a collector cursor.

const CURSOR_COLLECTOR = "briefing";
const CURSOR_KEY = "caught-up";

export interface MovedThread {
  threadId: string;
  title: string;
  observationCount: number;
  lastObservedAt: string;
  newClaimCount: number;
  whatChanged: string | null;
  opportunityId: string | null;
}

export interface NewThread {
  threadId: string;
  title: string;
  firstObservedAt: string;
  action: string | null;
  opportunityId: string | null;
}

export interface ThesisActivity {
  thesisId: string;
  statement: string;
  confidence: number;
  suggestedSince: number;
  confirmedSince: number;
  confidenceMoves: { from: number; to: number; note: string | null; at: string }[];
}

export interface QuietThread {
  threadId: string;
  title: string;
  observationCount: number;
  lastObservedAt: string;
}

export interface BriefingData {
  since: string | null;
  generatedAt: string;
  movedThreads: MovedThread[];
  newThreads: NewThread[];
  thesisActivity: ThesisActivity[];
  queue: QueueEntry[];
  openLeads: { opportunityId: string; title: string; action: string }[];
  goneQuiet: QuietThread[];
  /** Sent outreach sitting silent past the window — a nudge, never a send.
   *  Current state, not since-gated: due is due until Stuart acts. */
  followUps: FollowUpDue[];
  followUpWindowDays: number;
  /** Standing cross-venue trends from the pair history (also not
   *  since-gated: a gap that has held for a week is news until it closes). */
  crossVenue: CrossVenueTrendRow[];
}

const LEAD_ACTIONS = new Set(["speaker_lead", "sponsor_lead", "media_lead", "sales_handoff"]);

async function opportunityForCluster(clusterId: string | undefined) {
  if (!clusterId) return null;
  const database = await db();
  const [opp] = await database
    .select({ id: opportunities.id, whatChanged: opportunities.whatChanged, action: opportunities.recommendedAction })
    .from(opportunities)
    .where(eq(opportunities.storyClusterId, clusterId));
  return opp ?? null;
}

export async function getBriefing(): Promise<BriefingData> {
  const database = await db();
  const since = await getCursor(CURSOR_COLLECTOR, CURSOR_KEY);
  const sinceDate = since ? new Date(since) : null;

  const threads = await database
    .select()
    .from(storyThreads)
    .orderBy(desc(storyThreads.lastObservedAt))
    .limit(300);

  const movedThreads: MovedThread[] = [];
  const newThreads: NewThread[] = [];
  for (const t of threads) {
    const observations = t.observationsJson ?? [];
    const latest = observations.slice(-1)[0];
    const isNewSince = !sinceDate || (t.firstObservedAt && t.firstObservedAt > sinceDate);
    const movedSince =
      !isNewSince && t.observationCount > 1 && (!sinceDate || (t.lastObservedAt && t.lastObservedAt > sinceDate));
    if (isNewSince) {
      const opp = await opportunityForCluster(latest?.clusterId);
      newThreads.push({
        threadId: t.id,
        title: t.canonicalTitle,
        firstObservedAt: t.firstObservedAt?.toISOString() ?? "",
        action: opp?.action ?? null,
        opportunityId: opp?.id ?? null,
      });
    } else if (movedSince && latest && latest.newClaimCount > 0) {
      const opp = await opportunityForCluster(latest.clusterId);
      movedThreads.push({
        threadId: t.id,
        title: t.canonicalTitle,
        observationCount: t.observationCount,
        lastObservedAt: t.lastObservedAt?.toISOString() ?? "",
        newClaimCount: latest.newClaimCount,
        whatChanged: opp?.whatChanged ?? null,
        opportunityId: opp?.id ?? null,
      });
    }
  }

  // thesis movement since the marker
  const allTheses = await database.select().from(theses);
  const evidence = allTheses.length
    ? await database
        .select()
        .from(thesisEvidence)
        .where(inArray(thesisEvidence.thesisId, allTheses.map((t) => t.id)))
    : [];
  const confidenceAudit = await database
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "thesis_confidence_change"))
    .orderBy(desc(auditLog.createdAt))
    .limit(100);
  const thesisActivity: ThesisActivity[] = [];
  for (const t of allTheses) {
    const ev = evidence.filter(
      (e) => e.thesisId === t.id && (!sinceDate || (e.createdAt && e.createdAt > sinceDate)),
    );
    const moves = confidenceAudit
      .filter((a) => a.scopeId === t.id && (!sinceDate || (a.createdAt && a.createdAt > sinceDate)))
      .map((a) => {
        const detail = (a.detailJson ?? {}) as { from?: number; to?: number; note?: string | null };
        return {
          from: detail.from ?? 0,
          to: detail.to ?? 0,
          note: detail.note ?? null,
          at: a.createdAt?.toISOString() ?? "",
        };
      });
    if (ev.length > 0 || moves.length > 0) {
      thesisActivity.push({
        thesisId: t.id,
        statement: t.statement,
        confidence: t.confidence,
        suggestedSince: ev.filter((e) => e.state === "suggested").length,
        confirmedSince: ev.filter((e) => e.state === "confirmed").length,
        confidenceMoves: moves,
      });
    }
  }

  const queue = await getTodayQueue();

  const openRecs = await database
    .select({
      opportunityId: opportunities.id,
      title: opportunities.title,
      action: recommendations.primaryAction,
      status: opportunities.status,
    })
    .from(recommendations)
    .innerJoin(opportunities, eq(recommendations.opportunityId, opportunities.id))
    .where(eq(recommendations.status, "open"));
  const openLeads = openRecs
    .filter((r) => LEAD_ACTIONS.has(r.action) && r.status === "proposed")
    .map((r) => ({ opportunityId: r.opportunityId, title: r.title, action: r.action }));

  // stories that were developing and have gone quiet (no observation in 5+ days)
  const quietCutoff = new Date(Date.now() - 5 * 24 * 3600 * 1000);
  const goneQuiet: QuietThread[] = threads
    .filter((t) => t.observationCount >= 2 && t.lastObservedAt && t.lastObservedAt < quietCutoff)
    .slice(0, 6)
    .map((t) => ({
      threadId: t.id,
      title: t.canonicalTitle,
      observationCount: t.observationCount,
      lastObservedAt: t.lastObservedAt?.toISOString() ?? "",
    }));

  const windowDays = await followUpDays();
  const followUps = await getFollowUpsDue(windowDays);
  const crossVenue = await crossVenueTrends();

  return {
    since,
    generatedAt: new Date().toISOString(),
    movedThreads: movedThreads.slice(0, 10),
    newThreads: newThreads.slice(0, 12),
    thesisActivity,
    queue,
    openLeads: openLeads.slice(0, 8),
    goneQuiet,
    followUps,
    followUpWindowDays: windowDays,
    crossVenue,
  };
}

export async function markCaughtUp(): Promise<string> {
  const now = new Date().toISOString();
  await setCursor(CURSOR_COLLECTOR, CURSOR_KEY, now);
  return now;
}

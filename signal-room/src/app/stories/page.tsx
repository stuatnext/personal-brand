import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { opportunities, storyThreads } from "@/lib/db/schema";
import { EmptyState, PageHeader, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StoriesPage() {
  const database = await db();
  const threads = await database
    .select()
    .from(storyThreads)
    .orderBy(desc(storyThreads.lastObservedAt))
    .limit(200);

  // link each thread's latest observation to its opportunity
  const latestClusterIds = threads
    .map((t) => (t.observationsJson ?? []).slice(-1)[0]?.clusterId)
    .filter((c): c is string => Boolean(c));
  const opps = latestClusterIds.length
    ? await database
        .select({ id: opportunities.id, clusterId: opportunities.storyClusterId })
        .from(opportunities)
        .where(inArray(opportunities.storyClusterId, latestClusterIds))
    : [];
  const oppByCluster = new Map(opps.map((o) => [o.clusterId, o.id]));

  return (
    <>
      <PageHeader
        section="Stories"
        title="Story threads"
        meta="The same story tracked across days. An observation is one appearance in one ingestion; new-claim counts show whether the story is moving or repeating."
      />
      {threads.length === 0 ? (
        <EmptyState
          title="No story threads yet"
          hint="Threads build as ingestions are processed; a story seen on two different days links up automatically."
        />
      ) : (
        <div className="space-y-2">
          {threads.map((t) => {
            const observations = t.observationsJson ?? [];
            const latest = observations.slice(-1)[0];
            const oppId = latest ? oppByCluster.get(latest.clusterId) : undefined;
            const continuing = t.observationCount > 1;
            return (
              <div key={t.id} className="panel px-4 py-3" data-testid="story-thread">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {continuing ? (
                        <span className="tag tag-signal">obs {t.observationCount}</span>
                      ) : (
                        <span className="tag">new</span>
                      )}
                      {latest && latest.newClaimCount > 0 && continuing ? (
                        <span className="tag tag-ok">{latest.newClaimCount} new claim(s)</span>
                      ) : continuing ? (
                        <span className="tag">no development</span>
                      ) : null}
                    </div>
                    {oppId ? (
                      <Link
                        href={`/opportunities/${oppId}`}
                        className="mt-1 block truncate text-[13.5px] font-medium hover:text-[--color-signal]"
                      >
                        {t.canonicalTitle}
                      </Link>
                    ) : (
                      <div className="mt-1 truncate text-[13.5px] font-medium">{t.canonicalTitle}</div>
                    )}
                    <div className="k-label mt-1">
                      first {fmtDate(t.firstObservedAt).slice(0, 10)} · last {fmtDate(t.lastObservedAt).slice(0, 10)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {observations.slice(-4).map((o, i) => (
                      <span key={i} className="font-mono text-[10.5px] text-[--color-dim]">
                        {o.date} · {o.itemCount} item(s) · {o.newClaimCount} new
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

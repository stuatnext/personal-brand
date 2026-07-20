import Link from "next/link";
import { getTodayQueue } from "@/lib/queue";
import { ActionTag, EmptyState, Meter, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const queue = await getTodayQueue();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        section="Today"
        title="The moves worth making"
        meta={`${today} · ${queue.length} of a maximum 5 recommendations · everything else is in the archive`}
      >
        <Link href="/paste" className="btn btn-primary">
          + Process intelligence
        </Link>
      </PageHeader>

      {queue.length === 0 ? (
        <EmptyState
          title="No open recommendations"
          hint="Paste a fresh sweep to build today's queue, or check the archive for saved material."
        />
      ) : (
        <div className="space-y-3">
          {queue.map((r, i) => (
            <Link
              key={r.recommendationId}
              href={`/opportunities/${r.opportunityId}`}
              className="panel group flex gap-5 px-5 py-4 transition-colors hover:border-[--color-signal-dim]"
            >
              <div className="ordinal w-[46px] shrink-0 pt-1">{String(i + 1).padStart(2, "0")}</div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <ActionTag action={r.action} />
                  <span className="tag">{r.platform}</span>
                  {r.threadDay ? <span className="tag tag-info">continuing · obs {r.threadDay}</span> : null}
                  <span className="k-label">score {r.overallScore}</span>
                </div>
                <h2 className="text-[15.5px] font-semibold leading-snug tracking-tight group-hover:text-[--color-signal]">
                  {r.title}
                </h2>
                <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-[--color-mut]">
                  {r.rationale}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5">
                  <span className="flex items-center gap-2">
                    <span className="k-label">urgency</span>
                    <Meter value={r.urgency} />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="k-label">confidence</span>
                    <Meter value={r.confidence} />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="k-label">cred risk</span>
                    <Meter value={r.credibilityRisk} inverted />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="k-label">commercial</span>
                    <Meter value={r.commercialValue} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

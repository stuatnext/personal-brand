import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ingestions } from "@/lib/db/schema";
import { EmptyState, PageHeader, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const database = await db();
  const rows = await database
    .select({
      id: ingestions.id,
      title: ingestions.title,
      sourceType: ingestions.sourceType,
      wordCount: ingestions.wordCount,
      processingStatus: ingestions.processingStatus,
      createdAt: ingestions.createdAt,
      fictional: ingestions.fictional,
      defaultPermissionLevel: ingestions.defaultPermissionLevel,
    })
    .from(ingestions)
    .orderBy(desc(ingestions.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader
        section="Intelligence"
        title="Ingestions"
        meta="Every drop, preserved verbatim. Open one for its processing report and extracted items."
      >
        <Link href="/paste" className="btn btn-primary">
          + Process intelligence
        </Link>
      </PageHeader>
      {rows.length === 0 ? (
        <EmptyState title="Nothing ingested yet" hint="Start with a paste." />
      ) : (
        <div className="overflow-hidden rounded-[3px] border hairline">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b hairline bg-[--color-panel-2]">
                <th className="k-label px-3 py-2 font-normal">title</th>
                <th className="k-label px-3 py-2 font-normal">source</th>
                <th className="k-label px-3 py-2 font-normal">words</th>
                <th className="k-label px-3 py-2 font-normal">status</th>
                <th className="k-label px-3 py-2 font-normal">captured</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b hairline transition-colors hover:bg-[--color-panel-2]">
                  <td className="max-w-[430px] px-3 py-2.5">
                    <Link href={`/ingestions/${r.id}`} className="line-clamp-1 text-[13px] hover:text-[--color-signal]">
                      {r.title}
                    </Link>
                    <span className="mt-0.5 flex gap-1.5">
                      {r.fictional ? <span className="tag">fictional demo</span> : null}
                      {!r.defaultPermissionLevel.startsWith("public") ? (
                        <span className="tag tag-risk">{r.defaultPermissionLevel.replace(/_/g, " ")}</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="tag">{r.sourceType}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-[--color-mut]">
                    {r.wordCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`tag ${
                        r.processingStatus === "complete"
                          ? "tag-ok"
                          : r.processingStatus === "failed"
                            ? "tag-risk"
                            : "tag-signal"
                      }`}
                    >
                      {r.processingStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11.5px] text-[--color-dim]">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { drafts, opportunities } from "@/lib/db/schema";
import { EmptyState, PageHeader, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const database = await db();
  const rows = await database
    .select({ draft: drafts, opportunityTitle: opportunities.title })
    .from(drafts)
    .innerJoin(opportunities, eq(drafts.opportunityId, opportunities.id))
    .orderBy(desc(drafts.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader
        section="Drafts"
        title="Drafts"
        meta="Nothing here is ever sent or published by the system. Stuart acts by hand."
      />
      {rows.length === 0 ? (
        <EmptyState title="No drafts yet" hint="Open an opportunity and choose Use it or Generate draft." />
      ) : (
        <div className="overflow-hidden rounded-[3px] border hairline">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b hairline bg-[--color-panel-2]">
                <th className="k-label px-3 py-2 font-normal">type</th>
                <th className="k-label px-3 py-2 font-normal">story</th>
                <th className="k-label px-3 py-2 font-normal">status</th>
                <th className="k-label px-3 py-2 font-normal">voice</th>
                <th className="k-label px-3 py-2 font-normal">permissions</th>
                <th className="k-label px-3 py-2 font-normal">created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ draft, opportunityTitle }) => {
                const lintErrors = draft.voiceLintJson?.errors?.length ?? 0;
                const permWarnings = draft.permissionWarningsJson?.length ?? 0;
                return (
                  <tr key={draft.id} className="border-b hairline transition-colors hover:bg-[--color-panel-2]">
                    <td className="px-3 py-2.5">
                      <span className="tag">{draft.draftType.replace(/_/g, " ")}</span>
                    </td>
                    <td className="max-w-[420px] px-3 py-2.5">
                      <Link href={`/drafts/${draft.id}`} className="line-clamp-1 text-[13px] hover:text-[--color-signal]">
                        {opportunityTitle}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`tag ${draft.status === "final" ? "tag-ok" : ""}`}>{draft.status}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px]">
                      {lintErrors > 0 ? (
                        <span className="text-[--color-risk]">{lintErrors} error(s)</span>
                      ) : (
                        <span className="text-[--color-ok]">clean</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px]">
                      {permWarnings > 0 ? (
                        <span className="text-[--color-risk]">{permWarnings} warning(s)</span>
                      ) : (
                        <span className="text-[--color-dim]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px] text-[--color-dim]">
                      {fmtDate(draft.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

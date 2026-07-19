import { db, queryRaw } from "@/lib/db/client";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  await db();
  const rows = await queryRaw<{
    id: string;
    kind: string;
    canonical_name: string;
    flags_json: Record<string, unknown> | null;
    mention_count: string | number;
    author_count: string | number;
  }>(
    `SELECT e.id, e.kind, e.canonical_name, e.flags_json,
            count(m.id) AS mention_count,
            count(m.id) FILTER (WHERE m.role = 'author') AS author_count
     FROM entities e
     LEFT JOIN entity_mentions m ON m.entity_id = e.id
     GROUP BY e.id, e.kind, e.canonical_name, e.flags_json
     HAVING count(m.id) > 0
     ORDER BY count(m.id) DESC
     LIMIT 400`,
  );

  const people = rows.filter((r) => r.kind === "person");
  const orgs = rows.filter((r) => r.kind !== "person");

  const Table = ({ title, data }: { title: string; data: typeof rows }) => (
    <section>
      <div className="k-label mb-3">
        {title} · {data.length}
      </div>
      <div className="overflow-hidden rounded-[3px] border hairline">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b hairline bg-[--color-panel-2]">
              <th className="k-label px-3 py-2 font-normal">name</th>
              <th className="k-label px-3 py-2 font-normal">kind</th>
              <th className="k-label px-3 py-2 font-normal">prospect</th>
              <th className="k-label px-3 py-2 font-normal">mentions</th>
              <th className="k-label px-3 py-2 font-normal">authored</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const flags = (r.flags_json ?? {}) as { prospectType?: string; category?: string };
              return (
                <tr key={r.id} className="border-b hairline transition-colors hover:bg-[--color-panel-2]">
                  <td className="px-3 py-2 text-[13px]">{r.canonical_name}</td>
                  <td className="px-3 py-2">
                    <span className="tag">
                      {r.kind}
                      {flags.category ? ` · ${flags.category.replace(/_/g, " ")}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {flags.prospectType ? <span className="tag tag-ok">{flags.prospectType}</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-[--color-mut]">{String(r.mention_count)}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-[--color-dim]">{String(r.author_count)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <>
      <PageHeader
        section="People"
        title="People and companies"
        meta="Everyone the intelligence has seen, with prospect flags where they exist. The relationship graph builds on this."
      />
      {rows.length === 0 ? (
        <EmptyState title="No entities yet" hint="Process an ingestion first." />
      ) : (
        <div className="space-y-8">
          <Table title="People" data={people} />
          <Table title="Companies, platforms, regulators, publications" data={orgs} />
        </div>
      )}
    </>
  );
}

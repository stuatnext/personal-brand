import Link from "next/link";
import { notFound } from "next/navigation";
import { personProfile } from "@/lib/graph";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await personProfile(id);
  if (!profile) notFound();
  const { entity, edges, worksAt, mentionCount, authoredCount, recentItems } = profile;
  const flags = entity.flags as { prospectType?: string; category?: string };

  return (
    <>
      <PageHeader
        section={`People / ${entity.kind}`}
        title={entity.name}
        meta={`${mentionCount} mention(s) · ${authoredCount} authored item(s)${worksAt.length ? ` · works at ${worksAt.join(", ")}` : ""}`}
      >
        {flags.prospectType ? <span className="tag tag-ok">{flags.prospectType} prospect</span> : null}
        {flags.category ? <span className="tag">{String(flags.category).replace(/_/g, " ")}</span> : null}
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <section data-testid="person-items">
          <div className="k-label mb-3">Recent material · {recentItems.length}</div>
          <div className="space-y-2">
            {recentItems.map((item) => (
              <div key={item.itemId} className="panel px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="tag">{item.role}</span>
                  <span className="tag">{item.platform}</span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[--color-mut]">“{item.excerpt}…”</p>
                {item.opportunityId ? (
                  <Link
                    href={`/opportunities/${item.opportunityId}`}
                    className="k-value mt-1.5 block !text-[11.5px] text-[--color-info] hover:text-[--color-signal]"
                  >
                    → {item.opportunityTitle?.slice(0, 80)}
                  </Link>
                ) : null}
              </div>
            ))}
            {recentItems.length === 0 ? (
              <div className="panel px-4 py-3 text-[12.5px] text-[--color-dim]">No captured material yet.</div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="panel p-4" data-testid="person-edges">
            <div className="k-label mb-3">Relationship edges</div>
            {edges.length === 0 ? (
              <div className="text-[12px] text-[--color-dim]">
                None yet. Edges build when Stuart uses opportunities involving this {entity.kind}.
              </div>
            ) : (
              <div className="space-y-2">
                {edges.map((e, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between">
                      <span
                        className={`tag ${
                          e.relationship === "stuart_engaged_with"
                            ? "tag-signal"
                            : e.relationship.endsWith("prospect") || e.relationship === "media_contact"
                              ? "tag-ok"
                              : ""
                        }`}
                      >
                        {e.relationship.replace(/_/g, " ")}
                        {e.withName && e.withName !== "Stuart" ? ` · ${e.withName}` : ""}
                      </span>
                      <span className="k-value !text-[11px]">{Math.round(e.strength * 100)}%</span>
                    </div>
                    {e.note ? <div className="mt-0.5 text-[11px] leading-snug text-[--color-dim]">{e.note}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </section>
          <p className="px-1 text-[11.5px] leading-relaxed text-[--color-dim]">
            Engagement edges feed relationship scoring: when this {entity.kind} shows up in future
            intelligence, the story ranks higher because the relationship already exists.
          </p>
        </aside>
      </div>
    </>
  );
}

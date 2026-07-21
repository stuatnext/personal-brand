import Link from "next/link";
import { notFound } from "next/navigation";
import { personProfile } from "@/lib/graph";
import { PageHeader } from "@/components/ui";
import { EdgeList, IntroductionForm } from "./outreach-controls";

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
            <EdgeList edges={edges} entityKind={entity.kind} />
          </section>
          <section className="panel p-4">
            <IntroductionForm entityId={entity.id} entityName={entity.name} />
          </section>
          <p className="px-1 text-[11.5px] leading-relaxed text-[--color-dim]">
            Engagement edges feed relationship scoring: when this {entity.kind} shows up in future
            intelligence, the story ranks higher because the relationship already exists. Prospect
            edges carry an outreach state; the system only ever records what Stuart did by hand.
          </p>
        </aside>
      </div>
    </>
  );
}

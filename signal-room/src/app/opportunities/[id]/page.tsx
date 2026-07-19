import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  claimEvidence,
  claims,
  clusterItems,
  entities,
  entityMentions,
  ingestions,
  opportunities,
  opportunityScores,
  sourceItems,
  storyClusters,
  SCORE_DIMENSIONS,
} from "@/lib/db/schema";
import { isPublishable } from "@/lib/permissions";
import {
  ActionTag,
  Meter,
  PageHeader,
  PermissionTag,
  VerificationTag,
  ACTION_LABELS,
} from "@/components/ui";
import { OpportunityActions } from "./actions";

export const dynamic = "force-dynamic";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="k-label mb-1">{label}</div>
      <div className="prose-body">{children}</div>
    </div>
  );
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const [opp] = await database.select().from(opportunities).where(eq(opportunities.id, id));
  if (!opp) notFound();

  const [cluster] = await database
    .select()
    .from(storyClusters)
    .where(eq(storyClusters.id, opp.storyClusterId));
  const [ingestion] = opp.ingestionId
    ? await database.select().from(ingestions).where(eq(ingestions.id, opp.ingestionId))
    : [undefined];
  const scores = await database
    .select()
    .from(opportunityScores)
    .where(eq(opportunityScores.opportunityId, id));
  const orderedScores = SCORE_DIMENSIONS.map((d) => scores.find((s) => s.dimension === d)).filter(
    (s): s is NonNullable<typeof s> => Boolean(s),
  );

  const memberRows = await database
    .select({ item: sourceItems, role: clusterItems.role })
    .from(clusterItems)
    .innerJoin(sourceItems, eq(clusterItems.sourceItemId, sourceItems.id))
    .where(eq(clusterItems.clusterId, opp.storyClusterId))
    .orderBy(asc(sourceItems.rawStartOffset));

  const clusterClaims = await database
    .select()
    .from(claims)
    .where(eq(claims.storyClusterId, opp.storyClusterId));
  const evidence = clusterClaims.length
    ? await database
        .select()
        .from(claimEvidence)
        .where(inArray(claimEvidence.claimId, clusterClaims.map((c) => c.id)))
    : [];
  const itemById = new Map(memberRows.map((m) => [m.item.id, m.item]));

  const itemIds = memberRows.map((m) => m.item.id);
  const mentionRows = itemIds.length
    ? await database
        .select({ mention: entityMentions, entity: entities })
        .from(entityMentions)
        .innerJoin(entities, eq(entityMentions.entityId, entities.id))
        .where(inArray(entityMentions.sourceItemId, itemIds))
    : [];
  const people = new Map<string, { name: string; kind: string; roles: Set<string>; flags: Record<string, unknown> }>();
  for (const { mention, entity } of mentionRows) {
    const rec = people.get(entity.id) ?? {
      name: entity.canonicalName,
      kind: entity.kind,
      roles: new Set<string>(),
      flags: (entity.flagsJson ?? {}) as Record<string, unknown>,
    };
    rec.roles.add(mention.role);
    people.set(entity.id, rec);
  }

  const INVERTED = new Set(["saturation", "credibility_risk"]);

  return (
    <>
      <PageHeader
        section={`Opportunity / ${ingestion?.title ?? ""}`}
        title={opp.title}
        meta={`overall ${opp.overallScore} · status ${opp.status.replace(/_/g, " ")}`}
      >
        <ActionTag action={opp.recommendedAction} />
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_330px]">
        <div className="space-y-6">
          {/* editorial brief */}
          <section className="panel space-y-4 p-5" data-testid="editorial-brief">
            <Field label="What happened">{opp.whatHappened}</Field>
            <Field label="What changed">{opp.whatChanged}</Field>
            <Field label="What is genuinely new">{opp.whatsNew}</Field>
            <div className="grid grid-cols-1 gap-4 border-t hairline pt-4 md:grid-cols-2">
              <Field label="Confirmed">{opp.confirmedSummary}</Field>
              <Field label="Claimed only">{opp.claimedSummary}</Field>
            </div>
            <Field label="Missing from the discussion">{opp.missingSummary}</Field>
          </section>

          <section className="panel border-l-2 border-l-[--color-signal] p-5" data-testid="stuart-angle">
            <div className="k-label mb-2 !text-[--color-signal]">Why Stuart has an angle</div>
            <p className="prose-body">{opp.stuartAngle}</p>
            <div className="mt-4 grid grid-cols-1 gap-4 border-t hairline pt-4 md:grid-cols-2">
              <Field label={`Recommended: ${ACTION_LABELS[opp.recommendedAction] ?? opp.recommendedAction}`}>
                {opp.rationale}
              </Field>
              <Field label="Why not the alternatives">
                {(opp.actionAlternativesJson ?? []).length === 0
                  ? opp.whyBetter
                  : (opp.actionAlternativesJson ?? []).map((a) => (
                      <p key={a.action} className="!mt-0">
                        <span className="font-mono text-[11.5px] uppercase text-[--color-dim]">
                          {ACTION_LABELS[a.action] ?? a.action}:
                        </span>{" "}
                        {a.whyNot}
                      </p>
                    ))}
              </Field>
            </div>
            <div className="mt-4 border-t hairline pt-4">
              <Field label="Suggested editorial angle">{opp.editorialAngle}</Field>
            </div>
            <div className="mt-4">
              <Field label="What would change the judgement">{opp.judgementChange}</Field>
            </div>
          </section>

          {/* claims and evidence */}
          <section data-testid="claims-section">
            <div className="k-label mb-3">Claims and evidence · {clusterClaims.length}</div>
            <div className="space-y-2">
              {clusterClaims.map((c) => (
                <details key={c.id} className="panel group px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                    <span className="text-[13px] leading-snug">{c.claimText}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {c.publicationRisk === "high" ? <span className="tag tag-risk">high risk</span> : null}
                      <VerificationTag status={c.status} />
                    </span>
                  </summary>
                  <div className="mt-3 space-y-2 border-t hairline pt-3">
                    {evidence
                      .filter((e) => e.claimId === c.id)
                      .map((e) => {
                        const item = itemById.get(e.sourceItemId);
                        return (
                          <div key={e.id} className="flex items-start gap-3">
                            <span className={`tag shrink-0 ${e.independent ? "tag-ok" : ""}`}>
                              {e.independent ? "independent" : "repetition"}
                            </span>
                            <div className="min-w-0">
                              <div className="font-mono text-[11.5px] text-[--color-dim]">
                                {item?.authorNameRaw ?? "unknown"} · {item?.platform} ·{" "}
                                {e.kind === "contradicting" ? "contradicts" : e.kind}
                              </div>
                              <div className="text-[12.5px] text-[--color-mut]">“{e.excerpt}”</div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </details>
              ))}
              {clusterClaims.length === 0 ? (
                <div className="panel px-4 py-3 text-[12.5px] text-[--color-dim]">
                  No extractable factual claims; this cluster is conversation and colour.
                </div>
              ) : null}
            </div>
          </section>

          {/* source items */}
          <section data-testid="evidence-items">
            <div className="k-label mb-3">Source items in this story · {memberRows.length}</div>
            <div className="space-y-2">
              {memberRows.map(({ item, role }) => (
                <details key={item.id} className="panel px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-[12px]">
                      <span className="text-[--color-dim]">{role}</span>{" "}
                      <span className="text-[--color-fg]">{item.authorNameRaw ?? "unknown"}</span>{" "}
                      <span className="text-[--color-dim]">
                        · {item.platform} · {item.itemType.replace(/_/g, " ")}
                        {item.publishedAtText ? ` · ${item.publishedAtText}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {!isPublishable(item.permissionLevel) ? <PermissionTag level={item.permissionLevel} /> : null}
                      <span className="k-label">
                        {item.rawStartOffset}–{item.rawEndOffset}
                      </span>
                    </span>
                  </summary>
                  <div className="prose-body mt-3 whitespace-pre-wrap border-t hairline pt-3 text-[--color-mut]">
                    {item.originalText}
                    {item.quotedText ? (
                      <div className="mt-2 border-l-2 border-[--color-line-2] pl-3">{item.quotedText}</div>
                    ) : null}
                    {item.sourceUrl ? (
                      <div className="k-value mt-2 !text-[11.5px] text-[--color-info]">{item.sourceUrl}</div>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </section>
        </div>

        {/* right rail */}
        <aside className="space-y-6">
          <OpportunityActions
            opportunityId={opp.id}
            currentStatus={opp.status}
            recommendedAction={opp.recommendedAction}
          />

          <section className="panel p-4" data-testid="score-breakdown">
            <div className="k-label mb-3">Component scores</div>
            <div className="space-y-2.5">
              {orderedScores.map((s) => (
                <div key={s.dimension} title={s.reason ?? ""}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[--color-mut]">
                      {s.dimension.replace(/_/g, " ")}
                    </span>
                    <span className="flex items-center gap-2">
                      <Meter value={s.score} inverted={INVERTED.has(s.dimension)} />
                      <span className="k-value w-[26px] text-right !text-[11px]">{Math.round(s.score)}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[--color-dim]">{s.reason}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel p-4">
            <div className="k-label mb-3">People and companies</div>
            <div className="flex flex-wrap gap-1.5">
              {[...people.values()]
                .sort((a, b) => (a.kind === "person" ? -1 : 1) - (b.kind === "person" ? -1 : 1))
                .slice(0, 24)
                .map((p) => (
                  <span key={p.name} className={`tag ${p.roles.has("author") ? "tag-signal" : ""}`}>
                    {p.kind === "person" ? "◆" : "▪"} {p.name}
                    {typeof p.flags.prospectType === "string" ? ` · ${p.flags.prospectType}` : ""}
                  </span>
                ))}
              {people.size === 0 ? (
                <span className="text-[12px] text-[--color-dim]">None identified.</span>
              ) : null}
            </div>
          </section>

          <section className="panel p-4">
            <div className="k-label mb-2">Cluster</div>
            <div className="text-[12.5px] leading-relaxed text-[--color-mut]">{cluster?.workingSummary}</div>
            {(cluster?.topicsJson ?? []).length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(cluster?.topicsJson ?? []).map((t) => (
                  <span key={t} className="tag">
                    #{t}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

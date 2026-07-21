import Link from "next/link";
import { getBriefing } from "@/lib/briefing";
import { ActionTag, PageHeader } from "@/components/ui";
import { CaughtUpButton } from "./caught-up";

export const dynamic = "force-dynamic";

export default async function BriefingPage() {
  const b = await getBriefing();
  const sinceLabel = b.since ? b.since.slice(0, 16).replace("T", " ") : "the beginning";

  return (
    <>
      <PageHeader
        section="Briefing"
        title="Since you last sat down"
        meta={`changes since ${sinceLabel} · generated ${b.generatedAt.slice(0, 16).replace("T", " ")}`}
      >
        <CaughtUpButton />
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_330px]">
        <div className="space-y-6">
          <section data-testid="briefing-moved">
            <div className="k-label mb-3 !text-[--color-signal]">Stories that moved · {b.movedThreads.length}</div>
            {b.movedThreads.length === 0 ? (
              <div className="panel px-4 py-3 text-[12.5px] text-[--color-dim]">
                Nothing you have already seen has developed since the marker.
              </div>
            ) : (
              <div className="space-y-2">
                {b.movedThreads.map((t) => (
                  <div key={t.threadId} className="panel border-l-2 border-l-[--color-signal] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="tag tag-signal">obs {t.observationCount}</span>
                      <span className="tag tag-ok">{t.newClaimCount} new claim(s)</span>
                    </div>
                    {t.opportunityId ? (
                      <Link
                        href={`/opportunities/${t.opportunityId}`}
                        className="mt-1.5 block text-[13.5px] font-medium leading-snug hover:text-[--color-signal]"
                      >
                        {t.title}
                      </Link>
                    ) : (
                      <div className="mt-1.5 text-[13.5px] font-medium leading-snug">{t.title}</div>
                    )}
                    {t.whatChanged ? (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-[--color-mut]">{t.whatChanged}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section data-testid="briefing-new">
            <div className="k-label mb-3">New stories · {b.newThreads.length}</div>
            {b.newThreads.length === 0 ? (
              <div className="panel px-4 py-3 text-[12.5px] text-[--color-dim]">No first sightings since the marker.</div>
            ) : (
              <div className="space-y-1.5">
                {b.newThreads.map((t) => (
                  <div key={t.threadId} className="panel flex items-center gap-3 px-4 py-2.5">
                    {t.action ? <ActionTag action={t.action} /> : <span className="tag">new</span>}
                    {t.opportunityId ? (
                      <Link
                        href={`/opportunities/${t.opportunityId}`}
                        className="min-w-0 truncate text-[13px] hover:text-[--color-signal]"
                      >
                        {t.title}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate text-[13px]">{t.title}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section data-testid="briefing-theses">
            <div className="k-label mb-3">Thesis movement · {b.thesisActivity.length}</div>
            {b.thesisActivity.length === 0 ? (
              <div className="panel px-4 py-3 text-[12.5px] text-[--color-dim]">No thesis evidence or confidence moves since the marker.</div>
            ) : (
              <div className="space-y-2">
                {b.thesisActivity.map((t) => (
                  <Link key={t.thesisId} href={`/theses/${t.thesisId}`} className="panel block px-4 py-3 hover:border-[--color-signal-dim]">
                    <div className="text-[13px] font-medium leading-snug">{t.statement}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 font-mono text-[11px] text-[--color-dim]">
                      <span>confidence {Math.round(t.confidence)}%</span>
                      {t.suggestedSince > 0 ? <span className="text-[--color-signal]">{t.suggestedSince} new suggestion(s)</span> : null}
                      {t.confirmedSince > 0 ? <span className="text-[--color-ok]">{t.confirmedSince} confirmed</span> : null}
                      {t.confidenceMoves.map((m, i) => (
                        <span key={i}>
                          {m.from}→{m.to}%{m.note ? ` (${m.note.slice(0, 40)})` : ""}
                        </span>
                      ))}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="panel p-4" data-testid="briefing-queue">
            <div className="k-label mb-3">The queue right now</div>
            <div className="space-y-2">
              {b.queue.map((q, i) => (
                <Link key={q.recommendationId} href={`/opportunities/${q.opportunityId}`} className="flex items-start gap-2 hover:text-[--color-signal]">
                  <span className="ordinal !text-[15px]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <ActionTag action={q.action} />
                    <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug">{q.title}</span>
                  </span>
                </Link>
              ))}
              {b.queue.length === 0 ? <div className="text-[12px] text-[--color-dim]">Queue is clear.</div> : null}
            </div>
          </section>

          <section className="panel p-4" data-testid="briefing-followups">
            <div className="k-label mb-3 !text-[--color-signal]">Follow-ups due · {b.followUps.length}</div>
            {b.followUps.length === 0 ? (
              <div className="text-[12px] text-[--color-dim]">
                Nothing sent has sat silent past {b.followUpWindowDays} days.
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  {b.followUps.map((f) => (
                    <Link key={f.relationshipId} href={`/people/${f.entityId}`} className="block hover:text-[--color-signal]">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[12.5px] font-medium">{f.name}</span>
                        <span className="tag tag-signal shrink-0">{f.daysSilent}d silent</span>
                      </span>
                      <span className="k-label">{f.relationship.replace(/_/g, " ")}</span>
                    </Link>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-[--color-dim]">
                  Follow-ups to silence stay exploratory: the same 20-minute ask with a clean out.
                  No tickets, no pricing. You send by hand; record it on the pipeline.
                </p>
              </>
            )}
          </section>

          <section className="panel p-4">
            <div className="k-label mb-3">Open commercial leads · {b.openLeads.length}</div>
            <div className="space-y-1.5">
              {b.openLeads.map((l) => (
                <Link key={l.opportunityId} href={`/opportunities/${l.opportunityId}`} className="block hover:text-[--color-signal]">
                  <ActionTag action={l.action} />
                  <span className="mt-0.5 line-clamp-1 block text-[12px]">{l.title}</span>
                </Link>
              ))}
              {b.openLeads.length === 0 ? <div className="text-[12px] text-[--color-dim]">None open.</div> : null}
            </div>
          </section>

          <section className="panel p-4" data-testid="briefing-crossvenue">
            <div className="k-label mb-3">Cross-venue trends · {b.crossVenue.length}</div>
            {b.crossVenue.length === 0 ? (
              <div className="text-[12px] text-[--color-dim]">
                No matched pair has enough history yet. Trends build as the markets collector runs.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {b.crossVenue.map((t) => (
                    <div key={t.pairId}>
                      <div className="text-[12.5px] font-medium leading-snug">{t.title.slice(0, 80)}</div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-[--color-mut]">{t.headline}</div>
                      <div className="k-label mt-0.5">
                        {t.kind.replace(/_/g, " ")} · {t.kalshiMarketId} / {t.polymarketMarketId}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-[--color-dim]">
                  Prices are venue-API quotes compared within single runs; the pairing itself is the
                  matcher&apos;s inference.
                </p>
              </>
            )}
          </section>

          <section className="panel p-4">
            <div className="k-label mb-3">Gone quiet</div>
            {b.goneQuiet.length === 0 ? (
              <div className="text-[12px] text-[--color-dim]">Nothing developing has stalled.</div>
            ) : (
              <ul className="space-y-1.5">
                {b.goneQuiet.map((t) => (
                  <li key={t.threadId} className="text-[12px] leading-snug text-[--color-mut]">
                    <span className="k-label">{t.lastObservedAt.slice(0, 10)}</span> · {t.title.slice(0, 70)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

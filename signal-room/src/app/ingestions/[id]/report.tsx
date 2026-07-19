"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ActionTag, fmtDate } from "@/components/ui";

interface Stage {
  key: string;
  label: string;
  status: string;
  detail?: string;
}
interface Run {
  id: string;
  status: string;
  currentStage: string | null;
  stagesJson: Stage[];
  statsJson: Record<string, unknown> & { warnings?: string[] };
  error: string | null;
  provider: string;
}
interface Item {
  id: string;
  platform: string;
  itemType: string;
  author: string | null;
  authorMeta: string | null;
  text: string;
  quotedText: string | null;
  sourceUrl: string | null;
  publishedAtText: string | null;
  engagement: Record<string, number | string>;
  offsets: [number, number];
  confidence: number;
  isNoise: boolean;
  noiseReason: string | null;
  permissionLevel: string;
}

export function ProcessingReport({ ingestionId }: { ingestionId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [ingestion, setIngestion] = useState<Record<string, unknown> | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<"content" | "noise" | "all">("content");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [queue, setQueue] = useState<{ opportunityId: string; title: string; action: string }[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ingestions/${ingestionId}`, { cache: "no-store" });
    const data = await res.json();
    setIngestion(data.ingestion);
    setRun(data.latestRun);
    return data.latestRun as Run | null;
  }, [ingestionId]);

  const loadItems = useCallback(async () => {
    const res = await fetch(`/api/ingestions/${ingestionId}/items?filter=all`, { cache: "no-store" });
    const data = await res.json();
    setItems(data.items);
  }, [ingestionId]);

  const loadQueue = useCallback(async () => {
    const res = await fetch(`/api/ingestions/${ingestionId}/queue`, { cache: "no-store" });
    const data = await res.json();
    setQueue(
      (data.queue as { opportunityId: string; title: string; action: string }[]).slice(0, 5),
    );
  }, [ingestionId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      const latest = await load();
      if (stopped) return;
      if (!latest || latest.status === "running" || latest.status === "queued") {
        timer = setTimeout(tick, 900);
      } else {
        await Promise.all([loadItems(), loadQueue()]);
      }
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [load, loadItems, loadQueue]);

  if (!run || !ingestion) {
    return <div className="k-value text-[--color-mut]">Loading run…</div>;
  }

  const stats = run.statsJson ?? {};
  const running = run.status === "running" || run.status === "queued";
  const stages: Stage[] = run.stagesJson ?? [];

  const statCards: { label: string; value: unknown }[] = [
    { label: "Raw word count", value: stats.rawWordCount },
    { label: "Chunks", value: stats.chunkCount },
    { label: "Blocks detected", value: stats.blocksDetected },
    { label: "Unique source items", value: stats.uniqueSourceItems },
    { label: "Duplicates / reposts", value: stats.duplicateItems },
    { label: "Interface noise set aside", value: stats.noiseItems },
    { label: "Story clusters", value: stats.storyClusters },
    { label: "Claims extracted", value: stats.claimsTotal },
    { label: "Claims needing verification", value: stats.claimsNeedingVerification },
    { label: "Relevant people", value: stats.relevantPeople },
    { label: "Potential commercial leads", value: stats.potentialLeads },
    { label: "Queued recommendations", value: stats.recommendations },
  ];

  const shown = (items ?? []).filter((i) =>
    filter === "all" ? true : filter === "noise" ? i.isNoise : !i.isNoise,
  );

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        <div className="panel p-4">
          <div className="k-label mb-3">Pipeline · {run.provider} provider</div>
          <ol className="space-y-2">
            {stages.map((s) => (
              <li key={s.key} className="flex items-center gap-2.5">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    s.status === "complete"
                      ? "bg-[--color-ok]"
                      : s.status === "running"
                        ? "stage-running bg-[--color-signal]"
                        : s.status === "failed"
                          ? "bg-[--color-risk]"
                          : "bg-[--color-line-2]"
                  }`}
                />
                <span
                  className={`font-mono text-[12px] ${
                    s.status === "pending" ? "text-[--color-dim]" : "text-[--color-fg]"
                  }`}
                >
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
          {run.error ? (
            <div className="mt-4 border border-[--color-risk]/40 bg-[--color-risk]/5 p-3 font-mono text-[11.5px] text-[--color-risk]">
              {run.error}
              <button
                className="btn btn-danger mt-3 w-full justify-center"
                onClick={async () => {
                  await fetch(`/api/ingestions/${ingestionId}/reprocess`, { method: "POST" });
                  location.reload();
                }}
              >
                Reprocess
              </button>
            </div>
          ) : null}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="font-mono text-[13px] text-[--color-fg]">{String(ingestion.title ?? "")}</div>
              <div className="k-label mt-1">
                {String(ingestion.sourceType)} · {fmtDate(ingestion.createdAt as string)} · sha256{" "}
                {String(ingestion.rawSha256 ?? "").slice(0, 12)}…
              </div>
            </div>
            {!running ? (
              <button
                className="btn"
                onClick={async () => {
                  await fetch(`/api/ingestions/${ingestionId}/reprocess`, { method: "POST" });
                  location.reload();
                }}
              >
                Reprocess
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border hairline bg-[--color-line] sm:grid-cols-3 xl:grid-cols-4">
            {statCards.map((s) => (
              <div key={s.label} className="bg-[--color-panel] px-4 py-3">
                <div className="font-mono text-[20px] font-semibold text-[--color-fg]">
                  {s.value === undefined || s.value === null ? (running ? "…" : "0") : String(s.value)}
                </div>
                <div className="k-label mt-0.5 !text-[10px]">{s.label}</div>
              </div>
            ))}
          </div>
          {(stats.warnings ?? []).length > 0 ? (
            <div className="mt-3 space-y-1">
              {(stats.warnings ?? []).map((w, i) => (
                <div key={i} className="font-mono text-[11.5px] text-[--color-signal]">
                  ⚠ {w}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {!running && queue.length > 0 ? (
        <section className="panel p-4" data-testid="report-queue">
          <div className="k-label mb-3">This run&apos;s action queue</div>
          <ul className="space-y-2">
            {queue.slice(0, 5).map((q) => (
              <li key={q.opportunityId} className="flex items-center gap-3">
                <ActionTag action={q.action} />
                <Link
                  href={`/opportunities/${q.opportunityId}`}
                  className="truncate text-[13px] hover:text-[--color-signal]"
                >
                  {q.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!running ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="k-label">Extracted source items</div>
            <div className="flex gap-1">
              {(["content", "noise", "all"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`tag ${filter === f ? "tag-signal" : ""} cursor-pointer`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-[3px] border hairline">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b hairline bg-[--color-panel-2]">
                  <th className="k-label px-3 py-2 font-normal">type</th>
                  <th className="k-label px-3 py-2 font-normal">author</th>
                  <th className="k-label px-3 py-2 font-normal">content</th>
                  <th className="k-label px-3 py-2 font-normal">conf</th>
                  <th className="k-label px-3 py-2 font-normal">offsets</th>
                </tr>
              </thead>
              <tbody data-testid="items-table">
                {shown.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    className={`cursor-pointer border-b hairline align-top transition-colors hover:bg-[--color-panel-2] ${
                      item.isNoise ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span className="tag">{item.itemType.replace(/_/g, " ")}</span>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2 font-mono text-[12px]">
                      {item.author ?? "·"}
                    </td>
                    <td className="max-w-[480px] px-3 py-2 text-[12.5px] leading-snug text-[--color-mut]">
                      {expanded === item.id ? (
                        <div className="whitespace-pre-wrap text-[--color-fg]">
                          {item.text}
                          {item.quotedText ? (
                            <div className="mt-2 border-l-2 border-[--color-line-2] pl-2 text-[--color-mut]">
                              {item.quotedText}
                            </div>
                          ) : null}
                          {item.noiseReason ? (
                            <div className="k-label mt-2">set aside: {item.noiseReason}</div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="line-clamp-2">{item.text}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-[--color-dim]">
                      {Math.round(item.confidence * 100)}%
                    </td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-[--color-dim]">
                      {item.offsets[0]}–{item.offsets[1]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

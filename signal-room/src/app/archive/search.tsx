"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActionTag, fmtDate } from "@/components/ui";

interface Row {
  id: string;
  title: string;
  action: string;
  status: string;
  overallScore: number;
  createdAt: string;
  from: string;
  platform: string;
}

const STATUSES = ["", "proposed", "used", "saved", "ignored", "wrong_angle"];
const PILLAR_FILTERS = ["", "prediction_markets", "igaming", "strait_up_growth"];
const ACTIONS = [
  "",
  "linkedin_post",
  "x_post",
  "quote_post",
  "comment",
  "forum_post",
  "dm",
  "email",
  "speaker_lead",
  "sponsor_lead",
  "media_lead",
  "sales_handoff",
  "investigate",
  "save",
  "monitor",
  "ignore",
];

export function ArchiveSearch() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [action, setAction] = useState("");
  const [pillar, setPillar] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (action) params.set("action", action);
      if (pillar) params.set("pillar", pillar);
      const res = await fetch(`/api/archive?${params}`, { cache: "no-store" });
      const data = await res.json();
      setRows(data.results ?? []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, status, action, pillar]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          data-testid="archive-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles, evidence summaries, angles…"
          className="w-[340px]"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s ? `status: ${s.replace(/_/g, " ")}` : "any status"}
            </option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a ? `action: ${a.replace(/_/g, " ")}` : "any action"}
            </option>
          ))}
        </select>
        <select value={pillar} onChange={(e) => setPillar(e.target.value)} aria-label="pillar filter">
          {PILLAR_FILTERS.map((p) => (
            <option key={p} value={p}>
              {p ? `pillar: ${p.replace(/_/g, " ")}` : "any pillar"}
            </option>
          ))}
        </select>
        <span className="k-label">{loading ? "searching…" : `${rows.length} result(s)`}</span>
      </div>

      <div className="overflow-hidden rounded-[3px] border hairline">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b hairline bg-[--color-panel-2]">
              <th className="k-label px-3 py-2 font-normal">story</th>
              <th className="k-label px-3 py-2 font-normal">action</th>
              <th className="k-label px-3 py-2 font-normal">status</th>
              <th className="k-label px-3 py-2 font-normal">score</th>
              <th className="k-label px-3 py-2 font-normal">from</th>
              <th className="k-label px-3 py-2 font-normal">date</th>
            </tr>
          </thead>
          <tbody data-testid="archive-results">
            {rows.map((r) => (
              <tr key={r.id} className="border-b hairline transition-colors hover:bg-[--color-panel-2]">
                <td className="max-w-[380px] px-3 py-2.5">
                  <Link href={`/opportunities/${r.id}`} className="line-clamp-1 text-[13px] hover:text-[--color-signal]">
                    {r.title}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <ActionTag action={r.action} />
                </td>
                <td className="px-3 py-2.5 font-mono text-[11.5px] text-[--color-mut]">
                  {r.status.replace(/_/g, " ")}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px]">{r.overallScore}</td>
                <td className="max-w-[190px] truncate px-3 py-2.5 font-mono text-[11px] text-[--color-dim]">
                  {r.platform}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11.5px] text-[--color-dim]">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading ? (
          <div className="px-4 py-8 text-center font-mono text-[12px] text-[--color-dim]">No matches.</div>
        ) : null}
      </div>
    </div>
  );
}

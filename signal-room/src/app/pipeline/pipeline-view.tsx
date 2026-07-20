"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PipelineLane } from "@/lib/graph";

// Keep in lockstep with OUTREACH_STATES in src/lib/db/schema.ts.
const STATES = ["identified", "drafted", "sent", "replied", "meeting_booked", "confirmed", "passed"];

const STATE_TAG: Record<string, string> = {
  identified: "tag",
  drafted: "tag tag-info",
  sent: "tag tag-signal",
  replied: "tag tag-ok",
  meeting_booked: "tag tag-ok",
  confirmed: "tag tag-ok",
  passed: "tag",
};

const LANE_LABEL: Record<string, string> = {
  speaker_prospect: "Speaker prospects",
  sponsor_prospect: "Sponsor prospects",
  media_contact: "Media contacts",
  sales_prospect: "Sales handoffs",
};

export function PipelineView({
  lanes,
  totalsByState,
}: {
  lanes: PipelineLane[];
  totalsByState: Record<string, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setState(relationshipId: string, state: string) {
    setBusy(relationshipId);
    setError(null);
    const res = await fetch(`/api/relationships/${relationshipId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "update failed");
    }
    setBusy(null);
    router.refresh();
  }

  if (lanes.length === 0) {
    return (
      <div className="panel px-5 py-6 text-[13px] text-[--color-dim]" data-testid="pipeline-empty">
        No prospects yet. Prospect edges appear when Stuart uses a speaker / sponsor / media / sales
        lead from the queue; each then moves through the outreach states as he works it.
      </div>
    );
  }

  return (
    <div data-testid="pipeline-view">
      <div className="mb-5 flex flex-wrap gap-2" data-testid="pipeline-totals">
        {STATES.filter((s) => totalsByState[s]).map((s) => (
          <span key={s} className={STATE_TAG[s]}>
            {s.replace(/_/g, " ")} · {totalsByState[s]}
          </span>
        ))}
      </div>
      {error ? <div className="mb-4 text-[12px] text-[--color-risk]">{error}</div> : null}

      <div className="space-y-8">
        {lanes.map((lane) => (
          <section key={lane.relationship} data-testid={`lane-${lane.relationship}`}>
            <div className="k-label mb-3">
              {LANE_LABEL[lane.relationship] ?? lane.relationship.replace(/_/g, " ")} · {lane.rows.length}
            </div>
            <div className="space-y-2">
              {lane.rows.map((row) => (
                <div key={row.relationshipId} className="panel px-4 py-3" data-testid="pipeline-row">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/people/${row.entityId}`}
                        className="text-[13.5px] font-medium text-[--color-fg] hover:text-[--color-signal]"
                      >
                        {row.name}
                      </Link>
                      <span className="tag ml-2">{row.kind}</span>
                      {row.introducedBy ? (
                        <span className="tag tag-info ml-2">introduced by {row.introducedBy}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={STATE_TAG[row.state] ?? "tag"}>{row.state.replace(/_/g, " ")}</span>
                      <select
                        aria-label={`outreach state for ${row.name}`}
                        value={row.state}
                        disabled={busy === row.relationshipId}
                        onChange={(e) => setState(row.relationshipId, e.target.value)}
                        className="!w-auto text-[11.5px]"
                      >
                        {STATES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-[--color-dim]">
                    {row.stateUpdatedAt ? <span>moved {row.stateUpdatedAt.slice(0, 10)}</span> : null}
                    <span>strength {Math.round(row.strength * 100)}%</span>
                    {row.note ? <span className="truncate">{row.note}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

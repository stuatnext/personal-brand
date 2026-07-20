"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { VerificationTag } from "@/components/ui";

interface EvidenceRow {
  id: string;
  stance: string;
  state: string;
  note: string | null;
  claim: {
    id: string;
    text: string;
    status: string;
    opportunity: { id: string; title: string } | null;
  };
}

interface ThesisData {
  thesis: {
    id: string;
    statement: string;
    rationale: string | null;
    status: string;
    confidence: number;
    resolutionCriteria: string | null;
    whatWouldChange: string | null;
  };
  evidence: EvidenceRow[];
}

const STATUSES = ["open", "strengthening", "weakening", "resolved_true", "resolved_false", "parked"];

export function ThesisDetail({ thesisId }: { thesisId: string }) {
  const [data, setData] = useState<ThesisData | null>(null);
  const [confidence, setConfidence] = useState(50);
  const [confidenceNote, setConfidenceNote] = useState("");
  const [whatWouldChange, setWhatWouldChange] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/theses/${thesisId}`, { cache: "no-store" });
    const d = (await res.json()) as ThesisData;
    setData(d);
    setConfidence(d.thesis.confidence);
    setWhatWouldChange(d.thesis.whatWouldChange ?? "");
  }, [thesisId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <div className="k-value text-[--color-mut]">Loading…</div>;

  async function updateEvidence(id: string, patch: Record<string, string>) {
    await fetch(`/api/thesis-evidence/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
  }

  async function updateThesis(patch: Record<string, unknown>) {
    const res = await fetch(`/api/theses/${thesisId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setNotice(res.ok ? "Saved." : "Save failed.");
    await load();
  }

  const suggested = data.evidence.filter((e) => e.state === "suggested");
  const confirmed = data.evidence.filter((e) => e.state === "confirmed");

  const EvidenceCard = ({ row, triage }: { row: EvidenceRow; triage: boolean }) => (
    <div className="panel px-4 py-3" data-testid={triage ? "suggested-evidence" : "confirmed-evidence"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] leading-snug">{row.claim.text}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <VerificationTag status={row.claim.status} />
            {row.claim.opportunity ? (
              <Link
                href={`/opportunities/${row.claim.opportunity.id}`}
                className="k-value !text-[11px] text-[--color-info] hover:text-[--color-signal]"
              >
                → {row.claim.opportunity.title.slice(0, 60)}
              </Link>
            ) : null}
          </div>
        </div>
        {!triage ? <span className={`tag shrink-0 ${row.stance === "supports" ? "tag-ok" : row.stance === "counters" ? "tag-risk" : ""}`}>{row.stance}</span> : null}
      </div>
      {triage ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t hairline pt-3">
          <button className="btn tag-ok" onClick={() => updateEvidence(row.id, { state: "confirmed", stance: "supports" })}>
            Supports
          </button>
          <button className="btn btn-danger" onClick={() => updateEvidence(row.id, { state: "confirmed", stance: "counters" })}>
            Counters
          </button>
          <button className="btn" onClick={() => updateEvidence(row.id, { state: "confirmed", stance: "context" })}>
            Context
          </button>
          <button className="btn" onClick={() => updateEvidence(row.id, { state: "rejected" })}>
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {suggested.length > 0 ? (
          <section>
            <div className="k-label mb-3 !text-[--color-signal]">Suggested evidence · needs your triage · {suggested.length}</div>
            <div className="space-y-2">
              {suggested.map((row) => (
                <EvidenceCard key={row.id} row={row} triage />
              ))}
            </div>
          </section>
        ) : null}
        <section>
          <div className="k-label mb-3">Confirmed evidence · {confirmed.length}</div>
          <div className="space-y-2">
            {confirmed.map((row) => (
              <EvidenceCard key={row.id} row={row} triage={false} />
            ))}
            {confirmed.length === 0 ? (
              <div className="panel px-4 py-3 text-[12.5px] text-[--color-dim]">
                Nothing confirmed yet. Confirmed evidence is what the tally counts.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="panel space-y-3 p-4">
          <div className="k-label">Confidence (yours, not the system&apos;s)</div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="flex-1 accent-[#FFCF33]"
              data-testid="confidence-slider"
            />
            <span className="k-value w-[42px] text-right">{confidence}%</span>
          </div>
          <input
            type="text"
            value={confidenceNote}
            onChange={(e) => setConfidenceNote(e.target.value)}
            placeholder="Why the move? (goes to the audit trail)"
            className="w-full"
          />
          <button
            className="btn w-full justify-center"
            data-testid="save-confidence"
            onClick={() => updateThesis({ confidence, confidenceNote: confidenceNote || undefined })}
          >
            Record confidence
          </button>
        </section>

        <section className="panel space-y-3 p-4">
          <div className="k-label">Status</div>
          <select
            value={data.thesis.status}
            onChange={(e) => updateThesis({ status: e.target.value })}
            className="w-full"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <div className="k-label mt-2">What would change the view</div>
          <textarea
            value={whatWouldChange}
            onChange={(e) => setWhatWouldChange(e.target.value)}
            className="h-[80px] w-full"
          />
          <button className="btn w-full justify-center" onClick={() => updateThesis({ whatWouldChange })}>
            Save
          </button>
          {notice ? <div className="font-mono text-[11px] text-[--color-mut]">{notice}</div> : null}
        </section>
      </aside>
    </div>
  );
}

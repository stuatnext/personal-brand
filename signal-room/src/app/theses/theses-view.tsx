"use client";

import { useState } from "react";
import Link from "next/link";
import type { ThesisSummary } from "@/lib/theses";

export function ThesesView({ initialTheses }: { initialTheses: ThesisSummary[] }) {
  const [theses, setTheses] = useState(initialTheses);
  const [statement, setStatement] = useState("");
  const [whatWouldChange, setWhatWouldChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/theses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          statement: statement.trim(),
          whatWouldChange: whatWouldChange.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const listed = await fetch("/api/theses", { cache: "no-store" }).then((r) => r.json());
      setTheses(listed.theses);
      setStatement("");
      setWhatWouldChange("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-2">
        {theses.length === 0 ? (
          <div className="panel px-5 py-8 text-center font-mono text-[12.5px] text-[--color-dim]">
            No theses yet. State a position on the right; the pipeline starts collecting evidence for it
            from the next processing run.
          </div>
        ) : (
          theses.map((t) => (
            <Link
              key={t.id}
              href={`/theses/${t.id}`}
              className="panel block px-4 py-3 transition-colors hover:border-[--color-signal-dim]"
              data-testid="thesis-row"
            >
              <div className="flex items-center gap-2">
                <span className={`tag ${t.status === "open" ? "tag-signal" : ""}`}>{t.status.replace(/_/g, " ")}</span>
                <span className="k-label">confidence {Math.round(t.confidence)}%</span>
              </div>
              <div className="mt-1.5 text-[13.5px] font-medium leading-snug">{t.statement}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[--color-dim]">
                <span className="text-[--color-ok]">{t.supporting} supporting</span>
                <span className="text-[--color-risk]">{t.countering} countering</span>
                {t.suggested > 0 ? <span className="text-[--color-signal]">{t.suggested} suggested, needs triage</span> : null}
                {t.lastEvidenceAt ? <span>last evidence {t.lastEvidenceAt.slice(0, 10)}</span> : <span>no evidence yet</span>}
              </div>
            </Link>
          ))
        )}
      </div>

      <aside className="panel h-fit space-y-3 p-4">
        <div className="k-label">New thesis</div>
        <textarea
          data-testid="thesis-statement"
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder='A falsifiable position, e.g. "Distribution through brokerages will matter more than venue product quality through 2026."'
          className="h-[100px] w-full"
        />
        <div>
          <div className="k-label mb-1">What would change your view? (optional)</div>
          <textarea
            value={whatWouldChange}
            onChange={(e) => setWhatWouldChange(e.target.value)}
            placeholder="e.g. A venue reaching top-3 volume with no brokerage distribution."
            className="h-[70px] w-full"
          />
        </div>
        <button
          data-testid="create-thesis"
          className="btn btn-primary w-full justify-center"
          disabled={busy || statement.trim().length < 10}
          onClick={create}
        >
          {busy ? "Creating…" : "Hold this thesis"}
        </button>
        {error ? <div className="font-mono text-[11.5px] text-[--color-risk]">{error}</div> : null}
      </aside>
    </div>
  );
}

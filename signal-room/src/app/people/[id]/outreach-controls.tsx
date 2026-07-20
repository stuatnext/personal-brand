"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Keep in lockstep with OUTREACH_STATES in src/lib/db/schema.ts.
const STATES = ["identified", "drafted", "sent", "replied", "meeting_booked", "confirmed", "passed"];

interface Edge {
  id: string;
  relationship: string;
  strength: number;
  note: string | null;
  withName: string | null;
  state: string;
  stateUpdatedAt: string | null;
  isProspect: boolean;
}

export function EdgeList({ edges, entityKind }: { edges: Edge[]; entityKind: string }) {
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

  if (edges.length === 0) {
    return (
      <div className="text-[12px] text-[--color-dim]">
        None yet. Edges build when Stuart uses opportunities involving this {entityKind}.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error ? <div className="text-[11.5px] text-[--color-risk]">{error}</div> : null}
      {edges.map((e) => (
        <div key={e.id}>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`tag ${
                e.relationship === "stuart_engaged_with"
                  ? "tag-signal"
                  : e.isProspect
                    ? "tag-ok"
                    : e.relationship === "introduced_by"
                      ? "tag-info"
                      : ""
              }`}
            >
              {e.relationship.replace(/_/g, " ")}
              {e.withName && e.withName !== "Stuart" ? ` · ${e.withName}` : ""}
            </span>
            <span className="k-value !text-[11px]">{Math.round(e.strength * 100)}%</span>
          </div>
          {e.isProspect ? (
            <div className="mt-1 flex items-center gap-2" data-testid="edge-state">
              <select
                aria-label="outreach state"
                value={e.state}
                disabled={busy === e.id}
                onChange={(ev) => setState(e.id, ev.target.value)}
                className="!w-auto text-[11px]"
              >
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              {e.stateUpdatedAt ? (
                <span className="text-[10.5px] text-[--color-dim]">moved {e.stateUpdatedAt.slice(0, 10)}</span>
              ) : null}
            </div>
          ) : null}
          {e.note ? <div className="mt-0.5 text-[11px] leading-snug text-[--color-dim]">{e.note}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function IntroductionForm({ entityId, entityName }: { entityId: string; entityName: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) return;
    setStatus(null);
    const res = await fetch(`/api/entities/${entityId}/introduction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ introducerName: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) }),
    });
    if (res.ok) {
      setStatus("Recorded.");
      setName("");
      setNote("");
      router.refresh();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus(body?.error ?? "failed");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2" data-testid="introduction-form">
      <div className="k-label">Introduced by</div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="who made the introduction"
        aria-label={`who introduced ${entityName}`}
        className="w-full"
        maxLength={80}
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="context (optional)"
        aria-label="introduction context"
        className="w-full"
        maxLength={500}
      />
      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={name.trim().length < 3}>
          Record introduction
        </button>
        {status ? <span className="text-[11px] text-[--color-dim]">{status}</span> : null}
      </div>
    </form>
  );
}

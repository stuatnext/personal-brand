"use client";

import { useState } from "react";
import Link from "next/link";
import type { VoiceLintResult, PermissionWarning } from "@/lib/db/schema";

export function DraftEditor({
  draftId,
  opportunityId,
  initialContent,
  initialStatus,
  initialLint,
  initialPermissionWarnings,
  revisions,
}: {
  draftId: string;
  opportunityId: string;
  initialContent: string;
  initialStatus: string;
  initialLint: VoiceLintResult;
  initialPermissionWarnings: PermissionWarning[];
  revisions: { id: string; author: string; note: string; at: string }[];
}) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState(initialStatus);
  const [lint, setLint] = useState<VoiceLintResult>(initialLint);
  const [permWarnings, setPermWarnings] = useState<PermissionWarning[]>(initialPermissionWarnings);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  async function save(nextStatus?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLint(data.voiceLint ?? { errors: [], warnings: [] });
      setPermWarnings(data.permissionWarnings ?? []);
      if (res.status === 409) {
        setNotice(data.error);
      } else {
        if (nextStatus) setStatus(nextStatus);
        else setStatus("edited");
        setDirty(false);
        setNotice(nextStatus === "final" ? "Marked final. Publishing stays manual, by design." : "Saved.");
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <textarea
          data-testid="draft-content"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          className="h-[440px] w-full resize-y !text-[13px] leading-relaxed"
        />
        <div className="flex items-center gap-2">
          <button data-testid="save-draft" className="btn" disabled={busy || !dirty} onClick={() => save()}>
            Save revision
          </button>
          <button
            data-testid="mark-final"
            className="btn btn-primary"
            disabled={busy || permWarnings.length > 0}
            onClick={() => save("final")}
            title={permWarnings.length > 0 ? "Resolve permission warnings first" : ""}
          >
            Mark final
          </button>
          <span className="tag">{status}</span>
          {notice ? <span className="font-mono text-[11.5px] text-[--color-mut]">{notice}</span> : null}
        </div>
        <p className="text-[11.5px] text-[--color-dim]">
          Signal Room never posts or sends. Copy the final text out when you act, then record the outcome
          against the opportunity.
        </p>
        <Link href={`/opportunities/${opportunityId}`} className="k-value !text-[12px] text-[--color-info]">
          ← back to the opportunity and its evidence
        </Link>
      </div>

      <aside className="space-y-4">
        <section className="panel p-4" data-testid="voice-lint">
          <div className="k-label mb-3">Voice check</div>
          {lint.errors.length === 0 && lint.warnings.length === 0 ? (
            <div className="font-mono text-[12px] text-[--color-ok]">Clean against Stuart&apos;s voice rules.</div>
          ) : (
            <div className="space-y-2">
              {lint.errors.map((e, i) => (
                <div key={`e${i}`} className="border-l-2 border-[--color-risk] pl-2.5">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-[--color-risk]">
                    {e.rule.replace(/_/g, " ")}
                  </div>
                  <div className="text-[12px] text-[--color-mut]">
                    “{e.match}” · {e.message}
                  </div>
                </div>
              ))}
              {lint.warnings.map((w, i) => (
                <div key={`w${i}`} className="border-l-2 border-[--color-signal-dim] pl-2.5">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-[--color-signal]">
                    {w.rule.replace(/_/g, " ")}
                  </div>
                  <div className="text-[12px] text-[--color-mut]">
                    “{w.match}” · {w.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel p-4" data-testid="permission-warnings">
          <div className="k-label mb-3">Publication safety</div>
          {permWarnings.length === 0 ? (
            <div className="font-mono text-[12px] text-[--color-ok]">
              No restricted material detected in this draft.
            </div>
          ) : (
            <div className="space-y-2">
              {permWarnings.map((w, i) => (
                <div key={i} className="border-l-2 border-[--color-risk] pl-2.5">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-[--color-risk]">
                    {w.level.replace(/_/g, " ")}
                  </div>
                  <div className="text-[12px] text-[--color-mut]">{w.message}</div>
                </div>
              ))}
              <p className="text-[11px] text-[--color-dim]">
                Drafts with live warnings cannot be marked final.
              </p>
            </div>
          )}
        </section>

        <section className="panel p-4">
          <div className="k-label mb-3">Revisions</div>
          <ol className="space-y-1.5">
            {revisions.map((r) => (
              <li key={r.id} className="font-mono text-[11.5px] text-[--color-mut]">
                <span className="text-[--color-dim]">{r.at.slice(0, 16).replace("T", " ")}</span> · {r.author} ·{" "}
                {r.note}
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}

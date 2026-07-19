"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const DRAFT_TYPES: { value: string; label: string }[] = [
  { value: "x_comment", label: "X comment" },
  { value: "x_quote_post", label: "X quote-post" },
  { value: "x_post", label: "X original post" },
  { value: "linkedin_comment", label: "LinkedIn comment" },
  { value: "linkedin_post", label: "LinkedIn original post" },
  { value: "forum_post", label: "Forum prompt" },
  { value: "dm", label: "DM" },
  { value: "email", label: "Email" },
  { value: "video_script", label: "Short video script" },
];

const MAJOR_TYPES = new Set(["linkedin_post", "x_post"]);

const DEFAULT_TYPE_BY_ACTION: Record<string, string> = {
  comment: "linkedin_comment",
  quote_post: "x_quote_post",
  x_post: "x_post",
  linkedin_post: "linkedin_post",
  forum_post: "forum_post",
  short_video: "video_script",
  dm: "dm",
  email: "email",
  speaker_lead: "email",
  sponsor_lead: "email",
  media_lead: "email",
  sales_handoff: "email",
};

export function OpportunityActions({
  opportunityId,
  currentStatus,
  recommendedAction,
}: {
  opportunityId: string;
  currentStatus: string;
  recommendedAction: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrongAngleOpen, setWrongAngleOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [draftType, setDraftType] = useState(
    DEFAULT_TYPE_BY_ACTION[recommendedAction] ?? "linkedin_post",
  );
  const [reaction, setReaction] = useState("");
  const openedAt = useRef(Date.now());

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  async function sendFeedback(decision: string, extra: Record<string, unknown> = {}) {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          timeTakenMs: Date.now() - openedAt.current,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(
        decision === "use" ? "used" : decision === "wrong_angle" ? "wrong_angle" : decision === "save" ? "saved" : "ignored",
      );
      setWrongAngleOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function makeDraft(alsoUse: boolean) {
    setBusy("draft");
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/drafts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftType,
          stuartReaction: reaction.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (alsoUse) {
        await sendFeedback("use", { draftId: data.id });
      }
      router.push(`/drafts/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <section className="panel space-y-4 p-4" data-testid="opportunity-actions">
      <div className="flex items-center justify-between">
        <div className="k-label">Decision</div>
        {status !== "proposed" ? <span className="tag tag-signal">{status.replace(/_/g, " ")}</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          data-testid="use-it"
          className="btn btn-primary justify-center"
          disabled={busy !== null}
          onClick={() => makeDraft(true)}
        >
          Use it
        </button>
        <button
          data-testid="wrong-angle"
          className="btn justify-center"
          disabled={busy !== null}
          onClick={() => setWrongAngleOpen((v) => !v)}
        >
          Wrong angle
        </button>
        <button
          data-testid="save-later"
          className="btn justify-center"
          disabled={busy !== null}
          onClick={() => sendFeedback("save")}
        >
          Save
        </button>
        <button
          data-testid="ignore"
          className="btn btn-danger justify-center"
          disabled={busy !== null}
          onClick={() => sendFeedback("ignore")}
        >
          Ignore
        </button>
      </div>

      {wrongAngleOpen ? (
        <div className="space-y-2 border-t hairline pt-3">
          <div className="k-label">Why is the angle wrong? (teaches the system)</div>
          <textarea
            data-testid="wrong-angle-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. This is a liquidity story, not a distribution story. / I have covered this twice this month already."
            className="h-[84px] w-full"
          />
          <button
            data-testid="wrong-angle-submit"
            className="btn w-full justify-center"
            disabled={busy !== null || !reason.trim()}
            onClick={() => sendFeedback("wrong_angle", { reason })}
          >
            Record wrong angle
          </button>
        </div>
      ) : null}

      <div className="space-y-2 border-t hairline pt-3">
        <div className="k-label">Draft</div>
        <select data-testid="draft-type" value={draftType} onChange={(e) => setDraftType(e.target.value)} className="w-full">
          {DRAFT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {MAJOR_TYPES.has(draftType) ? (
          <div>
            <div className="k-label mb-1 mt-2 !text-[--color-signal]">
              What is your actual reaction to this? (optional, becomes the centre of the draft)
            </div>
            <textarea
              data-testid="stuart-reaction"
              value={reaction}
              onChange={(e) => setReaction(e.target.value)}
              placeholder="One or two honest sentences in your own words."
              className="h-[74px] w-full"
            />
          </div>
        ) : null}
        <button
          data-testid="generate-draft"
          className="btn w-full justify-center"
          disabled={busy !== null}
          onClick={() => makeDraft(false)}
        >
          {busy === "draft" ? "Drafting…" : "Generate draft"}
        </button>
      </div>

      {error ? <div className="font-mono text-[11.5px] text-[--color-risk]">{error}</div> : null}
    </section>
  );
}

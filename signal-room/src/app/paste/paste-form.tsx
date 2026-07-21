"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Keep in lockstep with PILLARS in src/lib/db/schema.ts.
const PILLAR_CHOICES: { value: string; label: string; hint: string }[] = [
  { value: "prediction_markets", label: "Prediction markets", hint: "NEXTPredict voice; betting vocabulary banned in outreach" },
  { value: "igaming", label: "iGaming & sports betting", hint: "NEXT.io voice; industry vocabulary is normal here" },
  { value: "strait_up_growth", label: "Strait Up Growth", hint: "consultancy voice; AI, commercial strategy, Singapore & SEA" },
];

const SOURCES: { value: string; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "reddit", label: "Reddit" },
  { value: "news", label: "News" },
  { value: "jobs", label: "Jobs" },
  { value: "youtube", label: "YouTube" },
  { value: "market_site", label: "Prediction-market site" },
  { value: "call_transcript", label: "Call transcript" },
  { value: "internal_notes", label: "Internal notes" },
  { value: "mixed", label: "Mixed / not sure" },
];

export function PasteForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("linkedin");
  const [pillar, setPillar] = useState("prediction_markets");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("sourceType", sourceType);
      form.set("pillar", pillar);
      if (title.trim()) form.set("title", title.trim());
      if (text.trim()) form.set("text", text);
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/ingestions", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/ingestions/${data.ingestionId}?run=${data.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_290px]">
      <div className="space-y-4">
        <textarea
          data-testid="paste-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Scroll the feed to the bottom, select everything, paste it here.\n\nNavigation text, repeated headers, reposts, engagement counts, ads, several stories mixed together: expected. Signal Room separates it.`}
          className="h-[430px] w-full resize-y"
        />
        <div className="flex items-center justify-between">
          <span className="k-label">
            {words.toLocaleString()} words · {text.length.toLocaleString()} characters
          </span>
          {error ? <span className="font-mono text-[12px] text-[--color-risk]">{error}</span> : null}
        </div>
      </div>

      <aside className="space-y-5">
        <div className="panel space-y-4 p-4">
          <div>
            <div className="k-label mb-2">Pillar (which lane this drop belongs to)</div>
            <select
              data-testid="pillar-select"
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
              className="w-full"
            >
              {PILLAR_CHOICES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[11.5px] leading-snug text-[--color-mut]">
              {PILLAR_CHOICES.find((p) => p.value === pillar)?.hint}
            </p>
          </div>
          <div>
            <div className="k-label mb-2">Probable source</div>
            <select
              data-testid="source-select"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              className="w-full"
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {sourceType === "call_transcript" || sourceType === "internal_notes" ? (
              <p className="mt-2 text-[11.5px] leading-snug text-[--color-mut]">
                Treated as <span className="text-[--color-risk]">private</span> by default: it can shape
                Stuart&apos;s angle but never enters a public draft.
              </p>
            ) : null}
          </div>
          <div>
            <div className="k-label mb-2">Title (optional)</div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. LinkedIn sweep, Wednesday morning"
              className="w-full"
            />
          </div>
          <div>
            <div className="k-label mb-2">Files (optional)</div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.jsonl,.zip,.png,.jpg,.jpeg,.webp,.gif"
              className="hidden"
              onChange={(e) => setFiles([...(e.target.files ?? [])])}
            />
            <button type="button" className="btn w-full justify-center" onClick={() => fileInput.current?.click()}>
              Add TXT · MD · CSV · JSON · JSONL · ZIP
            </button>
            {files.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {files.map((f) => (
                  <li key={f.name} className="k-value truncate !text-[11.5px] text-[--color-mut]">
                    {f.name} <span className="text-[--color-dim]">({Math.ceil(f.size / 1024)}kb)</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[11.5px] leading-snug text-[--color-dim]">
              Screenshots are OCR&apos;d best-effort (text joins the pipeline as an unverified capture)
              and always stored for manual review.
            </p>
          </div>
        </div>

        <button
          data-testid="process-button"
          className="btn btn-primary w-full justify-center py-3 text-[13px]"
          disabled={busy || (!text.trim() && files.length === 0)}
          onClick={submit}
        >
          {busy ? "Processing…" : "Process intelligence"}
        </button>
        <p className="text-[11.5px] leading-relaxed text-[--color-dim]">
          The raw input is hashed and preserved verbatim before analysis. Every extracted item stays
          traceable to its exact offsets in the original.
        </p>
      </aside>
    </div>
  );
}

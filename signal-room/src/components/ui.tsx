// Shared presentational primitives (server-safe).

export function PageHeader({
  section,
  title,
  meta,
  children,
}: {
  section: string;
  title: string;
  meta?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4 border-b hairline pb-4">
      <div>
        <div className="k-label mb-1">{section}</div>
        <h1 className="text-[21px] font-semibold leading-tight tracking-tight">{title}</h1>
        {meta ? <div className="mt-1 text-[12.5px] text-[--color-mut]">{meta}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </header>
  );
}

export const ACTION_LABELS: Record<string, string> = {
  comment: "Comment",
  quote_post: "Quote-post",
  x_post: "X post",
  linkedin_post: "LinkedIn post",
  forum_post: "Forum post",
  short_video: "Short video",
  dm: "DM",
  email: "Email",
  speaker_lead: "Speaker lead",
  sponsor_lead: "Sponsor lead",
  media_lead: "Media lead",
  sales_handoff: "Sales handoff",
  investigate: "Investigate",
  save: "Save",
  monitor: "Monitor",
  ignore: "Ignore",
};

const LEAD_ACTIONS = new Set(["speaker_lead", "sponsor_lead", "media_lead", "sales_handoff"]);

export function ActionTag({ action }: { action: string }) {
  const label = ACTION_LABELS[action] ?? action;
  const cls = LEAD_ACTIONS.has(action)
    ? "tag tag-ok"
    : action === "investigate" || action === "monitor"
      ? "tag tag-info"
      : action === "ignore"
        ? "tag"
        : "tag tag-signal";
  return <span className={cls}>{label}</span>;
}

/** Display names for score dimensions. The stored key
 *  `nextpredict_relevance` predates pillars and is kept stable so learned
 *  weights and score history stay valid; it MEANS pillar relevance. */
export function dimensionLabel(dimension: string): string {
  if (dimension === "nextpredict_relevance") return "pillar relevance";
  return dimension.replace(/_/g, " ");
}

export const PILLAR_LABELS: Record<string, string> = {
  prediction_markets: "prediction markets",
  igaming: "iGaming",
  strait_up_growth: "Strait Up Growth",
};

/** Pillar chip; hidden for the default pillar unless `always` (single-pillar
 *  days stay uncluttered, mixed days label everything). */
export function PillarTag({ pillar, always = false }: { pillar: string; always?: boolean }) {
  if (!always && pillar === "prediction_markets") return null;
  return <span className="tag tag-info">{PILLAR_LABELS[pillar] ?? pillar.replace(/_/g, " ")}</span>;
}

export const STATUS_LABELS: Record<string, string> = {
  observed: "observed",
  social_claim_only: "social claim only",
  reported: "reported",
  primary_source_found: "primary source",
  corroborated: "corroborated",
  verified: "verified",
  disputed: "disputed",
  contradicted: "contradicted",
  corrected: "corrected",
  superseded: "superseded",
  unable_to_verify: "unable to verify",
};

export function VerificationTag({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const cls =
    status === "corroborated" || status === "verified" || status === "primary_source_found"
      ? "tag tag-ok"
      : status === "disputed" || status === "contradicted"
        ? "tag tag-risk"
        : status === "reported"
          ? "tag tag-info"
          : "tag";
  return <span className={cls}>[{label}]</span>;
}

export function Meter({ value, inverted = false }: { value: number; inverted?: boolean }) {
  const segments = 10;
  const on = Math.round((Math.max(0, Math.min(100, value)) / 100) * segments);
  return (
    <span className={`meter w-[76px] shrink-0 ${inverted ? "inverted" : ""}`}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < on ? "on" : ""} />
      ))}
    </span>
  );
}

export function PermissionTag({ level }: { level: string }) {
  const publishable = level.startsWith("public");
  return (
    <span className={publishable ? "tag" : "tag tag-risk"}>{level.replace(/_/g, " ")}</span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="panel px-6 py-10 text-center">
      <div className="font-mono text-[13px] text-[--color-mut]">{title}</div>
      {hint ? <div className="mt-2 text-[12.5px] text-[--color-dim]">{hint}</div> : null}
    </div>
  );
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

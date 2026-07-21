// Collector contract: a collector gathers external material and returns
// ingestion drafts. Collectors NEVER write to the pipeline directly; the
// runner feeds their output through the same createIngestion path as a
// manual paste, so raw preservation, permissions, extraction, claims and
// scoring behave identically for automated and manual intel.

export interface CollectorOutput {
  title: string;
  sourceType: string;
  /** authority pillar the ingestion lands in (default prediction_markets) */
  pillar?: string;
  text: string;
  /** collector-specific note shown in logs (counts, cursors, rate info) */
  note?: string;
}

export interface CollectorAvailability {
  ok: boolean;
  reason?: string;
}

export interface Collector {
  name: string;
  description: string;
  /** cheap static check: are required credentials/config present? */
  available(): CollectorAvailability;
  /** gather material; may return zero outputs (nothing new) */
  collect(): Promise<CollectorOutput[]>;
}

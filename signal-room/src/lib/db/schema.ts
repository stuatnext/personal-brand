import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Signal Room schema. UUIDs are generated in application code
// (crypto.randomUUID) so the same migrations run on PGlite and server
// Postgres without extension requirements.
// ---------------------------------------------------------------------------

// --- Vocabulary (kept as TS unions + text columns; enforced with zod at the
// --- boundaries so adding a member never needs a migration) ----------------

export const SOURCE_TYPES = [
  "linkedin",
  "x",
  "reddit",
  "news",
  "jobs",
  "youtube",
  "market_site",
  "call_transcript",
  "internal_notes",
  "mixed",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ITEM_TYPES = [
  "original_post",
  "repost",
  "quote_post",
  "quoted_source",
  "comment",
  "reply",
  "article",
  "job_listing",
  "company_announcement",
  "market_listing",
  "video",
  "transcript_segment",
  "note",
  "platform_navigation",
  "advertisement",
  "interface_text",
  "unknown",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** item types that count as real source material (not interface noise) */
export const CONTENT_ITEM_TYPES: ReadonlySet<string> = new Set(
  ITEM_TYPES.filter(
    (t) =>
      !["platform_navigation", "advertisement", "interface_text", "unknown"].includes(t),
  ),
);

export const VERIFICATION_STATES = [
  "observed",
  "social_claim_only",
  "reported",
  "primary_source_found",
  "corroborated",
  "verified",
  "disputed",
  "contradicted",
  "corrected",
  "superseded",
  "unable_to_verify",
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const PERMISSION_LEVELS = [
  "public",
  "public_with_attribution",
  "public_without_attribution",
  "background_only",
  "private",
  "embargoed",
  "internal_only",
  "commercially_sensitive",
] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** permission levels whose content may appear in a public draft */
export const PUBLISHABLE_LEVELS: ReadonlySet<string> = new Set([
  "public",
  "public_with_attribution",
  "public_without_attribution",
]);

export const ACTIONS = [
  "comment",
  "quote_post",
  "x_post",
  "linkedin_post",
  "forum_post",
  "short_video",
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
] as const;
export type ActionType = (typeof ACTIONS)[number];

export const SCORE_DIMENSIONS = [
  "newness",
  "stuart_edge",
  "conversation_heat",
  "saturation",
  "credibility_risk",
  "relationship_value",
  "commercial_value",
  "shelf_life",
  "urgency",
  "originality",
  "evidence_quality",
  "nextpredict_relevance",
  "theme_relevance",
] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const DRAFT_TYPES = [
  "x_comment",
  "x_quote_post",
  "x_post",
  "linkedin_comment",
  "linkedin_post",
  "forum_post",
  "dm",
  "email",
  "video_script",
] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

export const FEEDBACK_DECISIONS = ["use", "wrong_angle", "save", "ignore"] as const;
export type FeedbackDecision = (typeof FEEDBACK_DECISIONS)[number];

// --- Tables -----------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("owner"),
  settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ingestions = pgTable(
  "ingestions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sourceType: text("source_type").notNull().default("mixed"),
    title: text("title").notNull(),
    // Raw input is the source of truth and is preserved verbatim.
    rawText: text("raw_text").notNull(),
    rawSha256: text("raw_sha256").notNull(),
    rawStoragePath: text("raw_storage_path"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    wordCount: integer("word_count").notNull().default(0),
    charCount: integer("char_count").notNull().default(0),
    processingStatus: text("processing_status").notNull().default("pending"), // pending|processing|complete|failed
    defaultPermissionLevel: text("default_permission_level").notNull().default("public"),
    fictional: boolean("fictional").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ingestions_user_idx").on(t.userId), index("ingestions_created_idx").on(t.createdAt)],
);

export const ingestionFiles = pgTable("ingestion_files", {
  id: uuid("id").primaryKey(),
  ingestionId: uuid("ingestion_id")
    .notNull()
    .references(() => ingestions.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  kind: text("kind").notNull().default("text"), // text|screenshot|archive|archive_member
  storagePath: text("storage_path"),
  extractedText: text("extracted_text"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StageProgress = {
  key: string;
  label: string;
  status: "pending" | "running" | "complete" | "failed" | "skipped";
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type RunStats = {
  rawWordCount?: number;
  chunkCount?: number;
  blocksDetected?: number;
  uniqueSourceItems?: number;
  duplicateItems?: number;
  noiseItems?: number;
  storyClusters?: number;
  storyThreadsContinued?: number;
  claimsNeedingVerification?: number;
  claimsTotal?: number;
  relevantPeople?: number;
  potentialLeads?: number;
  recommendations?: number;
  thesisSuggestions?: number;
  warnings?: string[];
};

export const processingRuns = pgTable(
  "processing_runs",
  {
    id: uuid("id").primaryKey(),
    ingestionId: uuid("ingestion_id")
      .notNull()
      .references(() => ingestions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"), // queued|running|complete|failed
    currentStage: text("current_stage"),
    stagesJson: jsonb("stages_json").$type<StageProgress[]>().default([]),
    statsJson: jsonb("stats_json").$type<RunStats>().default({}),
    logJson: jsonb("log_json").$type<{ at: string; level: string; message: string }[]>().default([]),
    provider: text("provider").notNull().default("mock"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("runs_ingestion_idx").on(t.ingestionId)],
);

export const sourceItems = pgTable(
  "source_items",
  {
    id: uuid("id").primaryKey(),
    ingestionId: uuid("ingestion_id")
      .notNull()
      .references(() => ingestions.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => processingRuns.id, { onDelete: "set null" }),
    platform: text("platform").notNull().default("unknown"),
    itemType: text("item_type").notNull().default("unknown"),
    authorEntityId: uuid("author_entity_id"),
    organisationEntityId: uuid("organisation_entity_id"),
    authorNameRaw: text("author_name_raw"),
    authorHandleRaw: text("author_handle_raw"),
    authorMetaRaw: text("author_meta_raw"), // headline / role line as captured
    originalText: text("original_text").notNull(),
    quotedText: text("quoted_text"),
    sourceUrl: text("source_url"),
    publishedAtText: text("published_at_text"), // as captured, e.g. "1h • Edited"
    publishedAt: timestamp("published_at", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    engagementJson: jsonb("engagement_json").$type<Record<string, number | string>>().default({}),
    topicsJson: jsonb("topics_json").$type<string[]>().default([]),
    rawStartOffset: integer("raw_start_offset").notNull().default(0),
    rawEndOffset: integer("raw_end_offset").notNull().default(0),
    extractionConfidence: real("extraction_confidence").notNull().default(0.5),
    isNoise: boolean("is_noise").notNull().default(false),
    noiseReason: text("noise_reason"),
    dedupeHash: text("dedupe_hash"),
    permissionLevel: text("permission_level").notNull().default("public"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("source_items_ingestion_idx").on(t.ingestionId),
    index("source_items_hash_idx").on(t.dedupeHash),
  ],
);

export const sourceItemRelationships = pgTable(
  "source_item_relationships",
  {
    id: uuid("id").primaryKey(),
    fromItemId: uuid("from_item_id")
      .notNull()
      .references(() => sourceItems.id, { onDelete: "cascade" }),
    toItemId: uuid("to_item_id")
      .notNull()
      .references(() => sourceItems.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(), // duplicate_of|near_duplicate_of|repost_of|quote_of|reply_to|same_story
    similarity: real("similarity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rel_from_idx").on(t.fromItemId), index("rel_to_idx").on(t.toItemId)],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull().default("person"), // person|company|platform|regulator|publication|other
    canonicalName: text("canonical_name").notNull(),
    description: text("description"),
    flagsJson: jsonb("flags_json").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entities_kind_name_idx").on(t.kind, t.canonicalName)],
);

export const entityAliases = pgTable(
  "entity_aliases",
  {
    id: uuid("id").primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("aliases_entity_idx").on(t.entityId), index("aliases_alias_idx").on(t.alias)],
);

export const entityMentions = pgTable(
  "entity_mentions",
  {
    id: uuid("id").primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => sourceItems.id, { onDelete: "cascade" }),
    mentionText: text("mention_text").notNull(),
    role: text("role").notNull().default("mentioned"), // author|organisation|subject|mentioned
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    confidence: real("confidence").notNull().default(0.6),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mentions_entity_idx").on(t.entityId),
    index("mentions_item_idx").on(t.sourceItemId),
  ],
);

// Persistent cross-day story threads. A thread accumulates the clusters
// that tell the same underlying story across ingestions, so the system can
// say "day three of this story, and here is what changed since yesterday".
export type ThreadSignature = {
  entities: string[]; // entity keys, e.g. "platform:Kalshi"
  keywords: string[]; // significant words from titles/primaries
  numbers: string[]; // distinctive figures
  claimHashes: string[]; // normalised hashes of every claim seen on the thread
};

export type ThreadObservation = {
  date: string; // YYYY-MM-DD
  ingestionId: string;
  clusterId: string;
  itemCount: number;
  newClaimCount: number;
  headline: string;
};

export const storyThreads = pgTable(
  "story_threads",
  {
    id: uuid("id").primaryKey(),
    canonicalTitle: text("canonical_title").notNull(),
    signatureJson: jsonb("signature_json").$type<ThreadSignature>().notNull(),
    observationsJson: jsonb("observations_json").$type<ThreadObservation[]>().default([]),
    observationCount: integer("observation_count").notNull().default(1),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow(),
    currentStatus: text("current_status").notNull().default("active"), // active|dormant|archived
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("threads_last_observed_idx").on(t.lastObservedAt)],
);

export const storyClusters = pgTable(
  "story_clusters",
  {
    id: uuid("id").primaryKey(),
    ingestionId: uuid("ingestion_id").references(() => ingestions.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => storyThreads.id, { onDelete: "set null" }),
    canonicalTitle: text("canonical_title").notNull(),
    workingSummary: text("working_summary"),
    topicsJson: jsonb("topics_json").$type<string[]>().default([]),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    currentStatus: text("current_status").notNull().default("active"), // active|stale|archived
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clusters_ingestion_idx").on(t.ingestionId), index("clusters_thread_idx").on(t.threadId)],
);

export const clusterItems = pgTable(
  "cluster_items",
  {
    id: uuid("id").primaryKey(),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => storyClusters.id, { onDelete: "cascade" }),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => sourceItems.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // primary|duplicate|commentary|quote|related|member
    similarity: real("similarity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cluster_items_cluster_idx").on(t.clusterId), index("cluster_items_item_idx").on(t.sourceItemId)],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey(),
    ingestionId: uuid("ingestion_id").references(() => ingestions.id, { onDelete: "cascade" }),
    storyClusterId: uuid("story_cluster_id").references(() => storyClusters.id, {
      onDelete: "set null",
    }),
    claimText: text("claim_text").notNull(),
    claimantEntityId: uuid("claimant_entity_id").references(() => entities.id),
    subjectEntityId: uuid("subject_entity_id").references(() => entities.id),
    status: text("status").notNull().default("observed"),
    confidence: real("confidence").notNull().default(0.5),
    publicationRisk: text("publication_risk").notNull().default("medium"), // low|medium|high
    permissionLevel: text("permission_level").notNull().default("public"),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("claims_cluster_idx").on(t.storyClusterId), index("claims_ingestion_idx").on(t.ingestionId)],
);

export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => sourceItems.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("supporting"), // supporting|contradicting|context
    excerpt: text("excerpt").notNull(),
    excerptStartOffset: integer("excerpt_start_offset"),
    excerptEndOffset: integer("excerpt_end_offset"),
    // Repetition is not corroboration: only independent=true rows count
    // towards verification.
    independent: boolean("independent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_claim_idx").on(t.claimId), index("evidence_item_idx").on(t.sourceItemId)],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey(),
    ingestionId: uuid("ingestion_id").references(() => ingestions.id, { onDelete: "cascade" }),
    storyClusterId: uuid("story_cluster_id")
      .notNull()
      .references(() => storyClusters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    recommendedAction: text("recommended_action").notNull().default("monitor"),
    actionAlternativesJson: jsonb("action_alternatives_json")
      .$type<{ action: string; whyNot: string }[]>()
      .default([]),
    rationale: text("rationale"),
    whyBetter: text("why_better"),
    stuartAngle: text("stuart_angle"),
    whatHappened: text("what_happened"),
    whatChanged: text("what_changed"),
    whatsNew: text("whats_new"),
    confirmedSummary: text("confirmed_summary"),
    claimedSummary: text("claimed_summary"),
    missingSummary: text("missing_summary"),
    editorialAngle: text("editorial_angle"),
    judgementChange: text("judgement_change"),
    urgency: real("urgency").notNull().default(0),
    confidence: real("confidence").notNull().default(0),
    relationshipValue: real("relationship_value").notNull().default(0),
    commercialValue: real("commercial_value").notNull().default(0),
    credibilityRisk: real("credibility_risk").notNull().default(0),
    overallScore: real("overall_score").notNull().default(0),
    status: text("status").notNull().default("proposed"), // proposed|used|saved|ignored|wrong_angle
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("opps_ingestion_idx").on(t.ingestionId),
    index("opps_cluster_idx").on(t.storyClusterId),
  ],
);

export const opportunityScores = pgTable(
  "opportunity_scores",
  {
    id: uuid("id").primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    score: real("score").notNull().default(0), // 0..100
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scores_opp_idx").on(t.opportunityId)],
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    ingestionId: uuid("ingestion_id").references(() => ingestions.id, { onDelete: "cascade" }),
    queueDate: text("queue_date").notNull(), // YYYY-MM-DD
    position: integer("position").notNull().default(0),
    primaryAction: text("primary_action").notNull(),
    status: text("status").notNull().default("open"), // open|actioned|dismissed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recs_queue_idx").on(t.queueDate), index("recs_opp_idx").on(t.opportunityId)],
);

export type VoiceLintResult = {
  errors: { rule: string; match: string; message: string }[];
  warnings: { rule: string; match: string; message: string }[];
};

export type PermissionWarning = {
  level: string;
  sourceItemId?: string;
  claimId?: string;
  match: string;
  message: string;
};

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id").references(() => recommendations.id, {
      onDelete: "set null",
    }),
    draftType: text("draft_type").notNull(),
    content: text("content").notNull(),
    stuartReaction: text("stuart_reaction"), // answer to "What is your actual reaction to this?"
    provider: text("provider").notNull().default("mock"),
    voiceLintJson: jsonb("voice_lint_json").$type<VoiceLintResult>(),
    permissionWarningsJson: jsonb("permission_warnings_json").$type<PermissionWarning[]>().default([]),
    status: text("status").notNull().default("draft"), // draft|edited|final|discarded
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("drafts_opp_idx").on(t.opportunityId)],
);

export const draftRevisions = pgTable(
  "draft_revisions",
  {
    id: uuid("id").primaryKey(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    author: text("author").notNull().default("system"), // system|stuart
    revisionNote: text("revision_note"),
    voiceLintJson: jsonb("voice_lint_json").$type<VoiceLintResult>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("revisions_draft_idx").on(t.draftId)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id").references(() => recommendations.id, {
      onDelete: "set null",
    }),
    draftId: uuid("draft_id").references(() => drafts.id, { onDelete: "set null" }),
    decision: text("decision").notNull(), // use|wrong_angle|save|ignore
    reason: text("reason"),
    editedOutput: text("edited_output"),
    timeTakenMs: integer("time_taken_ms"),
    publicationStatus: text("publication_status"), // unknown|published|scheduled|abandoned
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_opp_idx").on(t.opportunityId)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey(),
    scopeType: text("scope_type").notNull(), // ingestion|source_item|claim|evidence
    scopeId: uuid("scope_id").notNull(),
    level: text("level").notNull(),
    note: text("note"),
    setBy: text("set_by").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("permissions_scope_idx").on(t.scopeType, t.scopeId)],
);

export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey(),
    fromEntityId: uuid("from_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    toEntityId: uuid("to_entity_id").references(() => entities.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(), // works_at|posts_about|stuart_engaged_with|speaker_prospect|sponsor_prospect|media_contact|covers|operates|lists_market
    note: text("note"),
    strength: real("strength").notNull().default(0.5),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("relationships_from_idx").on(t.fromEntityId)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tags_scope_idx").on(t.scopeType, t.scopeId), index("tags_tag_idx").on(t.tag)],
);

export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: uuid("id").primaryKey(),
    venue: text("venue").notNull(), // kalshi | polymarket | …
    marketId: text("market_id").notNull(), // venue-native id/ticker
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    volume24h: real("volume_24h"),
    liquidity: real("liquidity"),
    lastPrice: real("last_price"),
    closeTime: timestamp("close_time", { withTimezone: true }),
    rawJson: jsonb("raw_json").$type<Record<string, unknown>>().default({}),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("snapshots_market_idx").on(t.venue, t.marketId),
    index("snapshots_captured_idx").on(t.capturedAt),
  ],
);

/** Per-collector persisted cursors (e.g. last published timestamp per
 *  feed) so repeated collection runs ingest only what is new. */
export const collectorCursors = pgTable(
  "collector_cursors",
  {
    id: uuid("id").primaryKey(),
    collector: text("collector").notNull(),
    key: text("key").notNull(), // e.g. the feed URL or channel id
    value: text("value").notNull(), // collector-defined (ISO timestamp, guid…)
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cursors_collector_key_idx").on(t.collector, t.key)],
);

// --- Thesis tracking (Oracle layer v1) --------------------------------------
// A thesis is a position Stuart is holding about the category. Evidence
// rows link claims to theses with a stance; the pipeline auto-suggests
// links, Stuart confirms or rejects them. Confidence is Stuart's number,
// changed by hand; the system only shows the evidence tally.

export const THESIS_STATUSES = [
  "open",
  "strengthening",
  "weakening",
  "resolved_true",
  "resolved_false",
  "parked",
] as const;

export const theses = pgTable(
  "theses",
  {
    id: uuid("id").primaryKey(),
    statement: text("statement").notNull(),
    rationale: text("rationale"),
    status: text("status").notNull().default("open"),
    confidence: real("confidence").notNull().default(50), // Stuart's own number, 0..100
    resolutionCriteria: text("resolution_criteria"),
    whatWouldChange: text("what_would_change"),
    tagsJson: jsonb("tags_json").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("theses_status_idx").on(t.status)],
);

export const thesisEvidence = pgTable(
  "thesis_evidence",
  {
    id: uuid("id").primaryKey(),
    thesisId: uuid("thesis_id")
      .notNull()
      .references(() => theses.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    stance: text("stance").notNull().default("supports"), // supports|counters|context
    state: text("state").notNull().default("suggested"), // suggested|confirmed|rejected
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("thesis_evidence_thesis_idx").on(t.thesisId),
    uniqueIndex("thesis_evidence_pair_idx").on(t.thesisId, t.claimId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    actor: text("actor").notNull().default("system"),
    action: text("action").notNull(),
    scopeType: text("scope_type"),
    scopeId: uuid("scope_id"),
    detailJson: jsonb("detail_json").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

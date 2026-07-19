CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"action" text NOT NULL,
	"scope_type" text,
	"scope_id" uuid,
	"detail_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"kind" text DEFAULT 'supporting' NOT NULL,
	"excerpt" text NOT NULL,
	"excerpt_start_offset" integer,
	"excerpt_end_offset" integer,
	"independent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ingestion_id" uuid,
	"story_cluster_id" uuid,
	"claim_text" text NOT NULL,
	"claimant_entity_id" uuid,
	"subject_entity_id" uuid,
	"status" text DEFAULT 'observed' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"publication_risk" text DEFAULT 'medium' NOT NULL,
	"permission_level" text DEFAULT 'public' NOT NULL,
	"first_observed_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cluster_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"similarity" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"content" text NOT NULL,
	"author" text DEFAULT 'system' NOT NULL,
	"revision_note" text,
	"voice_lint_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"recommendation_id" uuid,
	"draft_type" text NOT NULL,
	"content" text NOT NULL,
	"stuart_reaction" text,
	"provider" text DEFAULT 'mock' NOT NULL,
	"voice_lint_json" jsonb,
	"permission_warnings_json" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'person' NOT NULL,
	"canonical_name" text NOT NULL,
	"description" text,
	"flags_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_mentions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"mention_text" text NOT NULL,
	"role" text DEFAULT 'mentioned' NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"confidence" real DEFAULT 0.6 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"recommendation_id" uuid,
	"draft_id" uuid,
	"decision" text NOT NULL,
	"reason" text,
	"edited_output" text,
	"time_taken_ms" integer,
	"publication_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ingestion_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"storage_path" text,
	"extracted_text" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text DEFAULT 'mixed' NOT NULL,
	"title" text NOT NULL,
	"raw_text" text NOT NULL,
	"raw_sha256" text NOT NULL,
	"raw_storage_path" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"default_permission_level" text DEFAULT 'public' NOT NULL,
	"fictional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ingestion_id" uuid,
	"story_cluster_id" uuid NOT NULL,
	"title" text NOT NULL,
	"recommended_action" text DEFAULT 'monitor' NOT NULL,
	"action_alternatives_json" jsonb DEFAULT '[]'::jsonb,
	"rationale" text,
	"why_better" text,
	"stuart_angle" text,
	"what_happened" text,
	"what_changed" text,
	"whats_new" text,
	"confirmed_summary" text,
	"claimed_summary" text,
	"missing_summary" text,
	"editorial_angle" text,
	"judgement_change" text,
	"urgency" real DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"relationship_value" real DEFAULT 0 NOT NULL,
	"commercial_value" real DEFAULT 0 NOT NULL,
	"credibility_risk" real DEFAULT 0 NOT NULL,
	"overall_score" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"level" text NOT NULL,
	"note" text,
	"set_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ingestion_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"current_stage" text,
	"stages_json" jsonb DEFAULT '[]'::jsonb,
	"stats_json" jsonb DEFAULT '{}'::jsonb,
	"log_json" jsonb DEFAULT '[]'::jsonb,
	"provider" text DEFAULT 'mock' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"ingestion_id" uuid,
	"queue_date" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"primary_action" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_entity_id" uuid NOT NULL,
	"to_entity_id" uuid,
	"relationship" text NOT NULL,
	"note" text,
	"strength" real DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_item_relationships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_item_id" uuid NOT NULL,
	"to_item_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"similarity" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ingestion_id" uuid NOT NULL,
	"run_id" uuid,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"item_type" text DEFAULT 'unknown' NOT NULL,
	"author_entity_id" uuid,
	"organisation_entity_id" uuid,
	"author_name_raw" text,
	"author_handle_raw" text,
	"author_meta_raw" text,
	"original_text" text NOT NULL,
	"quoted_text" text,
	"source_url" text,
	"published_at_text" text,
	"published_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"engagement_json" jsonb DEFAULT '{}'::jsonb,
	"topics_json" jsonb DEFAULT '[]'::jsonb,
	"raw_start_offset" integer DEFAULT 0 NOT NULL,
	"raw_end_offset" integer DEFAULT 0 NOT NULL,
	"extraction_confidence" real DEFAULT 0.5 NOT NULL,
	"is_noise" boolean DEFAULT false NOT NULL,
	"noise_reason" text,
	"dedupe_hash" text,
	"permission_level" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_clusters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ingestion_id" uuid,
	"canonical_title" text NOT NULL,
	"working_summary" text,
	"topics_json" jsonb DEFAULT '[]'::jsonb,
	"first_observed_at" timestamp with time zone,
	"last_observed_at" timestamp with time zone,
	"current_status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_ingestion_id_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_story_cluster_id_story_clusters_id_fk" FOREIGN KEY ("story_cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_entity_id_entities_id_fk" FOREIGN KEY ("claimant_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_subject_entity_id_entities_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_items" ADD CONSTRAINT "cluster_items_cluster_id_story_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_items" ADD CONSTRAINT "cluster_items_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_files" ADD CONSTRAINT "ingestion_files_ingestion_id_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestions" ADD CONSTRAINT "ingestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_ingestion_id_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_story_cluster_id_story_clusters_id_fk" FOREIGN KEY ("story_cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_ingestion_id_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_ingestion_id_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_entity_id_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_entity_id_entities_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_relationships" ADD CONSTRAINT "source_item_relationships_from_item_id_source_items_id_fk" FOREIGN KEY ("from_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_relationships" ADD CONSTRAINT "source_item_relationships_to_item_id_source_items_id_fk" FOREIGN KEY ("to_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_ingestion_id_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_clusters" ADD CONSTRAINT "story_clusters_ingestion_id_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "evidence_claim_idx" ON "claim_evidence" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "evidence_item_idx" ON "claim_evidence" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "claims_cluster_idx" ON "claims" USING btree ("story_cluster_id");--> statement-breakpoint
CREATE INDEX "claims_ingestion_idx" ON "claims" USING btree ("ingestion_id");--> statement-breakpoint
CREATE INDEX "cluster_items_cluster_idx" ON "cluster_items" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "cluster_items_item_idx" ON "cluster_items" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "revisions_draft_idx" ON "draft_revisions" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "drafts_opp_idx" ON "drafts" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_kind_name_idx" ON "entities" USING btree ("kind","canonical_name");--> statement-breakpoint
CREATE INDEX "aliases_entity_idx" ON "entity_aliases" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "aliases_alias_idx" ON "entity_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "mentions_entity_idx" ON "entity_mentions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "mentions_item_idx" ON "entity_mentions" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "feedback_opp_idx" ON "feedback" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "ingestions_user_idx" ON "ingestions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ingestions_created_idx" ON "ingestions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "opps_ingestion_idx" ON "opportunities" USING btree ("ingestion_id");--> statement-breakpoint
CREATE INDEX "opps_cluster_idx" ON "opportunities" USING btree ("story_cluster_id");--> statement-breakpoint
CREATE INDEX "scores_opp_idx" ON "opportunity_scores" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "permissions_scope_idx" ON "permissions" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "runs_ingestion_idx" ON "processing_runs" USING btree ("ingestion_id");--> statement-breakpoint
CREATE INDEX "recs_queue_idx" ON "recommendations" USING btree ("queue_date");--> statement-breakpoint
CREATE INDEX "recs_opp_idx" ON "recommendations" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "relationships_from_idx" ON "relationships" USING btree ("from_entity_id");--> statement-breakpoint
CREATE INDEX "rel_from_idx" ON "source_item_relationships" USING btree ("from_item_id");--> statement-breakpoint
CREATE INDEX "rel_to_idx" ON "source_item_relationships" USING btree ("to_item_id");--> statement-breakpoint
CREATE INDEX "source_items_ingestion_idx" ON "source_items" USING btree ("ingestion_id");--> statement-breakpoint
CREATE INDEX "source_items_hash_idx" ON "source_items" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX "clusters_ingestion_idx" ON "story_clusters" USING btree ("ingestion_id");--> statement-breakpoint
CREATE INDEX "tags_scope_idx" ON "tags" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "tags_tag_idx" ON "tags" USING btree ("tag");
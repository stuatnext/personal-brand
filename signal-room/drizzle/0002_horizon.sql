CREATE TABLE "collector_cursors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collector" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"canonical_title" text NOT NULL,
	"signature_json" jsonb NOT NULL,
	"observations_json" jsonb DEFAULT '[]'::jsonb,
	"observation_count" integer DEFAULT 1 NOT NULL,
	"first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"statement" text NOT NULL,
	"rationale" text,
	"status" text DEFAULT 'open' NOT NULL,
	"confidence" real DEFAULT 50 NOT NULL,
	"resolution_criteria" text,
	"what_would_change" text,
	"tags_json" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thesis_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"stance" text DEFAULT 'supports' NOT NULL,
	"state" text DEFAULT 'suggested' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_clusters" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "thesis_evidence" ADD CONSTRAINT "thesis_evidence_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_evidence" ADD CONSTRAINT "thesis_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cursors_collector_key_idx" ON "collector_cursors" USING btree ("collector","key");--> statement-breakpoint
CREATE INDEX "threads_last_observed_idx" ON "story_threads" USING btree ("last_observed_at");--> statement-breakpoint
CREATE INDEX "theses_status_idx" ON "theses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "thesis_evidence_thesis_idx" ON "thesis_evidence" USING btree ("thesis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thesis_evidence_pair_idx" ON "thesis_evidence" USING btree ("thesis_id","claim_id");--> statement-breakpoint
ALTER TABLE "story_clusters" ADD CONSTRAINT "story_clusters_thread_id_story_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."story_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clusters_thread_idx" ON "story_clusters" USING btree ("thread_id");
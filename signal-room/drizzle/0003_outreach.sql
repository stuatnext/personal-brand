ALTER TABLE "relationships" ADD COLUMN "state" text DEFAULT 'identified' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "state_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "relationships_kind_idx" ON "relationships" USING btree ("relationship");
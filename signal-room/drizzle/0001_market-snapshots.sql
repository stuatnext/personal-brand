CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"market_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"volume_24h" real,
	"liquidity" real,
	"last_price" real,
	"close_time" timestamp with time zone,
	"raw_json" jsonb DEFAULT '{}'::jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "snapshots_market_idx" ON "market_snapshots" USING btree ("venue","market_id");--> statement-breakpoint
CREATE INDEX "snapshots_captured_idx" ON "market_snapshots" USING btree ("captured_at");
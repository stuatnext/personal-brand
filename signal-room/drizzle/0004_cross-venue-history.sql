CREATE TABLE "cross_venue_pairs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kalshi_market_id" text NOT NULL,
	"polymarket_market_id" text NOT NULL,
	"kalshi_title" text NOT NULL,
	"polymarket_title" text NOT NULL,
	"similarity" real NOT NULL,
	"observations_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observation_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cross_venue_pair_idx" ON "cross_venue_pairs" USING btree ("kalshi_market_id","polymarket_market_id");--> statement-breakpoint
CREATE INDEX "cross_venue_last_seen_idx" ON "cross_venue_pairs" USING btree ("last_seen_at");
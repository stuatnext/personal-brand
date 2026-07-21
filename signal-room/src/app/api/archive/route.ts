import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ingestions, opportunities } from "@/lib/db/schema";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const status = url.searchParams.get("status") ?? "";
  const action = url.searchParams.get("action") ?? "";
  const pillar = url.searchParams.get("pillar") ?? "";
  const database = await db();
  let rows = await database
    .select({
      opportunity: opportunities,
      ingestionTitle: ingestions.title,
      sourceType: ingestions.sourceType,
    })
    .from(opportunities)
    .innerJoin(ingestions, eq(opportunities.ingestionId, ingestions.id))
    .orderBy(desc(opportunities.createdAt))
    .limit(500);
  if (q) {
    rows = rows.filter(
      (r) =>
        r.opportunity.title.toLowerCase().includes(q) ||
        (r.opportunity.whatHappened ?? "").toLowerCase().includes(q) ||
        (r.opportunity.stuartAngle ?? "").toLowerCase().includes(q),
    );
  }
  if (status) rows = rows.filter((r) => r.opportunity.status === status);
  if (action) rows = rows.filter((r) => r.opportunity.recommendedAction === action);
  if (pillar) rows = rows.filter((r) => r.opportunity.pillar === pillar);
  return NextResponse.json({
    results: rows.slice(0, 200).map((r) => ({
      id: r.opportunity.id,
      title: r.opportunity.title,
      action: r.opportunity.recommendedAction,
      pillar: r.opportunity.pillar,
      status: r.opportunity.status,
      overallScore: r.opportunity.overallScore,
      createdAt: r.opportunity.createdAt,
      from: r.ingestionTitle,
      platform: r.sourceType,
    })),
  });
}

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { opportunities, recommendations } from "@/lib/db/schema";

/** The queued recommendations produced by this ingestion's latest run. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const rows = await database
    .select({
      recommendationId: recommendations.id,
      position: recommendations.position,
      action: recommendations.primaryAction,
      status: recommendations.status,
      opportunityId: opportunities.id,
      title: opportunities.title,
      overallScore: opportunities.overallScore,
    })
    .from(recommendations)
    .innerJoin(opportunities, eq(recommendations.opportunityId, opportunities.id))
    .where(eq(recommendations.ingestionId, id))
    .orderBy(asc(recommendations.position));
  return NextResponse.json({ queue: rows });
}

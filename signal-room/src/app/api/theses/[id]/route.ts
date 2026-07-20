import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { claims, opportunities, storyClusters, theses, thesisEvidence, THESIS_STATUSES } from "@/lib/db/schema";
import { recordConfidenceChange } from "@/lib/theses";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const [thesis] = await database.select().from(theses).where(eq(theses.id, id));
  if (!thesis) return NextResponse.json({ error: "not found" }, { status: 404 });
  const evidence = await database
    .select({
      evidence: thesisEvidence,
      claim: claims,
    })
    .from(thesisEvidence)
    .innerJoin(claims, eq(thesisEvidence.claimId, claims.id))
    .where(eq(thesisEvidence.thesisId, id))
    .orderBy(desc(thesisEvidence.createdAt));
  // link each claim's cluster to its opportunity for navigation
  const clusterIds = [...new Set(evidence.map((e) => e.claim.storyClusterId).filter(Boolean))] as string[];
  const opps = clusterIds.length
    ? await database
        .select({ id: opportunities.id, clusterId: opportunities.storyClusterId, title: opportunities.title })
        .from(opportunities)
        .innerJoin(storyClusters, eq(opportunities.storyClusterId, storyClusters.id))
    : [];
  const oppByCluster = new Map(opps.map((o) => [o.clusterId, o]));
  return NextResponse.json({
    thesis,
    evidence: evidence.map(({ evidence: e, claim }) => ({
      id: e.id,
      stance: e.stance,
      state: e.state,
      note: e.note,
      createdAt: e.createdAt,
      claim: {
        id: claim.id,
        text: claim.claimText,
        status: claim.status,
        opportunity: claim.storyClusterId ? (oppByCluster.get(claim.storyClusterId) ?? null) : null,
      },
    })),
  });
}

const putSchema = z.object({
  statement: z.string().min(10).max(500).optional(),
  rationale: z.string().max(4000).optional(),
  resolutionCriteria: z.string().max(2000).optional(),
  whatWouldChange: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(100).optional(),
  confidenceNote: z.string().max(500).optional(),
  status: z.enum(THESIS_STATUSES).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = putSchema.parse(await request.json());
    const database = await db();
    const [existing] = await database.select().from(theses).where(eq(theses.id, id));
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (body.confidence !== undefined && body.confidence !== existing.confidence) {
      await recordConfidenceChange(id, existing.confidence, body.confidence, body.confidenceNote);
    }
    await database
      .update(theses)
      .set({
        statement: body.statement ?? existing.statement,
        rationale: body.rationale ?? existing.rationale,
        resolutionCriteria: body.resolutionCriteria ?? existing.resolutionCriteria,
        whatWouldChange: body.whatWouldChange ?? existing.whatWouldChange,
        confidence: body.confidence ?? existing.confidence,
        status: body.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(theses.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

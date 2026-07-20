import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { auditLog, feedback, opportunities, recommendations, FEEDBACK_DECISIONS } from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { recordEngagement } from "@/lib/graph";

const bodySchema = z.object({
  decision: z.enum(FEEDBACK_DECISIONS),
  reason: z.string().max(4000).optional(),
  editedOutput: z.string().max(20_000).optional(),
  draftId: z.string().uuid().optional(),
  recommendationId: z.string().uuid().optional(),
  timeTakenMs: z.number().int().nonnegative().optional(),
  publicationStatus: z.string().max(50).optional(),
});

const STATUS_BY_DECISION: Record<string, string> = {
  use: "used",
  wrong_angle: "wrong_angle",
  save: "saved",
  ignore: "ignored",
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = bodySchema.parse(await request.json());
    const database = await db();
    const [opp] = await database.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.id, id));
    if (!opp) return NextResponse.json({ error: "not found" }, { status: 404 });

    const feedbackId = uid();
    await database.insert(feedback).values({
      id: feedbackId,
      opportunityId: id,
      recommendationId: body.recommendationId ?? null,
      draftId: body.draftId ?? null,
      decision: body.decision,
      reason: body.reason ?? null,
      editedOutput: body.editedOutput ?? null,
      timeTakenMs: body.timeTakenMs ?? null,
      publicationStatus: body.publicationStatus ?? "unknown",
    });
    await database
      .update(opportunities)
      .set({ status: STATUS_BY_DECISION[body.decision] })
      .where(eq(opportunities.id, id));
    await database
      .update(recommendations)
      .set({ status: body.decision === "use" ? "actioned" : "dismissed" })
      .where(eq(recommendations.opportunityId, id));
    await database.insert(auditLog).values({
      id: uid(),
      actor: "stuart",
      action: `feedback_${body.decision}`,
      scopeType: "opportunity",
      scopeId: id,
      detailJson: { feedbackId, reason: body.reason },
    });
    // graph: engagement + prospect edges accumulate from Use decisions
    await recordEngagement(id, body.decision);
    return NextResponse.json({ ok: true, feedbackId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

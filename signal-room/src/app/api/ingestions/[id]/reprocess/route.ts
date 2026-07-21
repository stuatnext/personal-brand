import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { auditLog, ingestions, PILLARS } from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { enqueueProcessing } from "@/lib/pipeline/run";

const bodySchema = z.object({ pillar: z.enum(PILLARS).optional() }).optional();

/** Reprocess an ingestion; optionally re-file it under a different pillar
 *  first (the override for a mis-tagged drop, audit-logged). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const [ingestion] = await database
    .select({ id: ingestions.id, pillar: ingestions.pillar })
    .from(ingestions)
    .where(eq(ingestions.id, id));
  if (!ingestion) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const pillar = parsed.data?.pillar;
  if (pillar && pillar !== ingestion.pillar) {
    await database.update(ingestions).set({ pillar }).where(eq(ingestions.id, id));
    await database.insert(auditLog).values({
      id: uid(),
      actor: "stuart",
      action: "pillar_override",
      scopeType: "ingestion",
      scopeId: id,
      detailJson: { from: ingestion.pillar, to: pillar },
    });
  }

  const runId = await enqueueProcessing(id);
  return NextResponse.json({ runId }, { status: 202 });
}

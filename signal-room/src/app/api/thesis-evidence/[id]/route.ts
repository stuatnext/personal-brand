import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { thesisEvidence } from "@/lib/db/schema";

const putSchema = z.object({
  state: z.enum(["suggested", "confirmed", "rejected"]).optional(),
  stance: z.enum(["supports", "counters", "context"]).optional(),
  note: z.string().max(1000).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = putSchema.parse(await request.json());
    const database = await db();
    const [existing] = await database.select().from(thesisEvidence).where(eq(thesisEvidence.id, id));
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    await database
      .update(thesisEvidence)
      .set({
        state: body.state ?? existing.state,
        stance: body.stance ?? existing.stance,
        note: body.note ?? existing.note,
      })
      .where(eq(thesisEvidence.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

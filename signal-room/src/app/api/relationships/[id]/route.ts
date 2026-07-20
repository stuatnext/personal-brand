import { NextResponse } from "next/server";
import { z } from "zod";
import { OUTREACH_STATES } from "@/lib/db/schema";
import { setOutreachState } from "@/lib/graph";

const putSchema = z.object({
  state: z.enum(OUTREACH_STATES),
  note: z.string().max(500).optional(),
});

/** Stuart records an outreach state by hand. The system never sends;
 *  this endpoint only updates the record of what he already did. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = putSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }
  try {
    const updated = await setOutreachState(id, body.data.state, body.data.note);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

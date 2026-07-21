import { NextResponse } from "next/server";
import { z } from "zod";
import { recordIntroduction } from "@/lib/graph";

const postSchema = z.object({
  introducerName: z.string().min(3).max(80),
  note: z.string().max(500).optional(),
});

/** Record who introduced this person/company to Stuart (his statement of
 *  fact; the introducer entity is found or created by name). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = postSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }
  try {
    const result = await recordIntroduction(id, body.data.introducerName, body.data.note);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

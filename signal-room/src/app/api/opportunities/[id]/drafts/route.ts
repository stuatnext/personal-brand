import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDraft } from "@/lib/drafts";
import { DRAFT_TYPES } from "@/lib/db/schema";

const bodySchema = z.object({
  draftType: z.enum(DRAFT_TYPES),
  stuartReaction: z.string().max(4000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = bodySchema.parse(await request.json());
    const result = await generateDraft(id, body.draftType, body.stuartReaction);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

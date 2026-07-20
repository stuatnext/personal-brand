import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { theses } from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { listTheses } from "@/lib/theses";

export async function GET() {
  return NextResponse.json({ theses: await listTheses() });
}

const createSchema = z.object({
  statement: z.string().min(10).max(500),
  rationale: z.string().max(4000).optional(),
  resolutionCriteria: z.string().max(2000).optional(),
  whatWouldChange: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(100).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const database = await db();
    const id = uid();
    await database.insert(theses).values({
      id,
      statement: body.statement,
      rationale: body.rationale ?? null,
      resolutionCriteria: body.resolutionCriteria ?? null,
      whatWouldChange: body.whatWouldChange ?? null,
      confidence: body.confidence ?? 50,
      tagsJson: body.tags ?? [],
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

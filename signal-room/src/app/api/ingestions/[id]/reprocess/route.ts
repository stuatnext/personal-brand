import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ingestions } from "@/lib/db/schema";
import { enqueueProcessing } from "@/lib/pipeline/run";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const [ingestion] = await database.select({ id: ingestions.id }).from(ingestions).where(eq(ingestions.id, id));
  if (!ingestion) return NextResponse.json({ error: "not found" }, { status: 404 });
  const runId = await enqueueProcessing(id);
  return NextResponse.json({ runId }, { status: 202 });
}

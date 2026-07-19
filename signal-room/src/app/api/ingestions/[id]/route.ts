import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ingestionFiles, ingestions, processingRuns } from "@/lib/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const [ingestion] = await database.select().from(ingestions).where(eq(ingestions.id, id));
  if (!ingestion) return NextResponse.json({ error: "not found" }, { status: 404 });
  const runs = await database
    .select()
    .from(processingRuns)
    .where(eq(processingRuns.ingestionId, id))
    .orderBy(desc(processingRuns.createdAt));
  const files = await database.select().from(ingestionFiles).where(eq(ingestionFiles.ingestionId, id));
  const { rawText, ...meta } = ingestion;
  return NextResponse.json({
    ingestion: { ...meta, rawPreview: rawText.slice(0, 1200), rawLength: rawText.length },
    latestRun: runs[0] ?? null,
    runs: runs.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt })),
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      kind: f.kind,
      sizeBytes: f.sizeBytes,
      note: f.note,
    })),
  });
}

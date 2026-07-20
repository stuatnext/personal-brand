import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sourceItems } from "@/lib/db/schema";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? "all";
  const database = await db();
  let rows = await database
    .select()
    .from(sourceItems)
    .where(eq(sourceItems.ingestionId, id))
    .orderBy(asc(sourceItems.rawStartOffset));
  if (filter === "content") rows = rows.filter((r) => !r.isNoise);
  if (filter === "noise") rows = rows.filter((r) => r.isNoise);
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      itemType: r.itemType,
      author: r.authorNameRaw,
      authorHandle: r.authorHandleRaw,
      authorMeta: r.authorMetaRaw,
      text: r.originalText,
      quotedText: r.quotedText,
      sourceUrl: r.sourceUrl,
      publishedAtText: r.publishedAtText,
      engagement: r.engagementJson,
      topics: r.topicsJson,
      offsets: [r.rawStartOffset, r.rawEndOffset],
      confidence: r.extractionConfidence,
      isNoise: r.isNoise,
      noiseReason: r.noiseReason,
      permissionLevel: r.permissionLevel,
    })),
  });
}

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { ingestions, PILLARS, SOURCE_TYPES } from "@/lib/db/schema";
import { createIngestion, MAX_INPUT_CHARS, type IncomingFile } from "@/lib/ingest";

export async function GET() {
  const database = await db();
  const rows = await database
    .select({
      id: ingestions.id,
      title: ingestions.title,
      sourceType: ingestions.sourceType,
      pillar: ingestions.pillar,
      wordCount: ingestions.wordCount,
      charCount: ingestions.charCount,
      processingStatus: ingestions.processingStatus,
      createdAt: ingestions.createdAt,
      fictional: ingestions.fictional,
    })
    .from(ingestions)
    .orderBy(desc(ingestions.createdAt))
    .limit(200);
  return NextResponse.json({ ingestions: rows });
}

const jsonSchema = z.object({
  title: z.string().max(300).optional(),
  sourceType: z.enum(SOURCE_TYPES),
  pillar: z.enum(PILLARS).optional(),
  text: z.string().max(MAX_INPUT_CHARS + 1000),
});

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const sourceType = String(form.get("sourceType") ?? "mixed");
      const pillarRaw = form.get("pillar") ? String(form.get("pillar")) : undefined;
      const pillar = pillarRaw && (PILLARS as readonly string[]).includes(pillarRaw) ? pillarRaw : undefined;
      const title = form.get("title") ? String(form.get("title")) : undefined;
      const text = form.get("text") ? String(form.get("text")) : undefined;
      const files: IncomingFile[] = [];
      for (const entry of form.getAll("files")) {
        if (entry instanceof File) {
          files.push({
            filename: entry.name,
            mimeType: entry.type || "application/octet-stream",
            bytes: Buffer.from(await entry.arrayBuffer()),
          });
        }
      }
      const result = await createIngestion({ title, sourceType, pillar, text, files });
      return NextResponse.json(result, { status: 201 });
    }
    const body = jsonSchema.parse(await request.json());
    const result = await createIngestion(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

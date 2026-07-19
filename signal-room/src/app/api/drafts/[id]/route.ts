import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { draftRevisions, drafts, opportunities } from "@/lib/db/schema";
import { reviseDraft } from "@/lib/drafts";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const [row] = await database
    .select({ draft: drafts, opportunityTitle: opportunities.title })
    .from(drafts)
    .innerJoin(opportunities, eq(drafts.opportunityId, opportunities.id))
    .where(eq(drafts.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const revisions = await database
    .select()
    .from(draftRevisions)
    .where(eq(draftRevisions.draftId, id))
    .orderBy(asc(draftRevisions.createdAt));
  return NextResponse.json({
    draft: row.draft,
    opportunityTitle: row.opportunityTitle,
    revisions: revisions.map((r) => ({
      id: r.id,
      author: r.author,
      revisionNote: r.revisionNote,
      createdAt: r.createdAt,
      content: r.content,
    })),
  });
}

const putSchema = z.object({
  content: z.string().max(30_000),
  revisionNote: z.string().max(500).optional(),
  status: z.enum(["draft", "edited", "final", "discarded"]).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = putSchema.parse(await request.json());
    const result = await reviseDraft(id, body.content, body.revisionNote);
    if (body.status) {
      const database = await db();
      // A draft with live permission warnings cannot be marked final.
      if (body.status === "final" && result.permissionWarnings.length > 0) {
        return NextResponse.json(
          { error: "draft cannot be finalised while permission warnings are unresolved", ...result },
          { status: 409 },
        );
      }
      await database.update(drafts).set({ status: body.status }).where(eq(drafts.id, id));
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

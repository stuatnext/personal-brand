import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { drafts, opportunities } from "@/lib/db/schema";

export async function GET() {
  const database = await db();
  const rows = await database
    .select({ draft: drafts, opportunityTitle: opportunities.title })
    .from(drafts)
    .innerJoin(opportunities, eq(drafts.opportunityId, opportunities.id))
    .orderBy(desc(drafts.createdAt))
    .limit(200);
  return NextResponse.json({
    drafts: rows.map(({ draft, opportunityTitle }) => ({
      id: draft.id,
      opportunityId: draft.opportunityId,
      opportunityTitle,
      draftType: draft.draftType,
      status: draft.status,
      provider: draft.provider,
      preview: draft.content.slice(0, 180),
      lintErrors: draft.voiceLintJson?.errors?.length ?? 0,
      lintWarnings: draft.voiceLintJson?.warnings?.length ?? 0,
      permissionWarnings: draft.permissionWarningsJson?.length ?? 0,
      createdAt: draft.createdAt,
    })),
  });
}

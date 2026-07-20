import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, queryRaw } from "@/lib/db/client";

export async function GET() {
  await db();
  const rows = await queryRaw<{
    id: string;
    kind: string;
    canonical_name: string;
    flags_json: unknown;
    mention_count: string | number;
    author_count: string | number;
  }>(
    `SELECT e.id, e.kind, e.canonical_name, e.flags_json,
            count(m.id) AS mention_count,
            count(m.id) FILTER (WHERE m.role = 'author') AS author_count
     FROM entities e
     LEFT JOIN entity_mentions m ON m.entity_id = e.id
     GROUP BY e.id, e.kind, e.canonical_name, e.flags_json
     ORDER BY count(m.id) DESC
     LIMIT 500`,
  );
  void sql;
  return NextResponse.json({
    entities: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.canonical_name,
      flags: r.flags_json ?? {},
      mentions: Number(r.mention_count),
      authored: Number(r.author_count),
    })),
  });
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getProvider } from "@/lib/ai/provider";
import { DEFAULT_WEIGHTS } from "@/lib/pipeline/score";
import { passcodeConfigured } from "@/lib/auth";
import { backendName } from "@/lib/db/client";

export async function GET() {
  const database = await db();
  const [owner] = await database.select().from(users).limit(1);
  const provider = getProvider();
  const settings = (owner?.settingsJson ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    user: owner ? { name: owner.name, email: owner.email } : null,
    provider: { name: provider.name, isReal: provider.isReal },
    database: backendName(),
    passcodeConfigured: passcodeConfigured(),
    currentThemes: (settings.currentThemes as string[]) ?? [],
    scoreWeights: (settings.scoreWeights as Record<string, number>) ?? DEFAULT_WEIGHTS,
    defaultWeights: DEFAULT_WEIGHTS,
    followUpDays: typeof settings.followUpDays === "number" ? settings.followUpDays : 5,
  });
}

const putSchema = z.object({
  currentThemes: z.array(z.string().max(60)).max(20).optional(),
  scoreWeights: z.record(z.number().min(0).max(5)).optional(),
  followUpDays: z.number().int().min(1).max(60).optional(),
});

export async function PUT(request: Request) {
  try {
    const body = putSchema.parse(await request.json());
    const database = await db();
    const [owner] = await database.select().from(users).limit(1);
    if (!owner) return NextResponse.json({ error: "no user" }, { status: 400 });
    const settings = { ...(owner.settingsJson as Record<string, unknown>) };
    if (body.currentThemes) settings.currentThemes = body.currentThemes;
    if (body.scoreWeights) settings.scoreWeights = body.scoreWeights;
    if (body.followUpDays !== undefined) settings.followUpDays = body.followUpDays;
    await database.update(users).set({ settingsJson: settings }).where(eq(users.id, owner.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

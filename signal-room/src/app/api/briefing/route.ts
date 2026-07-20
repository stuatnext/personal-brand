import { NextResponse } from "next/server";
import { getBriefing, markCaughtUp } from "@/lib/briefing";

export async function GET() {
  return NextResponse.json(await getBriefing());
}

/** POST marks the briefing caught-up point (the "I've read this" marker). */
export async function POST() {
  const at = await markCaughtUp();
  return NextResponse.json({ ok: true, at });
}

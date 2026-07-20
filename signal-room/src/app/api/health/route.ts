import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export async function GET() {
  try {
    const database = await db();
    await database.select({ id: users.id }).from(users).limit(1);
    // e2e/dev convenience: seed on boot when explicitly asked
    if (process.env.SIGNAL_ROOM_SEED_ON_BOOT === "1") {
      const g = globalThis as unknown as { __srSeeded?: Promise<void> };
      if (!g.__srSeeded) {
        const { seed } = await import("../../../../scripts/seed");
        g.__srSeeded = seed({ quiet: true });
      }
      await g.__srSeeded;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

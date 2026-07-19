import { NextResponse } from "next/server";
import { getTodayQueue } from "@/lib/queue";

/** The Today queue: at most five open recommendations, best first, with a
 *  guaranteed slot for commercial leads when any are open. */
export async function GET() {
  const queue = await getTodayQueue();
  return NextResponse.json({ queue });
}

import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/graph";

export async function GET() {
  return NextResponse.json(await getPipeline());
}

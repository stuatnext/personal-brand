import { NextResponse } from "next/server";
import { SESSION_COOKIE, expectedSessionToken, verifyPasscode } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { passcode?: string };
  const ok = await verifyPasscode(body.passcode ?? "");
  if (!ok) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }
  const token = await expectedSessionToken();
  const res = NextResponse.json({ ok: true });
  if (token) {
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}

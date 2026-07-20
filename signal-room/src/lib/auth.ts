// Single-user access control. With SIGNAL_ROOM_PASSCODE set, a login page
// issues an HttpOnly session cookie derived from the passcode; without it,
// the app runs in open LOCAL MODE and says so visibly in the UI.
// Web Crypto is used so the same code runs in middleware (edge) and node.

export const SESSION_COOKIE = "sr_session";

export function passcodeConfigured(): boolean {
  return Boolean(process.env.SIGNAL_ROOM_PASSCODE);
}

export async function expectedSessionToken(): Promise<string | null> {
  const passcode = process.env.SIGNAL_ROOM_PASSCODE;
  if (!passcode) return null;
  const data = new TextEncoder().encode(`signal-room-session-v1:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPasscode(input: string): Promise<boolean> {
  const passcode = process.env.SIGNAL_ROOM_PASSCODE;
  if (!passcode) return true;
  // constant-time-ish comparison over digests
  const a = await expectedSessionToken();
  const data = new TextEncoder().encode(`signal-room-session-v1:${input}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const b = Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

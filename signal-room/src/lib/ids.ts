import crypto from "crypto";

export function uid(): string {
  return crypto.randomUUID();
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

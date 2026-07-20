// OCR round trip on a committed fixture image. The first run in a fresh
// environment downloads the English language pack (~11MB, cached under the
// data dir) — like npm install, this test needs network once.
import fs from "fs";
import path from "path";
import os from "os";
import { describe, expect, it } from "vitest";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-ocr-"));
process.env.SIGNAL_ROOM_DATA_DIR = process.env.SIGNAL_ROOM_DATA_DIR ?? scratch;

import { ocrImage } from "@/lib/ocr";

describe("screenshot OCR", () => {
  it("recognises text in the fixture screenshot", async () => {
    const bytes = fs.readFileSync(path.join(__dirname, "../fixtures/ocr-sample.png"));
    const result = await ocrImage(bytes);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Market Surveillance Analyst");
    expect(result!.text).toContain("14 million");
    expect(result!.confidence).toBeGreaterThan(60);
  }, 240_000);

  it("returns null for an unreadable buffer instead of throwing", async () => {
    const result = await ocrImage(Buffer.from("not an image at all"));
    expect(result).toBeNull();
  }, 60_000);
});

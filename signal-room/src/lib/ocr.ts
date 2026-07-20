import path from "path";
import { dataDir } from "@/lib/db/client";

// Best-effort screenshot OCR via tesseract.js (WASM, in-process). The
// first run downloads the English language pack (~11MB) into
// SIGNAL_ROOM_DATA_DIR/ocr-cache and reuses it afterwards. OCR failure is
// never fatal: the caller falls back to storing the image for manual
// analysis, exactly the pre-OCR behaviour.

export interface OcrResult {
  text: string;
  confidence: number; // 0..100 from tesseract
}

type OcrGlobal = { __srOcrWorker?: Promise<import("tesseract.js").Worker | null> };
const g = globalThis as unknown as OcrGlobal;

async function getWorker(): Promise<import("tesseract.js").Worker | null> {
  if (!g.__srOcrWorker) {
    g.__srOcrWorker = (async () => {
      try {
        const { createWorker } = await import("tesseract.js");
        return await createWorker("eng", 1, {
          cachePath: path.join(dataDir(), "ocr-cache"),
          logger: () => {},
        });
      } catch (err) {
        console.warn(
          `[ocr] worker unavailable (${err instanceof Error ? err.message : err}); screenshots will be stored without OCR`,
        );
        return null;
      }
    })();
  }
  return g.__srOcrWorker;
}

/** Magic-byte check: tesseract's worker thread emits an unhandled error
 *  event (not just a rejection) on unreadable input, which would take the
 *  whole process down — so garbage never reaches it. */
export function isLikelyImage(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true; // PNG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true; // JPEG
  if (bytes.subarray(0, 6).toString("latin1") === "GIF87a" || bytes.subarray(0, 6).toString("latin1") === "GIF89a")
    return true; // GIF
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP")
    return true; // WEBP
  return false;
}

export async function ocrImage(bytes: Buffer): Promise<OcrResult | null> {
  if (!isLikelyImage(bytes)) {
    console.warn("[ocr] input is not a recognisable image format; skipping OCR");
    return null;
  }
  try {
    const worker = await getWorker();
    if (!worker) return null;
    const { data } = await worker.recognize(bytes);
    const text = (data.text ?? "").trim();
    if (!text) return null;
    return { text, confidence: data.confidence ?? 0 };
  } catch (err) {
    console.warn(`[ocr] recognition failed (${err instanceof Error ? err.message : err})`);
    return null;
  }
}

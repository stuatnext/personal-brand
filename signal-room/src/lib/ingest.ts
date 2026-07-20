import fs from "fs";
import path from "path";
import { unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { db, dataDir } from "@/lib/db/client";
import { ingestions, ingestionFiles, users, auditLog } from "@/lib/db/schema";
import { uid, sha256 } from "@/lib/ids";
import { defaultPermissionForSource } from "@/lib/permissions";
import { enqueueProcessing } from "@/lib/pipeline/run";
import { ocrImage } from "@/lib/ocr";

const MAX_OCR_BYTES = 8 * 1024 * 1024;

export const MAX_INPUT_CHARS = Number(process.env.SIGNAL_ROOM_MAX_INPUT_CHARS || 2_000_000);

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".jsonl", ".log"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export interface IncomingFile {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface CreateIngestionInput {
  title?: string;
  sourceType: string;
  text?: string;
  files?: IncomingFile[];
}

export interface CreateIngestionResult {
  ingestionId: string;
  runId: string;
  wordCount: number;
  fileCount: number;
  screenshotCount: number;
}

async function ownerId(): Promise<string> {
  const database = await db();
  const [owner] = await database.select({ id: users.id }).from(users).limit(1);
  if (owner) return owner.id;
  const id = uid();
  await database.insert(users).values({ id, email: "stuart@next.io", name: "Stuart Crowley", role: "owner" });
  return id;
}

function extOf(name: string): string {
  return path.extname(name).toLowerCase();
}

/** Expand a ZIP into its text members (nested dirs flattened by path). */
function expandZip(file: IncomingFile): IncomingFile[] {
  const out: IncomingFile[] = [];
  const entries = unzipSync(new Uint8Array(file.bytes));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    const ext = extOf(name);
    if (TEXT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) {
      out.push({
        filename: `${file.filename}:${name}`,
        mimeType: IMAGE_EXTENSIONS.has(ext) ? `image/${ext.slice(1)}` : "text/plain",
        bytes: Buffer.from(data),
      });
    }
  }
  return out;
}

/**
 * Create an ingestion from a paste and/or uploaded files, preserve the raw
 * input exactly (with SHA-256), and enqueue processing. Screenshots are
 * stored for manual analysis (no OCR in the MVP; clearly labelled) and do
 * not enter the text pipeline.
 */
export async function createIngestion(input: CreateIngestionInput): Promise<CreateIngestionResult> {
  const database = await db();
  const userId = await ownerId();

  const parts: string[] = [];
  const fileRecords: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    kind: string;
    storagePath?: string;
    extractedText?: string;
    note?: string;
  }[] = [];

  if (input.text && input.text.trim()) {
    parts.push(input.text);
  }

  const incoming: IncomingFile[] = [];
  for (const f of input.files ?? []) {
    if (extOf(f.filename) === ".zip") {
      fileRecords.push({
        filename: f.filename,
        mimeType: "application/zip",
        sizeBytes: f.bytes.length,
        kind: "archive",
        note: "expanded below",
      });
      incoming.push(...expandZip(f));
    } else {
      incoming.push(f);
    }
  }

  const uploadsDir = path.join(dataDir(), "uploads");
  let screenshotCount = 0;
  for (const f of incoming) {
    const ext = extOf(f.filename);
    if (IMAGE_EXTENSIONS.has(ext)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      const safeName = `${Date.now()}-${f.filename.replace(/[^\w.-]+/g, "_")}`;
      const storagePath = path.join(uploadsDir, safeName);
      fs.writeFileSync(storagePath, f.bytes);
      // Best-effort OCR: recognised text joins the pipeline, clearly marked
      // as an unverified screenshot capture; failure falls back to
      // stored-for-manual-analysis.
      const ocr = f.bytes.length <= MAX_OCR_BYTES ? await ocrImage(f.bytes) : null;
      if (ocr) {
        parts.push(
          `\n\n===== SCREENSHOT (OCR, unverified capture): ${f.filename} =====\n\nScreenshot text recognised at ${Math.round(ocr.confidence)}% confidence; treat every figure and quote as a social claim until verified against the image.\n\n${ocr.text}`,
        );
      }
      fileRecords.push({
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.bytes.length,
        kind: "screenshot",
        storagePath,
        extractedText: ocr?.text,
        note: ocr
          ? `OCR text extracted (tesseract.js, ${Math.round(ocr.confidence)}% confidence); verify against the image before quoting`
          : "stored for manual analysis; OCR unavailable or found no text",
      });
      screenshotCount += 1;
      continue;
    }
    const text = f.bytes.toString("utf8");
    fileRecords.push({
      filename: f.filename,
      mimeType: f.mimeType || "text/plain",
      sizeBytes: f.bytes.length,
      kind: "text",
      extractedText: text.length > 20_000 ? undefined : text,
    });
    parts.push(`\n\n===== FILE: ${f.filename} =====\n\n${text}`);
  }

  const rawText = parts.join("");
  if (!rawText.trim() && screenshotCount === 0) {
    throw new Error("nothing to ingest: paste text or add files");
  }
  if (rawText.length > MAX_INPUT_CHARS) {
    throw new Error(
      `input is ${rawText.length.toLocaleString()} characters; the configured maximum is ${MAX_INPUT_CHARS.toLocaleString()}. Split the paste and ingest in parts.`,
    );
  }

  const id = uid();
  const title =
    input.title?.trim() ||
    `${input.sourceType} paste, ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  await database.insert(ingestions).values({
    id,
    userId,
    sourceType: input.sourceType,
    title,
    rawText,
    rawSha256: sha256(rawText),
    wordCount: rawText.split(/\s+/).filter(Boolean).length,
    charCount: rawText.length,
    processingStatus: "pending",
    defaultPermissionLevel: defaultPermissionForSource(input.sourceType),
  });
  for (const fr of fileRecords) {
    await database.insert(ingestionFiles).values({
      id: uid(),
      ingestionId: id,
      filename: fr.filename,
      mimeType: fr.mimeType,
      sizeBytes: fr.sizeBytes,
      kind: fr.kind,
      storagePath: fr.storagePath ?? null,
      extractedText: fr.extractedText ?? null,
      note: fr.note ?? null,
    });
  }
  await database.insert(auditLog).values({
    id: uid(),
    actor: "stuart",
    action: "create_ingestion",
    scopeType: "ingestion",
    scopeId: id,
    detailJson: { sourceType: input.sourceType, chars: rawText.length, files: fileRecords.length },
  });

  const runId = await enqueueProcessing(id);
  const [row] = await database
    .select({ wordCount: ingestions.wordCount })
    .from(ingestions)
    .where(eq(ingestions.id, id));
  return {
    ingestionId: id,
    runId,
    wordCount: row?.wordCount ?? 0,
    fileCount: fileRecords.length,
    screenshotCount,
  };
}

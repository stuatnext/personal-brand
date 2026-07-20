import type { Chunk } from "./types";

export interface ChunkOptions {
  /** target chunk size in characters */
  targetSize?: number;
  /** hard maximum chunk size */
  maxSize?: number;
  /** overlap carried into the next chunk, in characters */
  overlap?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetSize: 12_000,
  maxSize: 16_000,
  overlap: 800,
};

/**
 * Deterministic chunking for very large inputs. Prefers to cut on blank
 * lines, then on line breaks, only cutting mid-line at maxSize. Overlap is
 * carried so items spanning a boundary appear whole in at least one chunk;
 * downstream reconciliation dedupes by offset overlap.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const { targetSize, maxSize, overlap } = { ...DEFAULTS, ...opts };
  if (text.length === 0) return [];
  if (text.length <= maxSize) {
    return [{ index: 0, startOffset: 0, endOffset: text.length, text }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + targetSize, text.length);
    if (end < text.length) {
      // hunt forwards to a blank line within [target, max]
      const hardEnd = Math.min(start + maxSize, text.length);
      const window = text.slice(end, hardEnd);
      const blank = window.indexOf("\n\n");
      if (blank !== -1) {
        end = end + blank + 2;
      } else {
        const nl = window.indexOf("\n");
        end = nl !== -1 ? end + nl + 1 : hardEnd;
      }
    }
    chunks.push({ index, startOffset: start, endOffset: end, text: text.slice(start, end) });
    if (end >= text.length) break;
    index += 1;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/**
 * Merge per-chunk extractions back into one list: items whose raw-offset
 * spans overlap by more than 60% (from the overlap zone) are the same item;
 * keep the longer capture.
 */
export function reconcileChunkItems<T extends { rawStartOffset: number; rawEndOffset: number }>(
  items: T[],
): T[] {
  const sorted = [...items].sort((a, b) => a.rawStartOffset - b.rawStartOffset);
  const out: T[] = [];
  for (const item of sorted) {
    const prev = out[out.length - 1];
    if (prev) {
      const overlapStart = Math.max(prev.rawStartOffset, item.rawStartOffset);
      const overlapEnd = Math.min(prev.rawEndOffset, item.rawEndOffset);
      const overlapLen = Math.max(0, overlapEnd - overlapStart);
      const shorter = Math.min(
        prev.rawEndOffset - prev.rawStartOffset,
        item.rawEndOffset - item.rawStartOffset,
      );
      if (shorter > 0 && overlapLen / shorter > 0.6) {
        // same underlying item captured twice across a boundary: keep longer
        if (item.rawEndOffset - item.rawStartOffset > prev.rawEndOffset - prev.rawStartOffset) {
          out[out.length - 1] = item;
        }
        continue;
      }
    }
    out.push(item);
  }
  return out;
}

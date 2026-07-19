import fs from "fs";
import path from "path";
import { segment } from "../src/lib/pipeline/segment";
import { detectDuplicates } from "../src/lib/pipeline/dedupe";
import { extractEntities } from "../src/lib/pipeline/entities";
import { buildClusters } from "../src/lib/pipeline/cluster";

const file = process.argv[2] ?? "fixtures/linkedin-capture-2026-07-16.txt";
const source = (process.argv[3] ?? "linkedin") as never;
const raw = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
const items = segment(raw, source);
console.log(`items: ${items.length} (noise: ${items.filter((i) => i.isNoise).length})`);
for (const i of items) {
  console.log(
    `- [${i.itemType}${i.isNoise ? "/NOISE" : ""}] ${i.authorName ?? "?"} conf=${i.extractionConfidence} :: ${i.originalText.replace(/\s+/g, " ").slice(0, 80)}`,
  );
}
const dupes = detectDuplicates(items);
console.log(`\nduplicates: ${dupes.duplicateOf.size}`);
for (const [dup, info] of dupes.duplicateOf) {
  const d = items.find((i) => i.tempId === dup)!;
  const c = items.find((i) => i.tempId === info.canonical)!;
  console.log(`- ${d.authorName} -> ${c.authorName} (${info.kind}, ${info.similarity.toFixed(2)})`);
}
const mentions = extractEntities(items);
const clusters = buildClusters(items, dupes, mentions);
console.log(`\nclusters: ${clusters.length}`);
for (const c of clusters.filter((c) => c.memberTempIds.length > 1)) {
  console.log(`- [${c.memberTempIds.length} items] ${c.canonicalTitle}`);
  for (const id of c.memberTempIds) {
    const it = items.find((i) => i.tempId === id)!;
    console.log(`    · ${it.authorName}: ${it.originalText.replace(/\s+/g, " ").slice(0, 60)}`);
  }
}

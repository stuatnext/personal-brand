import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { collectorCursors } from "@/lib/db/schema";
import { uid } from "@/lib/ids";

/** Persisted per-collector cursor (e.g. newest published timestamp per
 *  feed) so repeated runs only ingest what is new. */
export async function getCursor(collector: string, key: string): Promise<string | null> {
  const database = await db();
  const [row] = await database
    .select({ value: collectorCursors.value })
    .from(collectorCursors)
    .where(and(eq(collectorCursors.collector, collector), eq(collectorCursors.key, key)));
  return row?.value ?? null;
}

export async function setCursor(collector: string, key: string, value: string): Promise<void> {
  const database = await db();
  const [existing] = await database
    .select({ id: collectorCursors.id })
    .from(collectorCursors)
    .where(and(eq(collectorCursors.collector, collector), eq(collectorCursors.key, key)));
  if (existing) {
    await database
      .update(collectorCursors)
      .set({ value, updatedAt: new Date() })
      .where(eq(collectorCursors.id, existing.id));
  } else {
    await database.insert(collectorCursors).values({ id: uid(), collector, key, value });
  }
}

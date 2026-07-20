import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

// One database module, two backends:
//  - DATABASE_URL set        -> server PostgreSQL (Supabase-compatible)
//  - DATABASE_URL unset      -> embedded PGlite (PostgreSQL-in-process) at
//                               SIGNAL_ROOM_DATA_DIR/pglite
// The Drizzle schema and migrations are identical for both.

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

export function dataDir(): string {
  return path.resolve(process.cwd(), process.env.SIGNAL_ROOM_DATA_DIR || ".data");
}

type DbGlobal = {
  __signalRoomDb?: Db;
  __signalRoomPglite?: PGlite;
  __signalRoomPool?: Pool;
  __signalRoomDbReady?: Promise<void>;
};
const g = globalThis as unknown as DbGlobal;

export function backendName(): "pglite" | "postgres" {
  return process.env.DATABASE_URL ? "postgres" : "pglite";
}

/**
 * Get the process-wide database handle. PGlite is single-connection, so a
 * singleton (surviving Next.js HMR via globalThis) is required, not a nicety.
 */
export function getDb(): Db {
  if (g.__signalRoomDb) return g.__signalRoomDb;

  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    g.__signalRoomPool = pool;
    g.__signalRoomDb = drizzlePg(pool, { schema });
  } else {
    const dir = path.join(dataDir(), "pglite");
    fs.mkdirSync(dir, { recursive: true });
    const pglite = new PGlite(dir);
    g.__signalRoomPglite = pglite;
    g.__signalRoomDb = drizzlePglite(pglite, { schema });
  }
  return g.__signalRoomDb;
}

/** Run raw SQL (used by the migration runner). */
export async function execRaw(sql: string): Promise<void> {
  if (process.env.DATABASE_URL) {
    getDb();
    await g.__signalRoomPool!.query(sql);
  } else {
    getDb();
    await g.__signalRoomPglite!.exec(sql);
  }
}

export async function queryRaw<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (process.env.DATABASE_URL) {
    getDb();
    const res = await g.__signalRoomPool!.query(sql, params as any[]);
    return res.rows as T[];
  } else {
    getDb();
    const res = await g.__signalRoomPglite!.query<T>(sql, params as any[]);
    return res.rows;
  }
}

/**
 * Apply pending migrations from drizzle/*.sql exactly once per process.
 * Safe to call from any route; concurrent calls share one promise.
 */
export async function ensureMigrated(): Promise<void> {
  if (!g.__signalRoomDbReady) {
    g.__signalRoomDbReady = (async () => {
      const migrationsDir = path.resolve(process.cwd(), "drizzle");
      await execRaw(
        `CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
      );
      const applied = new Set(
        (await queryRaw<{ name: string }>(`SELECT name FROM _migrations`)).map((r) => r.name),
      );
      const files = fs.existsSync(migrationsDir)
        ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
        : [];
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        // drizzle-kit uses "--> statement-breakpoint" between statements.
        for (const stmt of sql.split("--> statement-breakpoint")) {
          const trimmed = stmt.trim();
          if (trimmed) await execRaw(trimmed);
        }
        await queryRaw(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
      }
    })();
  }
  return g.__signalRoomDbReady;
}

/** Convenience: migrated db handle for route handlers. */
export async function db(): Promise<Db> {
  await ensureMigrated();
  return getDb();
}

export { schema };

import { ensureMigrated, backendName, queryRaw } from "../src/lib/db/client";

async function main() {
  console.log(`[migrate] backend: ${backendName()}`);
  await ensureMigrated();
  const rows = await queryRaw<{ name: string }>(`SELECT name FROM _migrations ORDER BY name`);
  console.log(`[migrate] applied migrations: ${rows.map((r) => r.name).join(", ") || "(none)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});

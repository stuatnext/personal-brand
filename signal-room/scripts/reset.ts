import fs from "fs";
import path from "path";
import { dataDir, backendName } from "../src/lib/db/client";

// Local convenience only: wipes the embedded PGlite directory so the next
// migrate/seed starts clean. Refuses to touch a server database.
async function main() {
  if (backendName() === "postgres") {
    console.error(
      "[reset] DATABASE_URL is set. Refusing to drop a server database; do that deliberately with psql.",
    );
    process.exit(1);
  }
  const dir = path.join(dataDir(), "pglite");
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
    console.log(`[reset] removed ${dir}`);
  } else {
    console.log(`[reset] nothing to remove at ${dir}`);
  }
}

main();

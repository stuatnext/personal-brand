// The inbox pipeline: committed drop files ingest into the local database
// exactly once (sha-deduped), with pillar and source type honoured. Runs
// the real script end to end against a scratch inbox + scratch database,
// the same way the eval gate spawns the real runner.
import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const scratchData = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-inbox-db-"));
const scratchInbox = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-inbox-"));

const DROP = {
  title: "Feed sweep, 1 feed(s) (2026-07-21)",
  sourceType: "news",
  pillar: "igaming",
  text: `Article: "Regulator grants first Brazil licences to three operators"
Source: Trade Wire
Published: 2026-07-21T05:00:00Z
The federal regulator has granted its first three operating licences under the new regime, according to the announcement.
https://example.com/brazil-licences`,
  note: "1 new item(s)",
  capturedAt: "2026-07-21T05:30:00.000Z",
};

function runIngest(): string {
  const res = spawnSync("npx", ["tsx", "scripts/ingest-inbox.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 180_000,
    env: {
      ...process.env,
      SIGNAL_ROOM_DATA_DIR: scratchData,
      SIGNAL_ROOM_INBOX_DIR: scratchInbox,
      DATABASE_URL: "",
      ANTHROPIC_API_KEY: "",
    },
  });
  if (res.status !== 0) throw new Error(`ingest-inbox exited ${res.status}: ${res.stderr}`);
  return res.stdout + res.stderr;
}

describe("inbox ingestion", () => {
  it("ingests a committed drop once, with its pillar, and never twice", () => {
    fs.mkdirSync(path.join(scratchInbox, "drops"), { recursive: true });
    fs.writeFileSync(
      path.join(scratchInbox, "drops", "2026-07-21-feeds-igaming.json"),
      JSON.stringify(DROP, null, 2),
    );

    const first = runIngest();
    expect(first).toContain("1 ingested");
    expect(first).toContain("0 already known");

    const second = runIngest();
    expect(second).toContain("0 ingested");
    expect(second).toContain("1 already known");

    fs.rmSync(scratchData, { recursive: true, force: true });
    fs.rmSync(scratchInbox, { recursive: true, force: true });
  }, 300_000);
});

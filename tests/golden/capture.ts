// Writes golden snapshots for NI-1042, NEX-5, NEX-6 and NEX-7.
// Refuses to overwrite an existing snapshot: a snapshot is never updated to
// make a test pass. Delete a file by hand only if the frozen engine itself was
// deliberately changed with the owner's sign-off.
//
// Usage: npx tsx tests/golden/capture.ts
import fs from "node:fs";
import path from "node:path";
import { computeGolden, GOLDEN_CASES, snapshotDir } from "./cases.ts";

async function main() {
  fs.mkdirSync(snapshotDir, { recursive: true });
  for (const id of GOLDEN_CASES) {
    const file = path.join(snapshotDir, `${id}.json`);
    if (fs.existsSync(file)) {
      console.log(`skip ${id}: snapshot exists and is never overwritten`);
      continue;
    }
    fs.writeFileSync(file, `${JSON.stringify(await computeGolden(id), null, 2)}\n`);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

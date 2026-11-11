import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { computeGolden, GOLDEN_CASES, snapshotDir } from "./golden/cases.ts";

// Frozen-engine guard. Each case replays recorded measurement inputs through the
// unchanged rules and must equal the snapshot captured before any connector work.
for (const id of GOLDEN_CASES) {
  test(`golden snapshot ${id} is unchanged`, async () => {
    const file = path.join(snapshotDir, `${id}.json`);
    assert.ok(fs.existsSync(file), `Missing golden snapshot ${file}. Capture it from the pre-change engine.`);
    const expected = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepStrictEqual(await computeGolden(id), expected);
  });
}

test("golden outcomes are the documented ones", () => {
  const read = (id: string) => JSON.parse(fs.readFileSync(path.join(snapshotDir, `${id}.json`), "utf8"));
  assert.equal(read("NI-1042").diagnosis.outcome, "lock_contention");
  assert.equal(read("NEX-5").diagnosis.outcome, "lock_contention");
  assert.equal(read("NEX-6").diagnosis.outcome, "service_unavailable");
  assert.equal(read("NEX-6").view.abstain, true);
  assert.equal(read("NEX-7").measureService.skipped, true);
  assert.equal(read("NEX-7").measureService.run, null);
});

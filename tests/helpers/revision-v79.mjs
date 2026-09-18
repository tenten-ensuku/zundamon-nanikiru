import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const revisionV79 = JSON.parse(readFileSync(new URL("../../data/content-corrections-v79.json", import.meta.url), "utf8"));
const changes = new Map(revisionV79.changes.map(item => [item.id, item]));

// Historical comparisons undo only the explicitly approved v79 fields. Existing
// keys keep their order so older byte-order-sensitive JSON hashes remain useful.
// All other fields still flow into the old preservation tests unchanged.
export function beforeV79(question) {
  const result = structuredClone(question), change = changes.get(question.id);
  if (!change) return result;
  assert.ok(change.beforeBase && typeof change.beforeBase === "object", `v79 baseline ${question.id}`);
  for (const [key, after] of Object.entries(change.patch)) {
    assert.deepEqual(question[key], after, `v79 correction ${question.id}.${key}`);
    if (Object.hasOwn(change.beforeBase, key)) result[key] = structuredClone(change.beforeBase[key]);
    else delete result[key];
  }
  return result;
}

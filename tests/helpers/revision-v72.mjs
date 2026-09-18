import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeV73 } from "./revision-v73.mjs";

export const revisionV72 = JSON.parse(readFileSync(new URL("../../data/question-corrections-v72.json", import.meta.url), "utf8"));
const changes = new Map(revisionV72.changes.map(item => [item.id, item]));

// Historical ledgers stay immutable. Reverse only the explicitly audited v72
// fields after reversing later approved edits, and assert each historical fix.
export function beforeV72(question) {
  const result = beforeV73(question);
  for (const [key, change] of Object.entries(changes.get(question.id)?.fields || {})) {
    assert.deepEqual(result[key], change.after, `v72 correction ${question.id}.${key}`);
    if (change.before.present) result[key] = structuredClone(change.before.value);
    else delete result[key];
  }
  return result;
}

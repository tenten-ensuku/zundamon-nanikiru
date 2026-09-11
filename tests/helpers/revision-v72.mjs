import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const revisionV72 = JSON.parse(readFileSync(new URL("../../data/question-corrections-v72.json", import.meta.url), "utf8"));
const changes = new Map(revisionV72.changes.map(item => [item.id, item]));

// Historical ledgers stay immutable. Reverse only the explicitly audited v72
// fields, while also asserting that the current release contains each fix.
export function beforeV72(question) {
  const result = structuredClone(question);
  for (const [key, change] of Object.entries(changes.get(question.id)?.fields || {})) {
    assert.deepEqual(question[key], change.after, `v72 correction ${question.id}.${key}`);
    if (change.before.present) result[key] = structuredClone(change.before.value);
    else delete result[key];
  }
  return result;
}

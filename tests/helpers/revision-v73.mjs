import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeV77 } from './revision-v77.mjs';
export const revisionV73 = JSON.parse(readFileSync(new URL("../../data/difficulty-classification-v73.json", import.meta.url), "utf8"));
const entries = new Map(revisionV73.entries.map(item => [item.id, item]));
export function beforeV73(question) {
  const result = beforeV77(question);
  const entry = entries.get(question.id);
  if (entry) { assert.equal(result.difficulty, entry.difficulty, `v73 classification ${question.id}`); delete result.difficulty; }
  return result;
}

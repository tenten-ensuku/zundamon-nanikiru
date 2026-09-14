import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const revisionV77 = JSON.parse(readFileSync(new URL('../../data/difficulty-classification-v77.json', import.meta.url), 'utf8'));
const entries = new Map(revisionV77.entries.map(entry => [entry.id, entry]));
export function beforeV77(question) {
  const result = structuredClone(question), entry = entries.get(question.id);
  if (entry) {
    assert.equal(result.difficulty, entry.difficulty, `v77 classification ${question.id}`);
    result.difficulty = entry.beforeBaseDifficulty;
  }
  return result;
}

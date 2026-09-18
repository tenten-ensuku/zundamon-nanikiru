import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { beforeV79, revisionV79 } from "./helpers/revision-v79.mjs";

const questions = JSON.parse(await readFile(new URL("../public/questions.json", import.meta.url), "utf8"));

test("v79 history rollback restores only approved keys without hiding unrelated changes or mutating current data", () => {
  for (const change of revisionV79.changes) {
    const current = questions.find(q => q.id === change.id), unchanged = structuredClone(current);
    const historical = beforeV79(current);
    for (const key of Object.keys(change.patch)) {
      assert.equal(Object.hasOwn(historical, key), Object.hasOwn(change.beforeBase, key), `${change.id}.${key} presence`);
      assert.deepEqual(historical[key], change.beforeBase[key], `${change.id}.${key} value`);
    }
    for (const [key, value] of Object.entries(current)) {
      if (!Object.hasOwn(change.patch, key)) assert.deepEqual(historical[key], value, `${change.id}.${key} protected`);
    }
    assert.deepEqual(current, unchanged);
    assert.equal(beforeV79({ ...current, unexplainedChange: "must still fail older preservation checks" }).unexplainedChange, "must still fail older preservation checks");
  }
});

test("v79 history rollback cannot silently conceal a regressed approved correction", () => {
  const change = revisionV79.changes[0], current = questions.find(q => q.id === change.id);
  const key = Object.keys(change.patch)[0];
  assert.throws(() => beforeV79({ ...current, [key]: "unexpected-value" }), /v79 correction/);
});

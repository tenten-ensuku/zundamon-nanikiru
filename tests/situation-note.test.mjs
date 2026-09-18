import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
const functions = ["formatSituationNote", "isExplanationTileBoundary"]
  .map(name => source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name)).join("\n");
const format = new Function(`${functions}; return formatSituationNote;`)();

test("situation notes display South without changing stored tile codes", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../public/shared-overrides.json", import.meta.url), "utf8"));
  for (const [id, expected] of [[41, "南は安全牌と想定する。"], [42, "南は3枚切れで安全牌と想定する。"]]) {
    const question = snapshot.rows.find(q => q.id === id);
    const before = JSON.stringify(question);
    assert.equal(format(question.note), expected);
    assert.equal(JSON.stringify(question), before);
  }
  assert.match(source, /situationNote\.textContent = formatSituationNote\(question\.note\)/);
});

test("South notation accepts fullwidth and uppercase while preserving other text", () => {
  assert.equal(format("2z・2Z・２ｚ・２Ｚ・2ｚ・２z"), "南・南・南・南・南・南");
  const unchanged = "南＝1枚切れ　北＝生牌 6sをチー 12z x2z 2za ２z９ https://youtu.be/2zS7ogdnDXM https://example.com/2z?tile=2z";
  assert.equal(format(unchanged), unchanged);
  for (const value of [null, undefined, 42, {}]) assert.equal(format(value), "");
});

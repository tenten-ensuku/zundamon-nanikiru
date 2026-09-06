import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";

const questions = JSON.parse(await readFile(new URL("../public/questions.json", import.meta.url), "utf8"));
const calibration = JSON.parse(await readFile(new URL("../calibration/zundamon-nanikiru-v1/verified-questions.json", import.meta.url), "utf8"));
const preservation = JSON.parse(await readFile(new URL("../data/author-preservation-v61.json", import.meta.url), "utf8"));
const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
const gradeSource = source.match(/    function gradeAnswer\([^]*?\n    }/)[0];
const grade = new Function(`${gradeSource}; return gradeAnswer;`)();
const byId = id => questions.find(q => q.id === id);

test("release preserves all author text hashes, including shared edits and deliberate blanks", () => {
  assert.equal(preservation.authors.length, 167);
  for (const expected of preservation.authors) assert.equal(createHash("sha256").update(byId(expected.id).explanation).digest("hex"), expected.sha256, `author ${expected.id}`);
  assert.equal(byId(61).explanation, "");
  assert.match(byId(169).explanation, /打2m/);
});

test("all user-approved image calibrations agree, including red fives and called tiles", () => {
  for (const [id, expected] of Object.entries(calibration.questions)) {
    const q = byId(Number(id));
    assert.deepEqual([...q.hand, ...(q.draw ? [q.draw] : [])].sort(), [...expected.hand].sort(), `hand ${id}`);
    assert.equal(q.dora, expected.dora, `dora ${id}`);
    assert.deepEqual(q.melds, expected.melds, `melds ${id}`);
  }
  assert.equal(byId(139).draw, "5m");
  assert.equal(byId(140).draw, "5p");
  assert.deepEqual(byId(76).correctDiscards, ["3m"]);
  assert.deepEqual(byId(144).correctDiscards, ["2m"]);
  assert.equal(byId(94).turn, 8);
  assert.deepEqual(byId(29).correctDiscards, ["1p"]);
  assert.deepEqual(byId(29).videoCorrectDiscards, ["2m"]);
});

test("kan-only answers are graded and non-kan or incorrect riichi answers are rejected", () => {
  assert.deepEqual(grade(byId(79), { choice: "kan", tile: null }), { graded: true, correct: true });
  assert.deepEqual(grade(byId(79), { tile: "6p" }), { graded: true, correct: false });
  assert.deepEqual(grade(byId(78), { choice: "kan" }), { graded: true, correct: false });
  assert.deepEqual(grade(byId(78), { tile: "2p" }), { graded: true, correct: true });
  assert.deepEqual(grade(byId(136), { tile: "9s", riichi: true }), { graded: true, correct: true });
  assert.deepEqual(grade(byId(136), { tile: "9s", riichi: false }), { graded: true, correct: false });
  assert.deepEqual(grade(byId(165), { tile: "9s" }), { graded: false, correct: null });
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createAppServer } from "../server.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const admin = await readFile(new URL("../admin.html", import.meta.url), "utf8");
const extract = (source, name) => source.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name);
const grade = new Function(`${extract(html, "gradeAnswer")}; return gradeAnswer;`)();
const settings = new Function(`${extract(admin, "readRiichiSettings")}; return readRiichiSettings;`)();
const summary = new Function(`const tileName = code => code; ${extract(admin, "adminAnswerText")}; return adminAnswerText;`)();
const fixture = {
  id: 1, hand: ["1m", "2m", "3m", "4p", "0p", "5s", "6s", "7s", "1z", "1z", "2z", "3z", "4z"],
  draw: "5z", dora: "2m", melds: [], difficulty: "beginner", explanation: "作者の文章", videoExplanation: "動画の文章",
  correctDiscards: ["5z"], riichiChoice: true, correctRiichi: false,
};

test("a riichi answer is correct only when both the discard and the decision match", () => {
  for (const correctRiichi of [true, false]) {
    const question = { ...fixture, correctRiichi };
    for (const tile of ["5z", "4z"]) for (const riichi of [true, false]) {
      assert.deepEqual(grade(question, { tile, riichi }), { graded: true, correct: tile === "5z" && riichi === correctRiichi });
    }
    for (const riichi of [null, undefined, "true", "false"]) {
      assert.deepEqual(grade(question, { tile: "5z", riichi }), { graded: false, correct: null });
    }
  }
  assert.deepEqual(grade({ ...fixture, riichiChoice: false }, { tile: "5z" }), { graded: true, correct: true });
});

test("an unconfirmed riichi key never silently grants a correct tile-only score", () => {
  for (const correctRiichi of [null, undefined]) for (const riichi of [true, false]) {
    assert.deepEqual(grade({ ...fixture, correctRiichi }, { tile: "5z", riichi }), { graded: false, correct: null });
  }
  assert.deepEqual(grade({ ...fixture, correctRiichi: null, correctKan: true }, { choice: "kan" }), { graded: true, correct: true });
  assert.match(extract(html, "renderReview"), /採点保留/);
});

test("confirming without a riichi/dama choice cannot record an answer", () => {
  const run = new Function("question", `const playQuestions = [question], currentIndex = 0;
    let selectedIndex = 0, specialChoice = null, riichiSelected = null, revealed = false;
    const state = { responses: {}, session: { responses: {}, answeredIds: [] } };
    ${extract(html, "confirmSelection")}
    confirmSelection(); return state;`);
  assert.deepEqual(run(fixture), { responses: {}, session: { responses: {}, answeredIds: [] } });
});

test("admin can explicitly enable and disable riichi decisions and requires an answer when enabled", () => {
  assert.deepEqual(settings(true, "true"), { riichiChoice: true, correctRiichi: true });
  assert.deepEqual(settings(true, "false"), { riichiChoice: true, correctRiichi: false });
  for (const value of ["", null, undefined, "unknown"]) assert.throws(() => settings(true, value), /正解/);
  assert.deepEqual(settings(false, "true"), { riichiChoice: false, correctRiichi: null });
  assert.match(admin, /class="riichi-choice" type="checkbox"/);
  assert.match(extract(admin, "renderEditor"), /Object\.assign\(draft, readRiichiSettings\(riichiChoiceInput\.checked, riichiAnswerInput\.value\)\)/);
  assert.equal(summary(fixture), "5z・ダマ");
  assert.equal(summary({ ...fixture, correctRiichi: true }), "5z・リーチ");
  assert.equal(summary({ ...fixture, correctRiichi: null }), "5z・リーチ判断未設定");
});

test("admin decision fields follow the checkbox and restore from persisted values", () => {
  const nodes = {};
  const editor = { querySelector(selector) { return nodes[selector] ||= { addEventListener(event, handler) { this[event] = handler; } }; } };
  const start = admin.indexOf('      const kanAnswerInput = editor.querySelector(".kan-answer");');
  const end = admin.indexOf("      restoreDecisionInputs();", start) + "      restoreDecisionInputs();".length;
  const draft = { ...fixture };
  const restore = new Function("editor", "draft", `${admin.slice(start, end)}; return restoreDecisionInputs;`)(editor, draft);
  assert.equal(nodes[".riichi-choice"].checked, true);
  assert.equal(nodes[".riichi-answer"].value, "false");
  assert.equal(nodes[".riichi-answer-field"].hidden, false);
  nodes[".riichi-choice"].checked = false;
  nodes[".riichi-choice"].change();
  assert.equal(nodes[".riichi-answer-field"].hidden, true);
  assert.equal(nodes[".riichi-answer"].disabled, true);
  Object.assign(draft, { riichiChoice: true, correctRiichi: true });
  restore();
  assert.equal(nodes[".riichi-choice"].checked, true);
  assert.equal(nodes[".riichi-answer-field"].hidden, false);
  assert.equal(nodes[".riichi-answer"].disabled, false);
  assert.equal(nodes[".riichi-answer"].value, "true");
});

test("local full-question saves retain explicit disabling instead of reviving the bundled riichi flag", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zundamon-riichi-"));
  const basePath = path.join(dir, "questions.json"), overridesPath = path.join(dir, "overrides.json");
  await writeFile(basePath, JSON.stringify([fixture]));
  await writeFile(overridesPath, "{}");
  const { server } = createAppServer({ basePath, overridesPath, editMode: "open", port: 0 });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    let current = fixture;
    for (const [enabled, choice] of [[false, ""], [true, "true"], [true, "false"], [false, ""]]) {
      const question = { ...current, ...settings(enabled, choice) };
      const response = await fetch(`${origin}/api/admin/questions/1`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, expectedUpdatedAt: current.overrideUpdatedAt || null }),
      });
      assert.equal(response.status, 200);
      current = (await fetch(`${origin}/api/questions`).then(r => r.json()))[0];
      assert.equal(current.riichiChoice, enabled);
      assert.equal(current.correctRiichi, enabled ? choice === "true" : null);
      for (const field of ["hand", "draw", "dora", "explanation", "videoExplanation", "correctDiscards"]) assert.deepEqual(current[field], fixture[field]);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});

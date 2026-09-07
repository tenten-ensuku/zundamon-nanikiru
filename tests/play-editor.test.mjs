import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import os from "node:os";
import { createAppServer } from "../server.mjs";
import { resolveEditMode, editAccess } from "../supabase/functions/zundamon-question-admin/edit-policy.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const extract = name => html.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name);
const fixture = { id: 1, hand: ["1m", "2m", "3m", "4p", "0p", "5s", "6s", "7s", "1z", "1z", "2z", "3z", "4z"], draw: "5z", dora: "2m", melds: [], explanation: "  作者の文章\n", videoExplanation: "5zを切るのだ。", correctDiscards: ["5z"], riichiChoice: true, correctRiichi: false };

test("riichi/dama choices are explicit, mutually exclusive and keep the discard on the left", () => {
  const elements = {};
  const document = { getElementById(id) { return elements[id] ||= { attributes: {}, classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; } }; } };
  const api = new Function("document", "question", `let selectedIndex=0, riichiSelected=null, specialChoice=null, revealed=false; const playQuestions=[question], currentIndex=0, tileName=x=>x, tilePath=x=>x, renderHand=()=>{}; ${["selectableHand", "renderDecision", "selectRiichi", "toggleKan", "gradeAnswer"].map(extract).join("\n")}; return { render:()=>renderDecision(question), selectRiichi, toggleKan, gradeAnswer, values:()=>({riichiSelected,specialChoice}) };`)(document, { ...fixture, kanChoice: true });
  api.render();
  assert.equal(elements.confirmButton.disabled, true);
  assert.equal(elements.riichiButton.attributes["aria-pressed"], "false");
  assert.equal(elements.damaButton.attributes["aria-pressed"], "false");
  api.selectRiichi(true);
  assert.equal(elements.confirmButton.disabled, false);
  assert.equal(elements.riichiButton.attributes["aria-pressed"], "true");
  assert.equal(elements.damaButton.attributes["aria-pressed"], "false");
  api.selectRiichi(false);
  assert.equal(elements.riichiButton.attributes["aria-pressed"], "false");
  assert.equal(elements.damaButton.attributes["aria-pressed"], "true");
  assert.equal(api.gradeAnswer(fixture, { tile: "5z", riichi: false }).correct, true);
  assert.equal(api.gradeAnswer(fixture, { tile: "5z", riichi: true }).correct, false);
  api.toggleKan();
  assert.equal(api.values().specialChoice, "kan");
  assert.equal(elements.confirmButton.disabled, false);
  assert.equal(elements.damaButton.attributes["aria-pressed"], "false");
  api.selectRiichi(true);
  assert.equal(api.values().specialChoice, null);
  assert.equal(elements.confirmButton.disabled, true); // must choose a discard again
  assert.match(html, /\.decision \.selected-panel \{ grid-column: 1; grid-row: 1;/);
  assert.match(html, /\.decision-options \{ grid-column: 2; grid-row: 1;/);
});

test("sheen is stronger and uses only neutral white, with no yellow surround", () => {
  const sheen = html.match(/\.tile-face\.is-dora::after\s*\{([^}]+)\}/)[1];
  for (const [, r, g, b] of sheen.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) assert.ok(r === g && g === b);
  assert.match(html, /80% \{ opacity: \.82; \}/);
  assert.doesNotMatch(html, /\.tile-face\.is-dora(?:::before)?\s*\{/);
  assert.match(html, /\.explanation-section::before/);
  assert.match(html, /\.speaker-avatar\s*\{[^}]*left: -20px;[^}]*width: 32px;/);
});

test("local explanation patch preserves all other fields, rejects conflicts and obeys editing policy", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zundamon-inline-"));
  const basePath = path.join(dir, "questions.json"), overridesPath = path.join(dir, "overrides.json");
  await writeFile(basePath, JSON.stringify([fixture, { ...fixture, id: 2 }]));
  await writeFile(overridesPath, JSON.stringify({ "1": { reviewed: true, reviewUpdatedAt: "review-stamp" } }));
  const options = { basePath, overridesPath, editMode: "open", adminPassword: "isolated-test", port: 0 };
  const app = createAppServer(options);
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const patch = (id, body, headers = {}) => fetch(`${origin}/api/admin/questions/${id}/explanation`, { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const list = () => fetch(origin + "/api/questions").then(r => r.json());
  try {
    const response = await patch(1, { changes: { videoExplanation: "  6sを切るのだ。\n" }, expectedUpdatedAt: null });
    assert.equal(response.status, 200);
    const saved = await response.json();
    let [question] = await list();
    for (const [field, value] of Object.entries(fixture)) if (field !== "videoExplanation") assert.deepEqual(question[field], value, field);
    assert.equal(question.videoExplanation, "  6sを切るのだ。\n");
    assert.equal(question.reviewed, true);
    assert.equal((await patch(1, { changes: { explanation: "stale" }, expectedUpdatedAt: null })).status, 409);
    assert.equal((await patch(1, { changes: { hand: [] }, expectedUpdatedAt: saved.overrideUpdatedAt })).status, 400);
    assert.equal((await patch(1, { changes: { explanation: "a".repeat(20001) }, expectedUpdatedAt: saved.overrideUpdatedAt })).status, 400);
    assert.equal((await patch(1, { changes: {}, expectedUpdatedAt: saved.overrideUpdatedAt })).status, 400);
    assert.equal((await patch(1, { changes: { explanation: "no revision" } })).status, 400);
    assert.equal((await patch(9999, { changes: { explanation: "unknown" }, expectedUpdatedAt: null })).status, 404);
    const both = await patch(1, { changes: { explanation: "", videoExplanation: "新しい解説" }, expectedUpdatedAt: saved.overrideUpdatedAt });
    assert.equal(both.status, 200);
    [question] = await list();
    assert.equal(question.explanation, "");
    assert.equal(question.videoExplanation, "新しい解説");
    assert.deepEqual(question.correctDiscards, fixture.correctDiscards);
    // Two simultaneous patches from the same revision cannot overwrite each other.
    const outcomes = await Promise.all(["first", "second"].map(explanation => patch(2, { changes: { explanation }, expectedUpdatedAt: null }).then(r => r.status)));
    assert.deepEqual(outcomes.sort(), [200, 409]);
    const snapshot = await readFile(overridesPath, "utf8");
    for (const mode of ["closed", "password", "invalid"]) {
      options.editMode = mode;
      assert.equal((await patch(1, { changes: { explanation: "blocked" }, expectedUpdatedAt: question.overrideUpdatedAt })).status, mode === "password" ? 401 : 403);
    }
    assert.equal(await readFile(overridesPath, "utf8"), snapshot);
    options.editMode = "password";
    assert.equal((await patch(1, { changes: { explanation: "allowed" }, expectedUpdatedAt: question.overrideUpdatedAt }, { "X-Admin-Password": options.adminPassword })).status, 200);
    assert.equal((await patch(1, { changes: { explanation: "bad origin" }, expectedUpdatedAt: null }, { Origin: "https://unrelated.example" })).status, 403);
    // A text-only edit remains after clearing the separate review flag.
    options.editMode = "open";
    await fetch(origin + "/api/admin/questions/1", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed: false }) });
    assert.equal((await list())[0].videoExplanation, "新しい解説");
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});

function edgeHarness(source) {
  const env = { QUESTION_EDIT_MODE: "open", ADMIN_PASSWORD: "isolated-test", SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-only" };
  const rows = new Map(), mutations = [];
  let handler, race = false;
  const createClient = () => ({ from(table) {
    let action = "read", payload, filters = [];
    const execute = async () => {
      if (table.endsWith("reviews")) return { data: [], error: null };
      let data = [...rows.values()].filter(row => filters.every(([key, value]) => row[key] === value));
      if (action === "insert") {
        if (rows.has(payload.question_id) || race) { race = false; return { data: null, error: { code: "23505" } }; }
        rows.set(payload.question_id, structuredClone(payload)); mutations.push(payload); data = [payload];
      }
      if (action === "update") {
        if (race) { race = false; return { data: null, error: null }; }
        for (const row of data) { const updated = { ...row, ...structuredClone(payload) }; rows.set(row.question_id, updated); mutations.push(updated); }
        data = data.map(row => rows.get(row.question_id));
      }
      return { data: structuredClone(data), error: null };
    };
    const query = {
      select() { return query; }, order() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
      update(value) { action = "update"; payload = value; return query; }, insert(value) { action = "insert"; payload = value; return query; },
      async maybeSingle() { const result = await execute(); return { ...result, data: Array.isArray(result.data) ? result.data[0] || null : result.data }; },
      single() { return query.maybeSingle(); }, then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  } });
  new Function("Deno", "createClient", "resolveEditMode", "editAccess", stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, "")))(
    { env: { get: key => env[key] }, serve: callback => { handler = callback; } }, createClient, resolveEditMode, editAccess);
  return { env, rows, mutations, race: () => { race = true; }, request: (path, body, headers = {}) => handler(new Request(`https://fixture.invalid/${path}`, body === undefined ? {} : { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })) };
}

test("shared explanation patches preserve answers and speakers, including initial text-only overrides", async () => {
  const source = await readFile(new URL("../supabase/functions/zundamon-question-admin/index.ts", import.meta.url), "utf8");
  const app = edgeHarness(source);
  const patch = (changes, expectedUpdatedAt = null) => app.request("questions/1/explanation", { changes, expectedUpdatedAt });
  let response = await patch({ videoExplanation: "動画の変更" });
  assert.equal(response.status, 200);
  let saved = await response.json();
  const overrides = await app.request("overrides").then(r => r.json());
  assert.equal("correctDiscards" in overrides[0], false);
  assert.equal("explanation" in overrides[0], false);
  const merge = new Function(`${extract("mergeExplanationWithVideoSummary")} ${extract("mergeOverrides")}; return mergeOverrides;`)();
  const [merged] = merge([fixture], overrides);
  assert.equal(merged.explanation, fixture.explanation);
  assert.deepEqual(merged.hand, fixture.hand);
  assert.deepEqual(merged.correctDiscards, fixture.correctDiscards);
  assert.equal(merged.videoExplanation, "動画の変更");
  assert.equal((await patch({ explanation: "stale" })).status, 409);
  assert.equal((await patch({ correctDiscards: [] }, saved.overrideUpdatedAt)).status, 400);
  app.race();
  assert.equal((await patch({ explanation: "race" }, saved.overrideUpdatedAt)).status, 409);
  assert.equal(app.mutations.length, 1);
  app.rows.set(1, { question_id: 1, correct_discards: ["5z"], explanation: fixture.explanation, question_data: { ...fixture }, updated_at: saved.overrideUpdatedAt });
  response = await patch({ explanation: "", videoExplanation: "  最新\n" }, saved.overrideUpdatedAt);
  assert.equal(response.status, 200);
  saved = await response.json();
  const row = app.rows.get(1);
  assert.equal(row.explanation, "");
  assert.equal(row.question_data.videoExplanation, "  最新\n");
  assert.deepEqual(row.correct_discards, fixture.correctDiscards);
  assert.deepEqual(row.question_data.hand, fixture.hand);
  const snapshot = JSON.stringify([...app.rows]);
  for (const mode of ["closed", "password", "invalid"]) {
    app.env.QUESTION_EDIT_MODE = mode;
    assert.equal((await patch({ explanation: "blocked" }, saved.overrideUpdatedAt)).status, mode === "password" ? 401 : 403);
  }
  assert.equal(JSON.stringify([...app.rows]), snapshot);
  app.env.QUESTION_EDIT_MODE = "open";
  assert.equal((await app.request("questions/1/explanation", { changes: { explanation: "bad origin" }, expectedUpdatedAt: saved.overrideUpdatedAt }, { Origin: "https://unrelated.example" })).status, 403);
  app.race();
  assert.equal((await app.request("questions/2/explanation", { changes: { explanation: "insert race" }, expectedUpdatedAt: null })).status, 409);
});

test("inline editor sends only changed text and keeps drafts on failure or canceled navigation", () => {
  let allowDiscard = false;
  const draft = { original: { explanation: "原文", videoExplanation: "動画" }, values: { explanation: "変更", videoExplanation: "動画" } };
  const api = new Function("window", "draft", `let explanationEditor=draft, explanationEditBusy=false; const setExplanationNotice=()=>{}; ${extract("explanationChanges")} ${extract("leaveExplanationEditor")}; return { changes:explanationChanges, leave:leaveExplanationEditor, draft:()=>explanationEditor };`)({ confirm: () => allowDiscard }, draft);
  assert.deepEqual(api.changes(), { explanation: "変更" });
  assert.equal(api.leave(), false);
  assert.equal(api.draft(), draft);
  allowDiscard = true;
  assert.equal(api.leave(), true);
  assert.equal(api.draft(), null);
  assert.match(html, /changes, expectedUpdatedAt: draft.expectedUpdatedAt/);
  assert.match(html, /event.target\?\.closest\?\.\("input, textarea, \[contenteditable\]"\)/);
});

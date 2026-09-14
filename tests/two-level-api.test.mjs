import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppServer } from "../server.mjs";

test("local two-level saves reject old advanced clients and preserve existing fields with CAS", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zundamon-two-level-"));
  const basePath = path.join(root, "questions.json"), overridesPath = path.join(root, "overrides.json");
  const fixture = {
    id: 1, hand: ["1m", "2m", "3m", "4p", "0p", "5s", "6s", "7s", "1z", "1z", "2z", "3z", "4z"],
    draw: "5z", dora: "2m", melds: [], correctDiscards: ["5z"],
    explanation: "  作者の解説\n", videoExplanation: "動画の解説なのだ。", difficulty: "advanced",
  };
  const updatedAt = "2026-09-12T00:00:00.000Z", reviewUpdatedAt = "2026-09-12T01:00:00.000Z";
  const legacy = { questionData: fixture, explanation: fixture.explanation, correctDiscards: fixture.correctDiscards, updatedAt, reviewStatus: "check", reviewed: false, reviewUpdatedAt };
  await writeFile(basePath, JSON.stringify([fixture]));
  await writeFile(overridesPath, JSON.stringify({ 1: legacy }));
  const app = createAppServer({ rootDir: path.resolve("."), basePath, overridesPath, editMode: "open", port: 0 });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const request = (url, method = "GET", body) => fetch(origin + url, {
    method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    const initial = (await request("/api/questions").then(r => r.json()))[0];
    assert.equal(initial.difficulty, "advanced");
    for (const [url, method, body] of [
      ["/api/admin/questions/1/difficulty", "PATCH", { difficulty: "advanced", expectedUpdatedAt: updatedAt }],
      ["/api/admin/questions/1", "PUT", { question: fixture, explanation: "fallback must not save", correctDiscards: ["5z"], expectedUpdatedAt: updatedAt }],
      ["/api/admin/questions", "POST", { question: { ...fixture, id: 9999 }, expectedUpdatedAt: null }],
    ]) {
      const response = await request(url, method, body);
      assert.equal(response.status, 400);assert.match((await response.json()).error, /初級・中級から/);
    }
    assert.deepEqual(JSON.parse(await readFile(overridesPath, "utf8")), { 1: legacy });
    const editedResponse = await request("/api/admin/questions/1/explanation", "PATCH", { changes: { explanation: "追記済みの作者解説" }, expectedUpdatedAt: updatedAt });
    assert.equal(editedResponse.status, 200);
    let edited = await editedResponse.json();
    assert.equal(JSON.parse(await readFile(overridesPath, "utf8"))[1].questionData.difficulty, "advanced");
    assert.equal((await request("/api/admin/questions/1/difficulty", "PATCH", { difficulty: "intermediate", expectedUpdatedAt: updatedAt })).status, 409);
    for (const difficulty of ["intermediate", "beginner"]) {
      const savedResponse = await request("/api/admin/questions/1/difficulty", "PATCH", { difficulty, expectedUpdatedAt: edited.overrideUpdatedAt });
      assert.equal(savedResponse.status, 200);edited = await savedResponse.json();
      const current = (await request("/api/questions").then(r => r.json()))[0];
      assert.equal(current.difficulty, difficulty);
      assert.equal(current.explanation, "追記済みの作者解説");
      assert.equal(current.videoExplanation, fixture.videoExplanation);
      assert.equal(current.reviewStatus, "check");assert.equal(current.reviewUpdatedAt, reviewUpdatedAt);
      for (const key of ["hand", "draw", "dora", "melds", "correctDiscards"]) assert.deepEqual(current[key], fixture[key], key);
    }
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

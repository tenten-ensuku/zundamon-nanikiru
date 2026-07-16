import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppServer } from "../server.mjs";

const PASSWORD = "test-only-admin-password";
let temporaryRoot;
let basePath;
let overridesPath;
let app;
let origin;

const baseQuestions = [
  {
    id: 1,
    hand: ["1m", "2m", "3m", "4p", "0p", "5s", "6s", "7s", "1z", "1z", "2z", "3z", "4z", "5z"],
    explanation: "原本の解説",
    correctDiscards: [],
  },
  {
    id: 2,
    hand: ["1m", "1m", "2m", "2m", "3m", "3m", "4p", "4p", "5p", "5p", "6s", "6s", "7z", "7z"],
    explanation: "第2問",
    correctDiscards: [],
  },
];

async function startTestServer(password = PASSWORD) {
  const created = createAppServer({
    rootDir: path.resolve("."),
    basePath,
    overridesPath,
    adminPassword: password,
    port: 0,
    allowedOrigins: ["http://allowed.test"],
  });
  await new Promise((resolve) => created.server.listen(0, "127.0.0.1", resolve));
  const address = created.server.address();
  return { ...created, origin: `http://127.0.0.1:${address.port}` };
}

async function request(pathname, options = {}) {
  return fetch(`${origin}${pathname}`, options);
}

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zundamon-admin-"));
  await mkdir(path.join(temporaryRoot, "public"), { recursive: true });
  await mkdir(path.join(temporaryRoot, "data"), { recursive: true });
  basePath = path.join(temporaryRoot, "public", "questions.json");
  overridesPath = path.join(temporaryRoot, "data", "question-overrides.json");
  await writeFile(basePath, JSON.stringify(baseQuestions), "utf8");
  await writeFile(overridesPath, "{}\n", "utf8");
  app = await startTestServer();
  origin = app.origin;
});

after(async () => {
  if (app?.server.listening) await new Promise((resolve) => app.server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("public question list starts with bundled content", async () => {
  const response = await request("/api/questions");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.length, 2);
  assert.deepEqual(body[0].correctDiscards, []);
  assert.equal(body[0].explanation, "原本の解説");
  assert.equal(body[0].overridden, false);
});

test("override list is empty before edits", async () => {
  const response = await request("/api/overrides");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("login rejects malformed JSON and a wrong password", async () => {
  const malformed = await request("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);

  const wrong = await request("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "認証に失敗しました。");
});

test("login accepts the configured password", async () => {
  const response = await request("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("login reports missing server configuration", async () => {
  const missing = await startTestServer("");
  try {
    const response = await fetch(`${missing.origin}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(response.status, 503);
  } finally {
    await new Promise((resolve) => missing.server.close(resolve));
  }
});

test("mutations reject missing authentication and unknown origins", async () => {
  const noCredential = await request("/api/admin/questions/1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correctDiscards: ["1m"], explanation: "更新" }),
  });
  assert.equal(noCredential.status, 401);

  const unrelatedOrigin = await request("/api/admin/questions/1", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": PASSWORD,
      Origin: "https://unrelated.example",
    },
    body: JSON.stringify({ correctDiscards: ["1m"], explanation: "更新" }),
  });
  assert.equal(unrelatedOrigin.status, 403);
});

test("server validates IDs, answers, and explanation length", async () => {
  const headers = { "Content-Type": "application/json", "X-Admin-Password": PASSWORD };
  const missingId = await request("/api/admin/questions/999", {
    method: "PUT", headers, body: JSON.stringify({ correctDiscards: ["1m"], explanation: "更新" }),
  });
  assert.equal(missingId.status, 404);

  const blank = await request("/api/admin/questions/1", {
    method: "PUT", headers, body: JSON.stringify({ correctDiscards: ["1m"], explanation: "" }),
  });
  assert.equal(blank.status, 400);

  const invalidAnswer = await request("/api/admin/questions/1", {
    method: "PUT", headers, body: JSON.stringify({ correctDiscards: ["9p"], explanation: "更新" }),
  });
  assert.equal(invalidAnswer.status, 400);

  const tooLong = await request("/api/admin/questions/1", {
    method: "PUT", headers, body: JSON.stringify({ correctDiscards: ["1m"], explanation: "あ".repeat(20_001) }),
  });
  assert.equal(tooLong.status, 400);
});

test("upsert reaches the merged public question list", async () => {
  const response = await request("/api/admin/questions/1", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Admin-Password": PASSWORD, Origin: "http://allowed.test" },
    body: JSON.stringify({ correctDiscards: ["1m", "0p"], explanation: "編集した解説" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://allowed.test");
  const saved = await response.json();
  assert.deepEqual(saved.correctDiscards, ["1m", "0p"]);
  assert.equal(saved.overridden, true);

  const publicResponse = await request("/api/questions");
  const publicQuestions = await publicResponse.json();
  assert.equal(publicQuestions[0].explanation, "編集した解説");
  assert.deepEqual(publicQuestions[0].correctDiscards, ["1m", "0p"]);

  const stored = JSON.parse(await readFile(overridesPath, "utf8"));
  assert.equal(stored["1"].explanation, "編集した解説");
});

test("delete restores bundled content", async () => {
  const response = await request("/api/admin/questions/1", {
    method: "DELETE",
    headers: { "X-Admin-Password": PASSWORD },
  });
  assert.equal(response.status, 200);
  const restored = await response.json();
  assert.equal(restored.explanation, "原本の解説");
  assert.deepEqual(restored.correctDiscards, []);
  assert.equal(restored.overridden, false);
});

test("client contains a bundled-data fallback", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /fetch\("public\/questions\.json"/);
  assert.match(source, /apiUrl\("\/api\/overrides"\)/);
  assert.match(source, /\.catch\(\(\) => \[\]\)/);
});

test("hand and meld tiles keep the same per-tile width", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /container-type:\s*inline-size/);
  assert.match(source, /\.tile-button, \.meld-tile\s*\{[^}]*width:\s*var\(--tile-width\)[^}]*flex:\s*0 0 var\(--tile-width\)/s);
  assert.match(source, /const APP_VERSION = 11;/);
});

test("client has the Ensuku-style menu without an ura mode", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  for (const label of ["挑戦", "復習", "問題一覧", "自己分析", "順位", "設定"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /class="menu-admin-entry" href="admin\.html">管理画面<\/a>/);
  assert.match(source, /data-start-mode="ten"/);
  assert.match(source, /data-start-mode="all"/);
  assert.match(source, /id="homeButton"[^>]*>メニュー</);
  assert.doesNotMatch(source, /裏モード/);
});

test("question 1 contains a red five-pin", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const question = questions.find((item) => item.id === 1);
  assert.equal(question.hand.filter((tile) => tile === "0p").length, 1);
  assert.equal(question.hand.includes("5p"), false);
});

test("question 13 contains an open three-white pon", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const question = questions.find((item) => item.id === 13);
  assert.equal(question.meldCount, 1);
  assert.deepEqual(question.melds, [{
    type: "pon",
    open: true,
    calledIndex: 0,
    tiles: ["5z", "5z", "5z"],
  }]);
});

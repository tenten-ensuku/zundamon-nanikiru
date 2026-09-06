import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { stripTypeScriptTypes } from "node:module";
import { createAppServer } from "../server.mjs";
import { DEFAULT_EDIT_MODE, resolveEditMode, editAccess } from "../supabase/functions/zundamon-question-admin/edit-policy.mjs";

const fixture = { id: 1, hand: ["1m", "2m", "3m", "4p", "0p", "5s", "6s", "7s", "1z", "1z", "2z", "3z", "4z"], draw: "5z", dora: "2m", melds: [], explanation: "原文", videoExplanation: "5zを切るのだ。", correctDiscards: ["5z"] };

test("temporary default is open, and invalid policies fail closed", () => {
  assert.equal(DEFAULT_EDIT_MODE, "open");
  assert.equal(resolveEditMode(), "open");
  for (const mode of ["open", "password", "closed"]) assert.equal(resolveEditMode(mode), mode);
  for (const mode of ["", "public", "false", null, 1]) assert.equal(resolveEditMode(mode), "closed");
  assert.deepEqual(editAccess("open"), { mode: "open", requiresPassword: false, canEdit: true });
});

test("local open mode persists every editor action without a credential and can be closed for old clients", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zundamon-open-editor-"));
  const basePath = path.join(dir, "questions.json");
  const overridesPath = path.join(dir, "overrides.json");
  await writeFile(basePath, JSON.stringify([fixture]));
  await writeFile(overridesPath, "{}");
  const options = { basePath, overridesPath, adminPassword: "isolated-editor-test", editMode: "open", port: 0, allowedOrigins: ["https://allowed.example"] };
  const app = createAppServer(options);
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const request = (url, method = "GET", body, headers = {}) => fetch(origin + url, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const access = await request("/api/admin/access");
    assert.equal(access.headers.get("cache-control"), "no-store");
    assert.deepEqual(await access.json(), editAccess("open"));
    const changed = { ...fixture, explanation: "  作者の追記\n", correctDiscards: ["5z"] };
    assert.equal((await request("/api/admin/questions/1", "PUT", { question: changed })).status, 200);
    assert.equal((await request("/api/questions").then(r => r.json()))[0].explanation, changed.explanation);
    assert.equal(JSON.parse(await readFile(overridesPath, "utf8"))["1"].questionData.explanation, changed.explanation);
    assert.equal((await request("/api/admin/questions/1", "PATCH", { reviewed: true })).status, 200);
    assert.equal((await request("/api/admin/questions", "POST", { question: { ...fixture, id: 2 } })).status, 200);
    assert.equal((await request("/api/questions").then(r => r.json())).length, 2);
    assert.equal((await request("/api/admin/questions/2", "DELETE")).status, 200);
    assert.equal((await request("/api/admin/questions/1", "DELETE")).status, 200);
    let restored = (await request("/api/questions").then(r => r.json()))[0];
    assert.equal(restored.explanation, fixture.explanation);
    assert.equal(restored.reviewed, true);
    assert.equal((await request("/api/admin/questions/1", "PATCH", { reviewed: false })).status, 200);
    assert.equal((await request("/api/admin/questions/1", "PUT", { question: { ...fixture, draw: "9z" } })).status, 400);
    assert.equal((await request("/api/admin/questions/1", "PUT", { question: changed }, { Origin: "https://unrelated.example" })).status, 403);

    // The same running instance and already-open clients lose write access.
    options.editMode = "closed";
    const before = await readFile(overridesPath, "utf8");
    for (const [url, method, body] of [
      ["/api/admin/login", "POST", { password: options.adminPassword }],
      ["/api/admin/questions/1", "PUT", { question: changed }],
      ["/api/admin/questions/1", "PATCH", { reviewed: true }],
      ["/api/admin/questions/1", "DELETE"],
      ["/api/admin/questions", "POST", { question: { ...fixture, id: 2 } }],
    ]) assert.equal((await request(url, method, body, { "X-Admin-Password": options.adminPassword })).status, 403);
    assert.equal(await readFile(overridesPath, "utf8"), before);
    assert.equal((await request("/api/questions")).status, 200);
    assert.deepEqual(await request("/api/admin/access").then(r => r.json()), editAccess("closed"));

    options.editMode = "password";
    assert.equal((await request("/api/admin/questions/1", "PUT", { question: changed })).status, 401);
    assert.equal((await request("/api/admin/questions/1", "PUT", { question: changed }, { "X-Admin-Password": options.adminPassword })).status, 200);
    options.editMode = "invalid";
    assert.equal((await request("/api/admin/questions/1", "DELETE", undefined, { "X-Admin-Password": options.adminPassword })).status, 403);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});

test("deployed handler enforces all three edit policies before any database mutation", async () => {
  const source = await readFile(new URL("../supabase/functions/zundamon-question-admin/index.ts", import.meta.url), "utf8");
  const js = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, ""));
  const env = { QUESTION_EDIT_MODE: "open", ADMIN_PASSWORD: "isolated-edge-test", SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-only-not-a-real-key" };
  const writes = [];
  let handler;
  const createClient = () => ({ from(table) {
    let row = {};
    const result = () => ({ data: row, error: null });
    const query = {
      upsert(value) { row = value; writes.push({ table, value }); return query; },
      delete() { writes.push({ table, deleted: true }); return query; },
      select() { return query; }, eq() { return query; },
      single: async () => result(),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  } });
  new Function("Deno", "createClient", "resolveEditMode", "editAccess", js)(
    { env: { get: key => env[key] }, serve: callback => { handler = callback; } }, createClient, resolveEditMode, editAccess,
  );
  const request = (url, method = "GET", body, headers = {}) => handler(new Request(`https://fixture.invalid/${url}`, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  assert.deepEqual(await request("access").then(r => r.json()), editAccess("open"));
  assert.equal((await request("questions/1", "PUT", { question: fixture })).status, 200);
  assert.equal((await request("questions", "POST", { question: { ...fixture, id: 2 } })).status, 200);
  assert.equal((await request("questions/1", "PATCH", { reviewed: true })).status, 200);
  assert.equal((await request("questions/1", "DELETE")).status, 200);
  assert.equal(writes.length, 4);
  assert.equal((await request("questions/1", "PUT", { question: fixture }, { Origin: "https://unrelated.example" })).status, 403);
  assert.equal(writes.length, 4);

  env.QUESTION_EDIT_MODE = "closed";
  for (const [url, method, body] of [
    ["login", "POST", { password: env.ADMIN_PASSWORD }],
    ["questions/1", "PUT", { question: fixture }],
    ["questions/1", "PATCH", { reviewed: true }],
    ["questions/1", "DELETE"],
    ["questions", "POST", { question: { ...fixture, id: 2 } }],
  ]) assert.equal((await request(url, method, body, { "X-Admin-Password": env.ADMIN_PASSWORD })).status, 403);
  assert.equal(writes.length, 4);
  env.QUESTION_EDIT_MODE = "password";
  assert.equal((await request("questions/1", "PUT", { question: fixture })).status, 401);
  assert.equal(writes.length, 4);
  assert.equal((await request("questions/1", "PUT", { question: fixture }, { "X-Admin-Password": env.ADMIN_PASSWORD })).status, 200);
  assert.equal(writes.length, 5);
  env.QUESTION_EDIT_MODE = "not-a-mode";
  assert.equal((await request("questions/1", "DELETE")).status, 403);
  assert.equal(writes.length, 5);
});

test("editor skips login only after server approval and explains shared service restrictions", async () => {
  const source = await readFile(new URL("../admin.html", import.meta.url), "utf8");
  assert.match(source, /api\("\/api\/admin\/access"\)/);
  assert.match(source, /access\.mode === "open"\) await openEditor\(\)/);
  assert.match(source, /id="loginPanel" hidden/);
  assert.match(source, /共有保存サービスが利用制限で停止しています（HTTP 402）/);
  assert.match(source, /公開サイトには自動反映されません/);
  assert.match(source, /変更は全員の問題集に反映されます/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^]*?adminPassword/);
});

test("editor distinguishes a local offline server from an unreadable shared-service response", async () => {
  const source = await readFile(new URL("../admin.html", import.meta.url), "utf8");
  const match = source.match(/function editorAccessErrorMessage\(error, local\) \{([\s\S]+?)\n    \}/);
  assert.ok(match);
  const message = new Function("error", "local", match[1]);
  assert.match(message(new TypeError("Failed to fetch"), true), /このPCのサーバー/);
  assert.match(message(new TypeError("Failed to fetch"), false), /利用制限（HTTP 402）や通信エラーの可能性/);
  assert.doesNotMatch(message(new TypeError("Failed to fetch"), false), /サーバーが起動/);
  assert.equal(message({ status: 402, message: "quota response" }, false), "quota response");
});

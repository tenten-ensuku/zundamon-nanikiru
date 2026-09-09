import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../shared-data.js", import.meta.url), "utf8");
const base = "https://example.workers.dev";
const cacheKey = "zundamon-nanikiru:shared-overrides-v1";
const plain = value => JSON.parse(JSON.stringify(value));
const snapshot = { schema: 1, source: base, cursor: 5, rows: [{ id: 1, explanation: "元の共有解説", overridden: true }] };
function setup(handler, { hostname = "example.github.io", cache } = {}) {
  const values = new Map(cache ? [[cacheKey, JSON.stringify(cache)]] : []), calls = [];
  const context = vm.createContext({
    location: { hostname }, ZUNDAMON_CONFIG: { apiBaseUrl: base }, AbortSignal,
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    fetch: async (url, options) => { calls.push({ url, options }); return handler(url, options); },
  });
  vm.runInContext(source, context);
  return { api: context.ZundamonShared, values, calls };
}
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test("shared client starts from public snapshot and applies bounded deltas without a full-table endpoint", async () => {
  const { api, calls, values } = setup(url => {
    if (url === "public/shared-overrides.json") return response(snapshot);
    assert.equal(url, base + "/sync?since=5");
    return response({ rows: [{ id: 1, explanation: "更新後", overridden: true }, { id: 2, reviewed: true, reviewStatus: "complete" }], cursor: 7, until: 7, more: false });
  });
  const result = plain(await api.loadOverrides());
  assert.equal(result[0].explanation, "更新後");
  assert.equal(result[1].reviewStatus, "complete");
  assert.equal(JSON.parse(values.get(cacheKey)).cursor, 7);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => !call.url.includes("supabase") && !call.url.endsWith("/overrides")));
});

test("failed or partial delta never overwrites the last complete cached dataset", async () => {
  let page = 0;
  const { api, values } = setup(() => ++page % 2 === 1
    ? response({ rows: [{ id: 1, explanation: "未完の同期" }], cursor: 6, until: 8, more: true })
    : response({ error: "一時停止中" }, 503), { cache: snapshot });
  assert.deepEqual(plain(await api.loadOverrides()), snapshot.rows);
  assert.equal(JSON.parse(values.get(cacheKey)).cursor, 5);
  await assert.rejects(api.loadOverrides({ strict: true }), /一時停止中/);
  assert.equal(JSON.parse(values.get(cacheKey)).rows[0].explanation, "元の共有解説");
});

test("network failures, quota failures, and malformed cursors leave offline practice data available", async () => {
  for (const handler of [() => { throw new TypeError("network disconnected"); }, () => response({error:"limit"}, 429), () => response({ rows: [], cursor: 4, until: 5, more: false })]) {
    const { api } = setup(handler, { cache: snapshot });
    assert.deepEqual(plain(await api.loadOverrides()), snapshot.rows);
    await assert.rejects(api.loadOverrides({ strict: true }));
  }
});

test("point reads and writes request a fresh delta without losing the shared revision", async () => {
  const { api, calls } = setup(url => {
    if (url.endsWith("/overrides/1")) return response({ id: 1, explanation: "個別の最新本文" });
    return response({ rows: [], cursor: 5, until: 5, more: false });
  }, { cache: snapshot });
  await api.loadOverrides();
  await api.getOverride(1);
  assert.equal((await api.loadOverrides())[0].explanation, "個別の最新本文");
  assert.equal(calls.at(-1).url, base + "/sync?since=5&fresh=1");
  api.invalidate();
  await api.loadOverrides();
  assert.ok(calls.at(-1).url.endsWith("&fresh=1"));
});

test("local editor stays isolated from shared production persistence", async () => {
  const { api, calls } = setup(url => { assert.equal(url, "/api/overrides"); return response([]); }, { hostname: "127.0.0.1" });
  assert.deepEqual(plain(await api.loadOverrides({ strict: true })), []);
  assert.equal(calls.length, 1);
});

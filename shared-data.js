(function (root) {
  "use strict";
  const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  const base = root.ZUNDAMON_CONFIG?.apiBaseUrl?.replace(/\/$/, "") || "";
  const cacheKey = "zundamon-nanikiru:shared-overrides-v1";
  let memory = null, pending = null;
  function apiUrl(path) { return local || !base ? path : base + path.replace(/^\/api\/admin/, "").replace(/^\/api/, ""); }
  async function request(path, options = {}) {
    let response;
    try { response = await fetch(apiUrl(path), { ...options, cache: "no-store", signal: options.signal || AbortSignal.timeout(8000) }); }
    catch { throw new Error("共有保存サービスに接続できません。入力は残っています。再試行してください。"); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "共有データを取得できませんでした。"), { status: response.status });
    return data;
  }
  const valid = value => value && value.schema === 1 && value.source === base && Number.isSafeInteger(value.cursor) && value.cursor >= 0 && Array.isArray(value.rows) && value.rows.length <= 9999 && value.rows.every(row => Number.isInteger(row?.id) && row.id > 0 && row.id <= 9999);
  function persist() { if (!local && memory) try { localStorage.setItem(cacheKey, JSON.stringify(memory)); } catch {} }
  async function initial() {
    if (memory) return;
    try { const cached = JSON.parse(localStorage.getItem(cacheKey)); if (valid(cached)) memory = cached; } catch {}
    if (!memory) {
      try {
        const response = await fetch("public/shared-overrides.json", { signal: AbortSignal.timeout(6000) });
        if (response.ok) { const snapshot = await response.json(); if (valid(snapshot)) memory = snapshot; }
      } catch {}
      memory ||= { schema: 1, source: base, cursor: 0, rows: [] };
    }
  }
  async function sync() {
    await initial();
    // Apply only a complete bounded delta. A partial/failed fetch cannot erase the cached state.
    let cursor = memory.cursor, until = null;
    const rows = new Map(memory.rows.map(row => [row.id, row]));
    for (let page = 0; page < 200; page++) {
      const data = await request(`/api/sync?since=${cursor}${until === null ? "" : `&until=${until}`}${memory.freshUntil > Date.now() ? "&fresh=1" : ""}`);
      if (!data || !Array.isArray(data.rows) || data.rows.length > 50 || !Number.isSafeInteger(data.cursor) || data.cursor < cursor || !Number.isSafeInteger(data.until) || data.cursor > data.until || (until !== null && data.until !== until) || typeof data.more !== "boolean" || (data.more && data.cursor === cursor)) throw new Error("共有データの応答を確認できません。");
      for (const row of data.rows) { if (!Number.isInteger(row.id) || row.id < 1 || row.id > 9999) throw new Error("問題番号が不正です。"); rows.set(row.id, row); }
      cursor = data.cursor; until = data.until;
      if (!data.more) {
        memory = { ...memory, cursor, rows: [...rows.values()].sort((a,b) => a.id-b.id) };
        persist(); return memory.rows;
      }
    }
    throw new Error("変更が多いため、再読み込みして再試行してください。");
  }
  async function loadOverrides({ strict = false } = {}) {
    if (local) return request("/api/overrides").catch(error => { if (strict) throw error; return []; });
    try { pending ||= sync().finally(() => { pending = null; }); return await pending; }
    catch (error) { if (strict) throw error; await initial(); return memory.rows; }
  }
  async function getOverride(id) {
    const result = await request(`/api/overrides/${id}`);
    remember(result); return result;
  }
  function remember(item) {
    if (local || !memory || !item || !Number.isInteger(item.id)) return;
    const byId = new Map(memory.rows.map(row => [row.id, row]));
    byId.set(item.id, item);
    memory.rows = [...byId.values()].sort((a,b) => a.id-b.id);
    memory.freshUntil = Date.now() + 11000;
    persist();
  }
  function invalidate() { if (memory) { memory.freshUntil = Date.now() + 11000; persist(); } }
  root.ZundamonShared = Object.freeze({ request, loadOverrides, getOverride, remember, invalidate });
})(globalThis);

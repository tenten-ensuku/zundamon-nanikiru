import { createClient } from "npm:@supabase/supabase-js@2.110.6";

const FUNCTION_SLUG = "zundamon-question-admin";
const TABLE = "zundamon_question_overrides";
const REVIEW_TABLE = "zundamon_question_reviews";
const MAX_EXPLANATION_LENGTH = 20_000;
const MAX_BODY_LENGTH = 64 * 1024;
const TILE_CODE = /^(?:[1-9][mps]|[1-7]z|0[mps])$/;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://tenten-ensuku.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
];

function allowedOrigins() {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

function isAllowedOrigin(origin: string | null) {
  return !origin || allowedOrigins().has(origin);
}

function responseHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Admin-Password";
  }
  return headers;
}

function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });
}

function routePath(url: URL) {
  const marker = `/${FUNCTION_SLUG}`;
  const index = url.pathname.indexOf(marker);
  if (index < 0) return url.pathname;
  return url.pathname.slice(index + marker.length) || "/";
}

async function readJson(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_LENGTH) throw Object.assign(new Error("too large"), { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) throw Object.assign(new Error("too large"), { status: 413 });
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw Object.assign(new Error("invalid json"), { status: 400 });
  }
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function safePasswordEqual(supplied: unknown, expected: string) {
  if (typeof supplied !== "string" || !expected) return false;
  const [left, right] = await Promise.all([digest(supplied), digest(expected)]);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

function secretKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    const parsed = JSON.parse(modern);
    if (parsed.default) return parsed.default;
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function database() {
  return createClient(Deno.env.get("SUPABASE_URL") || "", secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicOverride(row: Record<string, unknown>) {
  return {
    id: Number(row.question_id),
    correctDiscards: Array.isArray(row.correct_discards) ? row.correct_discards : [],
    explanation: String(row.explanation || ""),
    overridden: true,
    overrideUpdatedAt: row.updated_at || null,
  };
}

function mergePublicRows(
  overrideRows: Record<string, unknown>[],
  reviewRows: Record<string, unknown>[],
) {
  const byId = new Map<number, Record<string, unknown>>();
  for (const row of overrideRows) {
    const item = publicOverride(row);
    byId.set(Number(item.id), item);
  }
  for (const row of reviewRows) {
    const id = Number(row.question_id);
    byId.set(id, {
      ...(byId.get(id) || { id }),
      reviewed: row.reviewed === true,
      reviewUpdatedAt: row.updated_at || null,
    });
  }
  return [...byId.values()].sort((left, right) => Number(left.id) - Number(right.id));
}

async function authenticate(request: Request, bodyPassword?: unknown) {
  const expected = Deno.env.get("ADMIN_PASSWORD") || "";
  if (!expected) return { configured: false, authenticated: false };
  const supplied = bodyPassword ?? request.headers.get("X-Admin-Password");
  return { configured: true, authenticated: await safePasswordEqual(supplied, expected) };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) return json(403, { error: "この接続元からは利用できません。" }, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });

  const pathname = routePath(new URL(request.url));

  try {
    if (request.method === "GET" && pathname === "/overrides") {
      const db = database();
      const [overrideResult, reviewResult] = await Promise.all([
        db.from(TABLE).select("question_id, correct_discards, explanation, updated_at").order("question_id"),
        db.from(REVIEW_TABLE).select("question_id, reviewed, updated_at").order("question_id"),
      ]);
      if (overrideResult.error) throw overrideResult.error;
      if (reviewResult.error) throw reviewResult.error;
      return json(200, mergePublicRows(overrideResult.data || [], reviewResult.data || []), origin);
    }

    if (request.method === "POST" && pathname === "/login") {
      const body = await readJson(request);
      const auth = await authenticate(request, body.password);
      if (!auth.configured) return json(503, { error: "管理パスワードが設定されていません。" }, origin);
      if (!auth.authenticated) return json(401, { error: "認証に失敗しました。" }, origin);
      return json(200, { ok: true }, origin);
    }

    const match = /^\/questions\/(\d+)$/.exec(pathname);
    if (match && (request.method === "PUT" || request.method === "PATCH" || request.method === "DELETE")) {
      const auth = await authenticate(request);
      if (!auth.configured) return json(503, { error: "管理パスワードが設定されていません。" }, origin);
      if (!auth.authenticated) return json(401, { error: "認証に失敗しました。" }, origin);

      const id = Number(match[1]);
      if (!Number.isInteger(id) || id < 1 || id > 165) {
        return json(404, { error: "問題が見つかりません。" }, origin);
      }

      if (request.method === "DELETE") {
        const { error } = await database().from(TABLE).delete().eq("question_id", id);
        if (error) throw error;
        return json(200, { id, restored: true }, origin);
      }

      if (request.method === "PATCH") {
        const body = await readJson(request);
        if (typeof body.reviewed !== "boolean") {
          return json(400, { error: "確認完了の指定が正しくありません。" }, origin);
        }
        if (!body.reviewed) {
          const { error } = await database().from(REVIEW_TABLE).delete().eq("question_id", id);
          if (error) throw error;
          return json(200, { id, reviewed: false, reviewUpdatedAt: null }, origin);
        }

        const { data, error } = await database()
          .from(REVIEW_TABLE)
          .upsert({ question_id: id, reviewed: true, updated_at: new Date().toISOString() }, { onConflict: "question_id" })
          .select("question_id, reviewed, updated_at")
          .single();
        if (error) throw error;
        return json(200, {
          id: Number(data.question_id),
          reviewed: data.reviewed === true,
          reviewUpdatedAt: data.updated_at || null,
        }, origin);
      }

      const body = await readJson(request);
      const explanation = typeof body.explanation === "string" ? body.explanation.trim() : "";
      const correctDiscards = Array.isArray(body.correctDiscards)
        ? [...new Set(body.correctDiscards.filter((code: unknown) => typeof code === "string"))]
        : [];
      if (!explanation || explanation.length > MAX_EXPLANATION_LENGTH) {
        return json(400, { error: "解説は1〜20,000文字で入力してください。" }, origin);
      }
      if (!correctDiscards.length || correctDiscards.length > 14 || correctDiscards.some((code) => !TILE_CODE.test(code))) {
        return json(400, { error: "手牌から正解打牌を1枚以上選択してください。" }, origin);
      }

      const { data, error } = await database()
        .from(TABLE)
        .upsert({
          question_id: id,
          correct_discards: correctDiscards,
          explanation,
          updated_at: new Date().toISOString(),
        }, { onConflict: "question_id" })
        .select("question_id, correct_discards, explanation, updated_at")
        .single();
      if (error) throw error;
      return json(200, publicOverride(data), origin);
    }

    return json(404, { error: "APIが見つかりません。" }, origin);
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500;
    if (status >= 500) console.error("zundamon-question-admin", error instanceof Error ? error.message : "unknown error");
    return json(status, { error: status >= 500 ? "サーバーエラーが発生しました。" : "リクエストを処理できません。" }, origin);
  }
});

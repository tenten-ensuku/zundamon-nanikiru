import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JSON_LIMIT = 64 * 1024;
const MAX_EXPLANATION_LENGTH = 20_000;

async function loadEnvFile(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equals = line.indexOf("=");
      if (equals < 1) continue;
      const key = line.slice(0, equals).trim();
      let value = line.slice(equals + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function safePasswordEqual(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string" || !expected) return false;
  const left = createHash("sha256").update(supplied, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

async function readJson(filePath, fallback) {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function mergeQuestions(baseQuestions, overrides) {
  return baseQuestions.map((question) => {
    const override = overrides[String(question.id)];
    const hasContentOverride = Array.isArray(override?.correctDiscards) || typeof override?.explanation === "string";
    return {
      ...question,
      correctDiscards: Array.isArray(override?.correctDiscards)
        ? override.correctDiscards
        : Array.isArray(question.correctDiscards) ? question.correctDiscards : [],
      explanation: typeof override?.explanation === "string" ? override.explanation : question.explanation,
      reviewed: override?.reviewed === true,
      overridden: hasContentOverride,
      overrideUpdatedAt: override?.updatedAt || null,
      reviewUpdatedAt: override?.reviewUpdatedAt || null,
    };
  });
}

function listOverrides(overrides) {
  return Object.entries(overrides)
    .map(([id, override]) => {
      const result = {
        id: Number(id),
        reviewed: override?.reviewed === true,
        reviewUpdatedAt: override?.reviewUpdatedAt || null,
      };
      if (Array.isArray(override?.correctDiscards)) result.correctDiscards = override.correctDiscards;
      if (typeof override?.explanation === "string") result.explanation = override.explanation;
      if (override?.updatedAt) result.overrideUpdatedAt = override.updatedAt;
      return result;
    })
    .filter((override) => Number.isInteger(override.id))
    .sort((left, right) => left.id - right.id);
}

function sendJson(response, status, value, origin) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  response.end(body);
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) {
      const error = new Error("request_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("invalid_json");
    error.status = 400;
    throw error;
  }
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
  }[extension] || "application/octet-stream";
}

function allowedStaticPath(rootDir, pathname) {
  if (pathname === "/") return path.join(rootDir, "index.html");
  if (pathname === "/index.html" || pathname === "/admin.html" || pathname === "/config.js") return path.join(rootDir, pathname.slice(1));
  if (/^\/tiles\/[a-z0-9-]+\.png$/i.test(pathname)) return path.join(rootDir, pathname.slice(1));
  if (pathname === "/public/questions.json") return path.join(rootDir, "public", "questions.json");
  if (/^\/public\/questions\/question-\d{3}(?:-\d{2})?\.png$/i.test(pathname)) {
    return path.join(rootDir, pathname.slice(1));
  }
  return null;
}

export function createAppServer(options = {}) {
  const rootDir = path.resolve(options.rootDir || HERE);
  const basePath = path.resolve(options.basePath || process.env.QUESTIONS_PATH || path.join(rootDir, "public", "questions.json"));
  const overridesPath = path.resolve(options.overridesPath || process.env.QUESTION_OVERRIDES_PATH || path.join(rootDir, "data", "question-overrides.json"));
  const adminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD ?? "";
  const port = Number(options.port ?? process.env.PORT ?? 4173);
  const configuredOrigins = options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...configuredOrigins.map((origin) => origin.trim()).filter(Boolean),
  ]);
  let writeQueue = Promise.resolve();

  async function baseAndOverrides() {
    const [baseQuestions, overrides] = await Promise.all([
      readJson(basePath, []),
      readJson(overridesPath, {}),
    ]);
    return { baseQuestions, overrides };
  }

  function originStatus(request) {
    const origin = request.headers.origin;
    return { origin, allowed: !origin || allowedOrigins.has(origin) };
  }

  function authenticated(request) {
    return safePasswordEqual(request.headers["x-admin-password"], adminPassword);
  }

  async function handler(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    const { origin, allowed } = originStatus(request);

    response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");

    if (pathname.startsWith("/api/") && !allowed) {
      sendJson(response, 403, { error: "許可されていない接続元です。" });
      return;
    }

    if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }

    try {
      if (request.method === "GET" && pathname === "/api/questions") {
        const { baseQuestions, overrides } = await baseAndOverrides();
        sendJson(response, 200, mergeQuestions(baseQuestions, overrides), origin);
        return;
      }

      if (request.method === "GET" && pathname === "/api/overrides") {
        const { overrides } = await baseAndOverrides();
        sendJson(response, 200, listOverrides(overrides), origin);
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/login") {
        if (!adminPassword) {
          sendJson(response, 503, { error: "管理パスワードが設定されていません。" }, origin);
          return;
        }
        const body = await readRequestJson(request);
        if (!safePasswordEqual(body.password, adminPassword)) {
          sendJson(response, 401, { error: "認証に失敗しました。" }, origin);
          return;
        }
        sendJson(response, 200, { ok: true }, origin);
        return;
      }

      const adminMatch = /^\/api\/admin\/questions\/(\d+)$/.exec(pathname);
      if (adminMatch && (request.method === "PUT" || request.method === "PATCH" || request.method === "DELETE")) {
        if (!adminPassword || !authenticated(request)) {
          sendJson(response, 401, { error: "認証に失敗しました。" }, origin);
          return;
        }
        const questionId = Number(adminMatch[1]);
        const { baseQuestions, overrides } = await baseAndOverrides();
        const baseQuestion = baseQuestions.find((question) => question.id === questionId);
        if (!baseQuestion) {
          sendJson(response, 404, { error: "問題が見つかりません。" }, origin);
          return;
        }

        const key = String(questionId);
        const existing = overrides[key] && typeof overrides[key] === "object" ? overrides[key] : {};
        if (request.method === "DELETE") {
          if (existing.reviewed === true) {
            overrides[key] = {
              reviewed: true,
              reviewUpdatedAt: existing.reviewUpdatedAt || new Date().toISOString(),
            };
          } else {
            delete overrides[key];
          }
        } else if (request.method === "PATCH") {
          const body = await readRequestJson(request);
          if (typeof body.reviewed !== "boolean") {
            sendJson(response, 400, { error: "確認完了の指定が正しくありません。" }, origin);
            return;
          }
          if (body.reviewed) {
            overrides[key] = {
              ...existing,
              reviewed: true,
              reviewUpdatedAt: new Date().toISOString(),
            };
          } else {
            const { reviewed, reviewUpdatedAt, ...contentOverride } = existing;
            if (Array.isArray(contentOverride.correctDiscards) || typeof contentOverride.explanation === "string") {
              overrides[key] = contentOverride;
            } else {
              delete overrides[key];
            }
          }
        } else {
          const body = await readRequestJson(request);
          const explanation = typeof body.explanation === "string" ? body.explanation.trim() : "";
          const correctDiscards = Array.isArray(body.correctDiscards)
            ? [...new Set(body.correctDiscards.filter((code) => typeof code === "string"))]
            : [];
          const selectableCodes = new Set(baseQuestion.hand || []);
          if (!explanation || explanation.length > MAX_EXPLANATION_LENGTH) {
            sendJson(response, 400, { error: `解説は1～${MAX_EXPLANATION_LENGTH.toLocaleString("ja-JP")}文字で入力してください。` }, origin);
            return;
          }
          if (!correctDiscards.length || correctDiscards.some((code) => !selectableCodes.has(code))) {
            sendJson(response, 400, { error: "手牌から正解打牌を1枚以上選択してください。" }, origin);
            return;
          }
          overrides[key] = {
            ...(existing.reviewed === true ? {
              reviewed: true,
              reviewUpdatedAt: existing.reviewUpdatedAt || new Date().toISOString(),
            } : {}),
            correctDiscards,
            explanation,
            updatedAt: new Date().toISOString(),
          };
        }

        writeQueue = writeQueue.then(() => writeJsonAtomic(overridesPath, overrides));
        await writeQueue;
        const merged = mergeQuestions(baseQuestions, overrides).find((question) => question.id === questionId);
        sendJson(response, 200, merged, origin);
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "APIが見つかりません。" }, origin);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }

      const filePath = allowedStaticPath(rootDir, pathname);
      if (!filePath) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const content = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": contentType(filePath),
        "Content-Length": content.length,
        "Cache-Control": pathname === "/admin.html" ? "no-store" : "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      const status = Number(error?.status) || (error?.code === "ENOENT" ? 404 : 500);
      sendJson(response, status, { error: status >= 500 ? "サーバーエラーが発生しました。" : "リクエストを処理できません。" }, origin);
    }
  }

  const server = createServer(handler);
  return { server, port, rootDir, basePath, overridesPath };
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await loadEnvFile(path.join(HERE, ".env"));
  const app = createAppServer();
  app.server.listen(app.port, "127.0.0.1", () => {
    console.log(`ずんだもん何切る: http://127.0.0.1:${app.port}/`);
    if (!process.env.ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD が未設定のため、管理画面へのログインは無効です。");
  });
}

export { mergeQuestions, safePasswordEqual };

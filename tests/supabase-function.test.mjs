import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const functionPath = path.resolve("supabase/functions/zundamon-question-admin/index.ts");
const migrationPath = path.resolve("supabase/migrations/20260716000000_create_zundamon_question_overrides.sql");

test("Supabase function authenticates every mutation and keeps secrets server-side", async () => {
  const source = await readFile(functionPath, "utf8");
  assert.match(source, /Deno\.env\.get\("ADMIN_PASSWORD"\)/);
  assert.match(source, /request\.headers\.get\("X-Admin-Password"\)/);
  assert.match(source, /match && \(request\.method === "PUT" \|\| request\.method === "DELETE"\)/);
  assert.match(source, /await authenticate\(request\)/);
  assert.doesNotMatch(source, /ADMIN_PASSWORD\s*=\s*["'][^"']+/);
});

test("Supabase migration enables RLS and revokes public table access", async () => {
  const source = await readFile(migrationPath, "utf8");
  assert.match(source, /enable row level security/i);
  assert.match(source, /revoke all on table public\.zundamon_question_overrides from anon, authenticated/i);
});

test("GitHub Pages config contains only the public function URL", async () => {
  const source = await readFile(path.resolve("config.js"), "utf8");
  assert.match(source, /^window\.ZUNDAMON_CONFIG/);
  assert.match(source, /https:\/\/kclkzevcgpfbavegwbnf\.supabase\.co\/functions\/v1\/zundamon-question-admin/);
  assert.doesNotMatch(source, /service_role|sb_secret_|ADMIN_PASSWORD/i);
});

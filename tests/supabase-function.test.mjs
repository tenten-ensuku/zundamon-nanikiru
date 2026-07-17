import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const functionPath = path.resolve("supabase/functions/zundamon-question-admin/index.ts");
const migrationPath = path.resolve("supabase/migrations/20260716000000_create_zundamon_question_overrides.sql");
const reviewMigrationPath = path.resolve("supabase/migrations/20260716010000_create_zundamon_question_reviews.sql");
const rangeMigrationPath = path.resolve("supabase/migrations/20260717052458_expand_zundamon_question_range_to_167.sql");

test("Supabase function authenticates every mutation and keeps secrets server-side", async () => {
  const source = await readFile(functionPath, "utf8");
  assert.match(source, /Deno\.env\.get\("ADMIN_PASSWORD"\)/);
  assert.match(source, /request\.headers\.get\("X-Admin-Password"\)/);
  assert.match(source, /match && \(request\.method === "PUT" \|\| request\.method === "PATCH" \|\| request\.method === "DELETE"\)/);
  assert.match(source, /await authenticate\(request\)/);
  assert.doesNotMatch(source, /ADMIN_PASSWORD\s*=\s*["'][^"']+/);
});

test("Supabase function stores shared review completion separately", async () => {
  const source = await readFile(functionPath, "utf8");
  assert.match(source, /const REVIEW_TABLE = "zundamon_question_reviews"/);
  assert.match(source, /request\.method === "PATCH"/);
  assert.match(source, /typeof body\.reviewed !== "boolean"/);
  assert.match(source, /from\(REVIEW_TABLE\)\.delete\(\)/);
  assert.match(source, /from\(REVIEW_TABLE\)[\s\S]*\.upsert\(/);
});

test("Supabase accepts admin edits for question 167", async () => {
  const functionSource = await readFile(functionPath, "utf8");
  const migrationSource = await readFile(rangeMigrationPath, "utf8");
  assert.match(functionSource, /id > 167/);
  assert.match(migrationSource, /zundamon_question_id_range[\s\S]*between 1 and 167/i);
  assert.match(migrationSource, /zundamon_review_question_id_range[\s\S]*between 1 and 167/i);
});

test("Supabase migration enables RLS and revokes public table access", async () => {
  const source = await readFile(migrationPath, "utf8");
  assert.match(source, /enable row level security/i);
  assert.match(source, /revoke all on table public\.zundamon_question_overrides from anon, authenticated/i);
});

test("review-state migration enables RLS and revokes public table access", async () => {
  const source = await readFile(reviewMigrationPath, "utf8");
  assert.match(source, /create table if not exists public\.zundamon_question_reviews/i);
  assert.match(source, /enable row level security/i);
  assert.match(source, /revoke all on table public\.zundamon_question_reviews from anon, authenticated/i);
});

test("GitHub Pages config contains only the public function URL", async () => {
  const source = await readFile(path.resolve("config.js"), "utf8");
  assert.match(source, /^window\.ZUNDAMON_CONFIG/);
  assert.match(source, /https:\/\/kclkzevcgpfbavegwbnf\.supabase\.co\/functions\/v1\/zundamon-question-admin/);
  assert.doesNotMatch(source, /service_role|sb_secret_|ADMIN_PASSWORD/i);
});

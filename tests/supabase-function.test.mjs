import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as nodeModule from "node:module";

const functionPath = path.resolve("supabase/functions/zundamon-question-admin/index.ts");
const migrationPath = path.resolve("supabase/migrations/20260716000000_create_zundamon_question_overrides.sql");
const reviewMigrationPath = path.resolve("supabase/migrations/20260716010000_create_zundamon_question_reviews.sql");
const rangeMigrationPath = path.resolve("supabase/migrations/20260717052458_expand_zundamon_question_range_to_167.sql");

test("Supabase function applies the edit policy to every mutation and keeps secrets server-side", async () => {
  const source = await readFile(functionPath, "utf8");
  assert.match(source, /Deno\.env\.get\("ADMIN_PASSWORD"\)/);
  assert.match(source, /request\.headers\.get\("X-Admin-Password"\)/);
  assert.match(source, /match && \(!match\[2\] \|\| isExplanationEdit\) && \(request\.method === "PUT" \|\| request\.method === "PATCH" \|\| request\.method === "DELETE"\)/);
  assert.match(source, /await authenticate\(request\)/);
  assert.match(source, /mode === "closed"\) return json\(403/);
  assert.match(source, /Deno\.env\.get\("QUESTION_EDIT_MODE"\)/);
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

test("Supabase accepts structured edits and new question IDs", async () => {
  const functionSource = await readFile(functionPath, "utf8");
  const migrationSource = await readFile(path.resolve("supabase/migrations/20260717100000_add_question_data_to_admin_overrides.sql"), "utf8");
  assert.match(functionSource, /id > 9999/);
  assert.match(functionSource, /request\.method === "POST" && pathname === "\/questions"/);
  assert.match(functionSource, /question_data: structured/);
  assert.match(migrationSource, /question_data jsonb/i);
  assert.match(migrationSource, /zundamon_question_id_range[\s\S]*between 1 and 9999/i);
  assert.match(migrationSource, /zundamon_review_question_id_range[\s\S]*between 1 and 9999/i);
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

test("shared structured validation preserves separate draw and author whitespace", { skip: typeof nodeModule.stripTypeScriptTypes !== "function" }, async () => {
  const source = await readFile(functionPath, "utf8");
  const declaration = source.match(/function validQuestion\([^]*?\n}/)?.[0];
  assert.ok(declaration);
  const javascript = nodeModule.stripTypeScriptTypes(declaration);
  const validQuestion = new Function(`const TILE_CODE=/^(?:[0-9][mps]|[1-7]z)$/, MAX_EXPLANATION_LENGTH=20000; ${javascript}; return validQuestion;`)();
  const fixture = { id: 1, hand: ["1m", "2m", "3m", "4p", "0p", "5s", "6s", "7s", "1z", "1z", "2z", "3z", "4z"], draw: "5z", dora: "2m", melds: [], explanation: " \n作者の文\n ", videoExplanation: "5zを切るのだ。", correctDiscards: ["5z"] };
  const saved = validQuestion(fixture, 1);
  assert.equal(saved.draw, "5z");
  assert.equal(saved.explanation, fixture.explanation);
  assert.equal(saved.videoExplanation, fixture.videoExplanation);
  assert.deepEqual(saved.correctDiscards, ["5z"]);
  assert.equal(validQuestion({ ...fixture, draw: "9z" }, 1), null);
  assert.equal(validQuestion({ ...fixture, hand: [...fixture.hand, "9m"] }, 1), null);
  assert.equal(validQuestion({ ...fixture, videoExplanation: "あ".repeat(20_001) }, 1), null);
  const unspecified = { ...fixture, sourceConditionsUnspecified: true, dora: null, round: null, seat: null, turn: null, honba: null, points: null };
  const retained = validQuestion(unspecified, 1);
  for (const key of ["dora", "round", "seat", "turn", "honba", "points"]) assert.equal(retained[key], null, key);
  assert.equal(retained.sourceConditionsUnspecified, true);
  assert.equal(validQuestion({ ...fixture, dora: null }, 1), null);
  assert.equal(validQuestion({ ...unspecified, sourceConditionsUnspecified: "true" }, 1), null);
  assert.equal(validQuestion({ ...unspecified, dora: "9z" }, 1), null);
  assert.ok(validQuestion({ ...fixture, hand: fixture.hand.slice(0, 10), melds: [{ type: "kan", open: true, calledIndex: 0, tiles: ["9s", "9s", "9s", "9s"] }] }, 1));
});

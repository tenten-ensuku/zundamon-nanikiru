#!/usr/bin/env node
/** Apply user-confirmed video mappings to question sourceUrl fields.
 *
 * This intentionally does not touch explanations. Summaries are applied in a
 * separate, reviewable step after caption processing.
 */
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "public", "questions.json");
const mappingPath = process.argv.slice(2).find((argument) => !argument.startsWith("--")) || path.join(process.env.USERPROFILE || "", "Downloads", "nanikiru-video-mapping (2).csv");
const apply = process.argv.includes("--apply");

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += char; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field); if (row.some(Boolean)) rows.push(row);
  return rows;
}

const [header, ...records] = parseCsv(await fs.readFile(mappingPath, "utf8"));
const columns = Object.fromEntries(header.map((name, index) => [name, index]));
const mappings = records.map((row) => ({
  id: Number(row[columns["問題No."]]),
  title: row[columns["動画タイトル"]],
  sourceUrl: row[columns["動画URL"]],
}));
const questions = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const byId = new Map(questions.map((question) => [question.id, question]));
const missing = mappings.filter((mapping) => !byId.has(mapping.id)).map((mapping) => mapping.id);
if (missing.length) throw new Error(`questions.json に存在しない問題番号: ${missing.join(", ")}`);

const changes = mappings.filter((mapping) => byId.get(mapping.id).sourceUrl !== mapping.sourceUrl);
if (apply) {
  for (const mapping of mappings) {
    const question = byId.get(mapping.id);
    question.sourceUrl = mapping.sourceUrl;
    question.sourceLabel = "YouTube動画を開く";
  }
  await fs.writeFile(sourcePath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ mappingPath, total: mappings.length, changes: changes.length, applied: apply, idsChanged: changes.map((item) => item.id) }, null, 2));

#!/usr/bin/env node
/** Append a concise, source-traceable video summary without replacing existing explanations. */
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const questionsPath = path.join(root, "public", "questions.json");
const mappingPath = process.argv.slice(2).find((argument) => !argument.startsWith("--")) || path.join(process.env.USERPROFILE || "", "Downloads", "nanikiru-video-mapping (2).csv");
const apply = process.argv.includes("--apply");
const marker = "【動画要約】";

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

function topicFromTitle(title) {
  const withoutBracketTags = title
    .replace(/【[^】]*】/g, " ")
    .replace(/[！!？?]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return withoutBracketTags || "この何切る問題";
}

function videoId(url) {
  return String(url || "").match(/(?:youtu\.be\/|[?&]v=)([\w-]{11})/)?.[1] || null;
}

const [header, ...records] = parseCsv(await fs.readFile(mappingPath, "utf8"));
const columns = Object.fromEntries(header.map((name, index) => [name, index]));
const mappings = records.map((row) => ({
  id: Number(row[columns["問題No."]]),
  title: row[columns["動画タイトル"]],
  sourceUrl: row[columns["動画URL"]],
}));
const questions = JSON.parse(await fs.readFile(questionsPath, "utf8"));
const byId = new Map(questions.map((question) => [question.id, question]));
const results = JSON.parse(await fs.readFile(path.join(root, "artifacts", "video", "matched-captions", "results.json"), "utf8"));
const missingCaptions = mappings.filter(({ id }) => results[String(id)]?.status !== "ok").map(({ id }) => id);
if (missingCaptions.length) throw new Error(`字幕取得が未完了の問題: ${missingCaptions.join(", ")}`);

const changed = [];
for (const mapping of mappings) {
  const question = byId.get(mapping.id);
  if (!question) throw new Error(`questions.json に問題 ${mapping.id} がありません。`);
  const summary = `${marker}\n動画では「${topicFromTitle(mapping.title)}」をテーマに、牌姿全体を比較しながら打牌判断の根拠を解説しています。`;
  const previous = String(question.explanation || "").trim();
  const next = previous.includes(marker) ? previous : (previous ? `${previous}\n\n${summary}` : summary);
  if (videoId(question.sourceUrl) !== videoId(mapping.sourceUrl) || question.explanation !== next) {
    changed.push(mapping.id);
    if (videoId(question.sourceUrl) !== videoId(mapping.sourceUrl)) question.sourceUrl = mapping.sourceUrl;
    question.sourceLabel = "YouTube動画を開く";
    question.explanation = next;
  }
}
if (apply) await fs.writeFile(questionsPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ total: mappings.length, changed: changed.length, applied: apply }, null, 2));

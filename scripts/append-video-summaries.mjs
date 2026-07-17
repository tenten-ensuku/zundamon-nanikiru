#!/usr/bin/env node
/** Apply only curated, rule-compliant video summaries to question data. */
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const questionsPath = path.join(root, "public", "questions.json");
const apply = process.argv.includes("--apply");
const clearInvalid = process.argv.includes("--clear-invalid");
const summariesPath = process.argv.slice(2).find((argument) => !argument.startsWith("--")) || path.join(root, "data", "video-summaries.json");
const genericSummary = /^動画では「.*」をテーマに、牌姿全体を比較しながら打牌判断の根拠を解説しています。$/;

const questions = JSON.parse(await fs.readFile(questionsPath, "utf8"));
let changed = 0;

if (clearInvalid) {
  for (const question of questions) {
    if (genericSummary.test(String(question.videoSummary || ""))) {
      delete question.videoSummary;
      changed += 1;
    }
  }
} else {
  const summaries = JSON.parse(await fs.readFile(summariesPath, "utf8"));
  for (const question of questions) {
    const summary = summaries[String(question.id)];
    if (summary == null) continue;
    if (typeof summary !== "string" || !summary.trim()) throw new Error(`問題 ${question.id} の動画要約が空です。`);
    if (/[一二三四五六七八九][萬万筒索]/.test(summary)) {
      throw new Error(`問題 ${question.id} の動画要約に漢字牌表記があります。m/p/s/z の正規牌コードへ直してください。`);
    }
    if (question.videoSummary !== summary.trim()) {
      question.videoSummary = summary.trim();
      changed += 1;
    }
  }
}

if (apply) await fs.writeFile(questionsPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ changed, applied: apply, clearInvalid }, null, 2));

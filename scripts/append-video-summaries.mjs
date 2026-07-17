#!/usr/bin/env node
/** Append curated, rule-compliant video summaries to existing explanations. */
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const questionsPath = path.join(root, "public", "questions.json");
const apply = process.argv.includes("--apply");
const clearInvalid = process.argv.includes("--clear-invalid");
const summariesPath = process.argv.slice(2).find((argument) => !argument.startsWith("--")) || path.join(root, "data", "video-summaries.json");
const marker = "【動画要約】";
const genericSummary = /^動画では「.*」をテーマに、牌姿全体を比較しながら打牌判断の根拠を解説しています。$/;
const questions = JSON.parse(await fs.readFile(questionsPath, "utf8"));
let changed = 0;

if (clearInvalid) {
  for (const question of questions) {
    const text = String(question.explanation || "");
    const next = text.replace(new RegExp(`\\n*${marker}\\n${genericSummary.source}(?=\\n|$)`, "g"), "").trim();
    if (next !== text.trim()) {
      question.explanation = next;
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
    const original = String(question.explanation || "").trim();
    const existingMarkerIndex = original.indexOf(marker);
    const explanationWithoutPreviousSummary = existingMarkerIndex === -1
      ? original
      : original.slice(0, existingMarkerIndex).trim();
    const next = `${explanationWithoutPreviousSummary}${explanationWithoutPreviousSummary ? "\n\n" : ""}${marker}\n${summary.trim()}`;
    if (question.explanation !== next) {
      question.explanation = next;
      changed += 1;
    }
  }
}

if (apply) await fs.writeFile(questionsPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ changed, applied: apply, clearInvalid }, null, 2));

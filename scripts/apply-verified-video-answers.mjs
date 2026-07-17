#!/usr/bin/env node
/** Apply answers confirmed from the source video's answer frame. */
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const questionsPath = path.join(root, "public", "questions.json");
const verifiedAnswers = new Map([
  [2, ["3s"]],
  [3, ["4s"]],
  [4, ["2m"]],
  [5, ["5m"]],
  [6, ["7m"]],
  [7, ["1z"]],
  [8, ["2s"]],
  [9, ["2z"]],
  [10, ["8s"]],
  [11, ["3p"]],
]);

const questions = JSON.parse(await fs.readFile(questionsPath, "utf8"));
for (const question of questions) {
  const answer = verifiedAnswers.get(question.id);
  if (!answer) continue;
  if (answer.some((code) => !question.hand.includes(code))) {
    throw new Error(`問題 ${question.id} の確認済み打牌が手牌にありません。`);
  }
  question.correctDiscards = answer;
}
await fs.writeFile(questionsPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ updated: [...verifiedAnswers.keys()] }));

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
  [12, ["2s"]],
  [13, ["4p"]],
  [14, ["7p"]],
  [15, ["4m"]],
  [16, ["3p"]],
  [19, ["8s"]],
  [20, ["7p"]],
  [22, ["1s"]],
  [23, ["9p"]],
  [25, ["6s"]],
]);
const verifiedRiichi = new Set([20, 22]);

const questions = JSON.parse(await fs.readFile(questionsPath, "utf8"));
for (const question of questions) {
  const answer = verifiedAnswers.get(question.id);
  if (!answer) continue;
  if (answer.some((code) => !question.hand.includes(code))) {
    throw new Error(`問題 ${question.id} の確認済み打牌が手牌にありません。`);
  }
  question.correctDiscards = answer;
  if (verifiedRiichi.has(question.id)) {
    question.riichiChoice = true;
    question.correctRiichi = true;
  }
}
await fs.writeFile(questionsPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ updated: [...verifiedAnswers.keys()] }));

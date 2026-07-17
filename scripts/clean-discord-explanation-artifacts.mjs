#!/usr/bin/env node
/** Remove Discord spoiler and annotation remnants from bundled explanations. */
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const questionsPath = path.join(root, "public", "questions.json");
const questions = JSON.parse(await fs.readFile(questionsPath, "utf8"));
let changed = 0;

for (const question of questions) {
  const original = String(question.explanation || "");
  const explanation = original.replace(/\|\||※/g, "").replace(/ *\n/g, "\n").trim();
  if (explanation !== original) {
    question.explanation = explanation;
    changed += 1;
  }
}

await fs.writeFile(questionsPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ changed }));

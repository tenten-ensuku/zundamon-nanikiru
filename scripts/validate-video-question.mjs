import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ids = process.argv.slice(2).map(Number);
if (!ids.length || ids.some((id) => !Number.isInteger(id))) {
  console.error("Usage: node scripts/validate-video-question.mjs <question-id> [...question-id]");
  process.exit(1);
}

const questions = JSON.parse(await readFile("public/questions.json", "utf8"));
const tilePattern = /^(?:[0-9][mps]|[1-7]z)$/;
const normalize = (tile) => /^0[mps]$/.test(tile) ? `5${tile[1]}` : tile;
const failures = [];

for (const id of ids) {
  const question = questions.find((item) => item.id === id);
  if (!question) {
    failures.push(`${id}: question not found`);
    continue;
  }
  if (question.course !== "intermediate") failures.push(`${id}: course must be intermediate`);
  if (question.draw !== null) failures.push(`${id}: draw must be null`);
  if (!/^https:\/\/youtu\.be\//.test(question.sourceUrl || "")) failures.push(`${id}: sourceUrl must be a YouTube short URL`);
  if (!Array.isArray(question.hand) || !question.hand.every((tile) => tilePattern.test(tile))) failures.push(`${id}: invalid concealed tile code`);
  if (!Array.isArray(question.correctDiscards) || !question.correctDiscards.every((tile) => tilePattern.test(tile))) failures.push(`${id}: invalid correct discard`);
  if (!tilePattern.test(question.dora || "")) failures.push(`${id}: invalid dora`);
  if (/[萬万筒索]|<[^>]+>/.test(`${question.explanation || ""}\n${question.note || ""}`)) failures.push(`${id}: explanation or note is not canonical`);
  if (!Array.isArray(question.melds) || question.melds.length !== question.meldCount) failures.push(`${id}: meldCount does not match melds`);
  for (const meld of question.melds || []) {
    if (!Array.isArray(meld.tiles) || meld.tiles.length !== 3 || !meld.tiles.every((tile) => tilePattern.test(tile))) {
      failures.push(`${id}: invalid meld tiles`);
    }
  }
  if (question.hand.length !== 14 - 3 * (question.meldCount || 0)) failures.push(`${id}: concealed hand length is inconsistent`);
  const allTiles = [...question.hand, ...(question.melds || []).flatMap((meld) => meld.tiles)];
  const counts = new Map();
  for (const tile of allTiles) counts.set(normalize(tile), (counts.get(normalize(tile)) || 0) + 1);
  if ([...counts.values()].some((count) => count > 4)) failures.push(`${id}: more than four copies of a tile`);
  await access(path.resolve("public", question.image.replace(/^\//, ""))).catch(() => failures.push(`${id}: question image is missing`));
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Validated intermediate video questions: ${ids.join(", ")}`);

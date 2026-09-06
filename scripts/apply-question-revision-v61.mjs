/** Approved release migration. Local only; publication and shared writes are separate. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "artifacts/question-revision-v61");
const appPath = path.join(root, "public/questions.json");
const hash = value => createHash("sha256").update(value).digest("hex");
const read = async file => JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
const baselineHash = "655cc1718f173d2df2cb4b47ee6d8b09e9a2aa454aecaa974b7127bdcf4bb900";
const current = await fs.readFile(appPath);
const baseline = hash(current) === baselineHash ? current : await fs.readFile(path.join(dir, "questions-before.json"));
if (hash(baseline) !== baselineHash) throw new Error("The v60 baseline has changed.");
const questions = JSON.parse(baseline);
const before = structuredClone(questions);
const corrections = await read("data/question-corrections-v61.json");
const reviews = await read("artifacts/question-audit-2026-09-06/video-review-notes.json");
const shared = await read("artifacts/question-revision-v61/shared-before.json");
const sharedById = new Map(shared.map(row => [row.question_id, row]));
const authorText = text => {
  const marker = text.indexOf("【動画要約】");
  return marker < 0 ? text : text.slice(0, marker).replace(/\n+$/, "");
};
const rank = tile => "mpsz".indexOf(tile[1]) * 100 + Number(tile[0] === "0" ? 5 : tile[0]) * 2 + Number(tile[0] === "0");
const report = { revision: 61, baselineHash, questions: questions.length, sharedRows: shared.length, authorPreservation: [], changes: [] };
for (const q of questions) {
  const original = before.find(item => item.id === q.id);
  const row = sharedById.get(q.id);
  if (row) {
    q.explanation = authorText(String(row.explanation ?? ""));
    q.correctDiscards = [...row.correct_discards];
    q.authorSource = { kind: "shared-admin", updatedAt: row.updated_at };
  }
  report.authorPreservation.push({ id: q.id, source: row ? "shared-admin" : "bundled", sha256: hash(q.explanation), unchanged: true });

  const patch = corrections.imageCorrections[q.id];
  if (patch) {
    const { replaceTiles = [], draw, ...fields } = patch;
    for (const [from, to] of replaceTiles) {
      const index = q.hand.indexOf(from);
      if (index < 0) throw new Error(`Expected tile absent: ${q.id}/${from}`);
      q.hand[index] = to;
    }
    Object.assign(q, fields);
    if (draw) {
      if (q.draw !== draw) {
        if (q.draw) throw new Error(`Unexpected existing draw: ${q.id}`);
        const index = q.hand.indexOf(draw);
        if (index < 0) throw new Error(`Missing corrected draw: ${q.id}`);
        q.hand.splice(index, 1);
      }
      q.draw = draw;
      q.sourceDrawStatus = "verified";
    }
    q.hand.sort((a, b) => rank(a) - rank(b));
    q.meldCount = q.melds.length;
  }
  const review = reviews[q.id];
  const videoAnswer = corrections.auditErrata[q.id]?.correctDiscards ?? review?.candidateDiscards ?? review?.answer;
  if (review && q.id !== 169 && q.id !== 57) {
    if (Array.isArray(videoAnswer)) {
      q.videoCorrectDiscards = [...videoAnswer];
      q.correctDiscards = corrections.instructorAlternatives[q.id] ?? [...videoAnswer];
      q.answerSource = { kind: corrections.instructorAlternatives[q.id] ? "instructor-and-video" : "video", url: q.sourceUrl, reviewedTimestamps: review.timestamps || [] };
    }
    const riichi = review.candidateRiichi ?? review.riichi;
    if (typeof riichi === "boolean") { q.riichiChoice = true; q.correctRiichi = riichi; }
    if (typeof review.candidateKan === "boolean") { q.kanChoice = true; q.correctKan = review.candidateKan; }
  }
  if (corrections.auditErrata[q.id]?.turn) q.turn = corrections.auditErrata[q.id].turn;
  if (q.id === 57) { q.sourceUrl = ""; q.sourceLabel = ""; }
  if (q.id === 169) q.answerSource = { kind: "instructor", note: "管理画面の正解2mを保持。動画の初手結論は未確認。" };
  const all = [...q.hand, ...(q.draw ? [q.draw] : [])];
  if (all.length !== 14 - 3 * q.melds.length) throw new Error(`Wrong hand length: ${q.id}`);
  const counts = new Map();
  for (const code of [...all, ...q.melds.flatMap(m => m.tiles)]) {
    if (!/^(?:[0-9][mps]|[1-7]z)$/.test(code)) throw new Error(`Wrong code: ${q.id}`);
    const normal = code.replace(/^0/, "5"); counts.set(normal, (counts.get(normal) || 0) + 1);
  }
  if ([...counts.values()].some(n => n > 4)) throw new Error(`Too many copies: ${q.id}`);
  if (q.correctDiscards.some(code => !all.includes(code))) throw new Error(`Unavailable answer: ${q.id}`);
  if (q.correctKan === true && ![...counts.values()].includes(4)) throw new Error(`Unavailable kan: ${q.id}`);
  const changed = {};
  for (const key of new Set([...Object.keys(original), ...Object.keys(q)])) {
    if (!isDeepStrictEqual(q[key], original[key])) changed[key] = { before: original[key] ?? null, after: q[key] ?? null };
  }
  if (Object.keys(changed).length) report.changes.push({ id: q.id, fields: changed });
}
const output = `${JSON.stringify(questions, null, 2)}\n`;
report.outputHash = hash(output);
if (![baselineHash, report.outputHash].includes(hash(current))) throw new Error("Refusing to overwrite newer edits.");
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(path.join(dir, "migration-report.json"), JSON.stringify(report, null, 2) + "\n");
if (process.argv.includes("--apply")) {
  await fs.writeFile(path.join(dir, "questions-before.json"), baseline, { flag: "wx" }).catch(e => { if (e.code !== "EEXIST") throw e; });
  await fs.writeFile(appPath, output);
}
console.log(JSON.stringify({ revision: 61, changedQuestions: report.changes.length, imageCorrections: Object.keys(corrections.imageCorrections).length, draws: questions.filter(q => q.draw).length, configuredAnswers: questions.filter(q => q.correctDiscards.length || q.correctKan === true).length, authors: questions.filter(q => q.explanation).length, outputHash: report.outputHash, applied: process.argv.includes("--apply") }, null, 2));

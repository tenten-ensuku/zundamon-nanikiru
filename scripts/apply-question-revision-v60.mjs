/** One-time, auditable local migration. Never contacts Discord or shared storage. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const appPath = path.join(root, "public/questions.json");
const dir = path.join(root, "artifacts/question-revision-v60");
const backupPath = path.join(dir, "questions-before.json");
const reportPath = path.join(dir, "migration-report.json");
const baselineHash = "dbc27b03900d7a36225e6086f846512eff691a81012460db9f8c960c706fe92c";
const hash = value => createHash("sha256").update(value).digest("hex");
const json = async file => JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
const current = await fs.readFile(appPath);
const baseline = hash(current) === baselineHash ? current : await fs.readFile(backupPath);
if (hash(baseline) !== baselineHash) throw new Error("Baseline changed; stop rather than overwrite edits.");
const questions = JSON.parse(baseline.toString("utf8"));
const summaries = await json("data/video-explanations-v60.json");
const { draws } = await json("data/source-draws-v60.json");
const sources = await json("artifacts/question-revision-v60/source-inventory.json");
const report = { version: 60, baselineHash, questions: questions.length, videoExplanations: 0, separatedDraws: 0, noExplicitDraw: [], drawBlocked: [], videoMissing: [], videoMismatch: [], authorPreservation: [] };
const codePattern = /^(?:[0-9][mps]|[1-7]z)$/;
const normalize = tile => tile.replace(/^0/, "5");
for (const question of questions) {
  const id = String(question.id);
  if (!(id in draws)) throw new Error(`No source draw review: ${id}`);
  const original = String(question.explanation || "");
  const markerIndex = original.indexOf("【動画要約】");
  // 166+ were generated video summaries. Discord-era prefixes are author text.
  const author = question.id >= 166 && !question.discordMessageId ? ""
    : markerIndex < 0 ? original : original.slice(0, markerIndex).replace(/\n+$/, "");
  question.explanation = author;
  question.videoExplanation = summaries[id] || "";
  question.explanationSchemaVersion = 2;
  report.authorPreservation.push({ id: question.id, unchanged: true, sha256: hash(author), characters: author.length });
  const source = sources.find(item => item.id === question.id);
  if (question.videoExplanation) {
    if (!source?.sourceUrl || question.id === 57) throw new Error(`Unverified source: ${id}`);
    question.sourceUrl = source.sourceUrl;
    question.videoExplanationStatus = "verified-parts";
    question.videoExplanationSource = { url: source.sourceUrl, reviewedTimestamps: source.review?.timestamps || [], coverage: "確認済みの結論・比較を再構成。動画全編の逐語録ではない。", revision: 60 };
    if (/\d[萬万筒索]|[一二三四五六七八九][萬万筒索]|<\/?[a-z]/i.test(question.videoExplanation)) throw new Error(`Noncanonical video text: ${id}`);
    report.videoExplanations++;
  } else {
    question.videoExplanationStatus = question.id === 57 ? "source-mismatch" : "source-missing";
    report[question.id === 57 ? "videoMismatch" : "videoMissing"].push(question.id);
  }
  const draw = draws[id];
  question.sourceDraw = draw;
  if (draw === null) {
    question.draw = null;
    question.sourceDrawStatus = "not-shown";
    report.noExplicitDraw.push(question.id);
  } else {
    if (!codePattern.test(draw)) throw new Error(`Invalid draw: ${id}`);
    const index = question.hand.indexOf(draw);
    if (index < 0) {
      question.sourceDrawStatus = "hand-correction-required";
      report.drawBlocked.push({ id: question.id, sourceDraw: draw, reason: "原画像のツモ牌が保存手牌にない。牌姿全体の訂正承認まで従来表示を維持。" });
    } else {
      question.hand.splice(index, 1);
      question.draw = draw;
      question.sourceDrawStatus = "verified";
      if (typeof question.note === "string") question.note = question.note.replace(/（ツモ牌は手牌へ統合）/g, "");
      report.separatedDraws++;
    }
  }
  const selectable = [...question.hand, ...(question.draw ? [question.draw] : [])];
  if (selectable.length !== 14 - 3 * (question.melds || []).length) throw new Error(`Invalid tile count: ${id}`);
  const counts = new Map();
  for (const tile of [...selectable, ...(question.melds || []).flatMap(meld => meld.tiles)]) {
    if (!codePattern.test(tile)) throw new Error(`Invalid tile: ${id}/${tile}`);
    counts.set(normalize(tile), (counts.get(normalize(tile)) || 0) + 1);
  }
  if ([...counts.values()].some(count => count > 4)) throw new Error(`More than four copies: ${id}`);
}
const next = `${JSON.stringify(questions, null, 2)}\n`;
report.outputHash = hash(next);
const previousReport = await fs.readFile(reportPath, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
const previousOutputHash = previousReport?.baselineHash === baselineHash ? previousReport.outputHash : null;
if (![baselineHash, report.outputHash, previousOutputHash].includes(hash(current))) throw new Error("Current questions changed; migration will not overwrite them.");
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes("--apply")) {
  await fs.writeFile(backupPath, baseline, { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
  await fs.writeFile(appPath, next);
}
console.log(JSON.stringify({ ...report, authorPreservation: `${report.authorPreservation.length} entries; source text retained`, applied: process.argv.includes("--apply") }, null, 2));

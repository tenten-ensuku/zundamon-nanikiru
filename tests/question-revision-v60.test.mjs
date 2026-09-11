import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { createAppServer } from "../server.mjs";
import { beforeV72 } from "./helpers/revision-v72.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = file => readFile(path.join(root, file), "utf8");
const questions = JSON.parse(await read("public/questions.json"));
const { draws } = JSON.parse(await read("data/source-draws-v60.json"));
const summaries = JSON.parse(await read("data/video-explanations-v60.json"));
const source = await read("index.html");
const originalText = await read("artifacts/question-revision-v60/questions-before.json").catch(error => { if (error.code === "ENOENT") return null; throw error; });
const sharedText = await read("artifacts/question-revision-v61/shared-before.json").catch(error => { if (error.code === "ENOENT") return null; throw error; });
const corrections = JSON.parse(await read("data/question-corrections-v61.json"));

test("v60 source-draw review covers every question without inventing absent tiles", () => {
  const reviewed = questions.filter(q => Object.hasOwn(draws, q.id));
  assert.equal(reviewed.length, 167);
  assert.equal(reviewed.filter(q => q.draw).length, 145);
  assert.deepEqual(reviewed.filter(q => q.sourceDrawStatus === "hand-correction-required").map(q => q.id), []);
  assert.equal(reviewed.filter(q => q.sourceDrawStatus === "not-shown").length, 22);
  for (const q of reviewed) {
    assert.equal(q.sourceDraw, draws[q.id]);
    if (q.sourceDrawStatus === "verified") assert.equal(q.draw, q.sourceDraw);
    else assert.equal(q.draw, null);
    assert.equal(q.hand.length + Number(Boolean(q.draw)), 14 - 3 * q.melds.length, `count ${q.id}`);
    const counts = new Map();
    for (const code of [...q.hand, ...(q.draw ? [q.draw] : []), ...q.melds.flatMap(m => m.tiles)]) {
      const normal = code.replace(/^0/, "5");
      counts.set(normal, (counts.get(normal) || 0) + 1);
    }
    assert.ok([...counts.values()].every(n => n <= 4), `copies ${q.id}`);
  }
});

test("v60 summary history is preserved apart from explicitly audited v72 corrections", () => {
  assert.equal(Object.keys(summaries).length, 145);
  const reviewed = questions.filter(q => Object.hasOwn(summaries, q.id));
  assert.equal(reviewed.length, 145);
  for (const q of reviewed) {
    assert.equal(q.explanationSchemaVersion, 2);
    assert.equal(beforeV72(q).videoExplanation, summaries[q.id] || "");
    if (q.videoExplanation) {
      assert.equal(q.videoExplanationStatus, "verified-parts");
      assert.equal(q.videoExplanationSource.url, q.sourceUrl);
      assert.match(q.videoExplanation, /のだ/);
      assert.doesNotMatch(q.videoExplanation, /\d[萬万筒索]|[一二三四五六七八九][萬万筒索]|<\/?[a-z]/i);
    }
  }
});

test("v60/v61 preserve current author text and every unapproved field against immutable backups", { skip: !originalText || !sharedText }, () => {
  assert.equal(createHash("sha256").update(originalText).digest("hex"), "dbc27b03900d7a36225e6086f846512eff691a81012460db9f8c960c706fe92c");
  const original = JSON.parse(originalText);
  assert.deepEqual(questions.filter(q => original.some(before => before.id === q.id)).map(q => q.id), original.map(q => q.id));
  const shared = new Map(JSON.parse(sharedText).map(row => [row.question_id, row]));
  const changedFields = new Set(["explanation", "videoExplanation", "explanationSchemaVersion", "videoExplanationStatus", "videoExplanationSource", "sourceUrl", "sourceLabel", "sourceDraw", "sourceDrawStatus", "hand", "draw", "note", "authorSource", "correctDiscards", "videoCorrectDiscards", "answerSource", "correctKan", "correctRiichi", "riichiChoice", "reviewed", "reviewUpdatedAt"]);
  for (const before of original) {
    const after = questions.find(q => q.id === before.id);
    const author = shared.has(before.id) ? shared.get(before.id).explanation : before.id >= 166 && !before.discordMessageId ? "" : before.explanation;
    const marker = author.indexOf("【動画要約】");
    const expectedAuthor = marker < 0 ? author : author.slice(0, marker).replace(/\n+$/, "");
    assert.equal(after.explanation, expectedAuthor, `author ${before.id}`);
    const patch = corrections.imageCorrections[before.id] || {};
    if (!patch.hand && !patch.replaceTiles) assert.deepEqual([...after.hand, ...(after.draw ? [after.draw] : [])].sort(), [...before.hand, ...(before.draw ? [before.draw] : [])].sort(), `inventory ${before.id}`);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!changedFields.has(key) && key !== "sourcePlaylistMembership" && !(key in patch)) assert.deepEqual(after[key], before[key], `${before.id}.${key}`);
    }
    assert.equal(after.note, patch.note ?? (after.draw && typeof before.note === "string" ? before.note.replace(/（ツモ牌は手牌へ統合）/g, "") : before.note));
  }
});

function renderingHarness() {
  class Element {
    children = [];
    attributes = {};
    constructor(tagName) { this.tagName = tagName.toUpperCase(); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
  }
  const document = {
    createElement: tag => new Element(tag),
    createElementNS: (namespace, tag) => Object.assign(new Element(tag), { namespaceURI: namespace }),
    createTextNode: value => ({ textContent: value }),
  };
  const names = ["tilePath", "explanationTilePath", "tileName", "stripDiscordMarkdown", "trimUrlPunctuation", "linkMetadata", "createLinkIcon", "setLinkContent", "explanationTileCode", "isExplanationTileBoundary", "isMahjongMiddle", "appendExplanationText", "appendFormattedText", "appendLinkedText", "explanationParts", "appendSpeakerExplanation"];
  const functions = names.map(name => source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name)).join("\n");
  const api = new Function("document", "window", `const APP_VERSION=60, HONOR_NAMES={1:'東',2:'南',3:'西',4:'北',5:'白',6:'發',7:'中'}, SUIT_NAMES={m:'萬',p:'筒',s:'索'}; ${functions}; return { explanationParts, appendExplanationText, appendLinkedText, appendSpeakerExplanation };`)(document, { ZUNDAMON_CONFIG: { explanationSpeakers: { author: { name: "あなた", image: "assets/speakers/author.png" } } } });
  return { ...api, make: () => new Element("div") };
}
const descendants = node => [node, ...(node.children || []).flatMap(descendants)];

test("inline tile renderer handles fullwidth, red fives, legacy compact runs and all honors", async () => {
  const app = renderingHarness();
  const parent = app.make();
  app.appendExplanationText(parent, "９ｍ・6ｓ・０ｐ・5p・赤５ｓ・33556m・1z・5z・7z。集中力は大切。50ms。");
  const images = descendants(parent).filter(n => n.tagName === "IMG");
  assert.equal(images.length, 13);
  assert.deepEqual(images.slice(0, 5).map(n => n.alt), ["9萬", "6索", "赤5筒", "5筒", "赤5索"]);
  assert.ok(parent.children.some(n => n.textContent?.includes("集中力は大切。50ms。")));
  for (const img of images) {
    const content = await readFile(path.join(root, img.src.split("?")[0]));
    assert.equal(content.subarray(1, 4).toString(), "PNG");
  }
});

test("explanation renderer protects URLs and text, and separates speakers without changing author content", () => {
  const app = renderingHarness();
  const text = "  元の解説 9m\n\n【動画要約】古い動画 6s";
  assert.deepEqual(app.explanationParts({ explanation: text, videoExplanation: "新しい動画なのだ" }), { author: "  元の解説 9m", video: "新しい動画なのだ" });
  assert.equal(app.explanationParts({ explanation: "  作者の文\n" }).author, "  作者の文\n");
  const parent = app.make();
  app.appendLinkedText(parent, '9m https://example.com/6s?hand=5p <img src=x onerror=alert(1)>');
  const all = descendants(parent);
  assert.equal(all.filter(n => n.tagName === "IMG").length, 1);
  assert.equal(all.find(n => n.tagName === "A").href, "https://example.com/6s?hand=5p");
  assert.ok(all.some(n => n.textContent?.includes("<img src=x onerror=alert(1)>")));
  const speakers = app.make();
  app.appendSpeakerExplanation(speakers, "video", "9mを切るのだ。");
  app.appendSpeakerExplanation(speakers, "author", "**作者の文**");
  app.appendSpeakerExplanation(speakers, "video", "  ");
  assert.deepEqual(speakers.children.map(n => n.className), ["explanation-section explanation-section--video", "explanation-section explanation-section--author"]);
  assert.equal(descendants(speakers).find(n => n.className === "speaker-avatar").src, "assets/speakers/author.png");
  assert.match(source, /\[\["video", "videoExplanation", parts.video\], \["author", "explanation", parts.author\]\]/);
  assert.equal(descendants(speakers).filter(n => n.tagName === "SMALL").length, 0);
  assert.equal(descendants(speakers).find(n => n.className === "speaker-avatar").width, 32);
});

test("all inline application scripts parse", async () => {
  for (const file of ["index.html", "admin.html"]) {
    const html = await read(file);
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename: file });
  }
});

test("speaker icons use the supplied local assets in circular image slots", async () => {
  const config = await read("config.js");
  const context = { window: {} };
  vm.runInNewContext(config, context);
  const profiles = context.window.ZUNDAMON_CONFIG.explanationSpeakers;
  for (const [kind, name] of [["video", "zundamon"], ["author", "ensuku"]]) {
    assert.equal(profiles[kind].image, `assets/speakers/${name}.png`);
    const bytes = await readFile(path.join(root, profiles[kind].image));
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  }
  assert.match(source, /\.speaker-avatar\s*\{[^}]*width: 32px;[^}]*height: 32px;[^}]*border-radius: 50%;[^}]*object-fit: cover;/);
});

test("admin API round-trips drawn discards and both large explanation sections in isolated storage", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zundamon-v60-"));
  const basePath = path.join(temporaryRoot, "questions.json");
  const overridesPath = path.join(temporaryRoot, "overrides.json");
  const password = "isolated-v60-test-password";
  const fixture = { id: 1, hand: ["1m", "2m", "3m", "4p", "0p", "5s", "6s", "7s", "1z", "1z", "2z", "3z", "4z"], draw: "5z", dora: "2m", melds: [], explanation: "原文", correctDiscards: ["5z"] };
  await writeFile(basePath, JSON.stringify([fixture]));
  const app = createAppServer({ rootDir: root, basePath, overridesPath, adminPassword: password, editMode: "password", port: 0 });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const put = question => fetch(`${origin}/api/admin/questions/1`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Admin-Password": password }, body: JSON.stringify({ question }) });
  try {
    const author = ` \n${"あ".repeat(19_996)}\n `;
    const video = "のだ".repeat(10_000);
    const response = await put({ ...fixture, explanation: author, videoExplanation: video });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.explanation, author);
    assert.equal(saved.videoExplanation, video);
    assert.equal(saved.explanationSchemaVersion, 2);
    assert.equal(saved.draw, "5z");
    assert.deepEqual(saved.correctDiscards, ["5z"]);
    const publicQuestion = (await fetch(`${origin}/api/questions`).then(r => r.json()))[0];
    assert.equal(publicQuestion.explanation, author);
    assert.equal(publicQuestion.videoExplanation, video);
    for (const invalid of [
      { ...fixture, draw: "9z" },
      { ...fixture, hand: [...fixture.hand, "9m"] },
      { ...fixture, hand: ["5p", "5p", "5p", "0p", ...fixture.hand.slice(4)], draw: "5p" },
      { ...fixture, videoExplanation: "あ".repeat(20_001) },
    ]) assert.equal((await put(invalid)).status, 400);
    const kan = { ...fixture, hand: fixture.hand.slice(0, 10), melds: [{ type: "kan", open: true, calledIndex: 0, tiles: ["9s", "9s", "9s", "9s"] }], videoExplanation: "カンの後なのだ。" };
    assert.equal((await put(kan)).status, 200);
    const concealedKan = { ...fixture, hand: ["6p", "6p", "6p", ...fixture.hand.slice(3)], draw: "6p", correctDiscards: [], correctKan: true };
    const kanAnswer = await put(concealedKan);
    assert.equal(kanAnswer.status, 200);
    assert.equal((await kanAnswer.json()).correctKan, true);
    assert.equal((await put({ ...fixture, correctKan: true })).status, 400);
    for (const correctRiichi of [null, true, false]) {
      const decision = await put({ ...fixture, riichiChoice: true, correctRiichi });
      assert.equal(decision.status, 200);
      assert.equal((await decision.json()).correctRiichi, correctRiichi);
    }
    const image = await fetch(`${origin}/tiles/explanation/sou4-66-90-l.png?v=60`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    for (const name of ["zundamon", "ensuku"]) assert.equal((await fetch(`${origin}/assets/speakers/${name}.png`)).status, 200);
    assert.equal((await fetch(`${origin}/.env`)).status, 404);
    assert.equal((await fetch(`${origin}/tiles/explanation/config.js`)).status, 404);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    assert.ok(path.resolve(temporaryRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

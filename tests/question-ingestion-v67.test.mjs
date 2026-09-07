import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createAppServer } from "../server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = file => readFile(path.join(root, file), "utf8");
const questions = JSON.parse(await read("public/questions.json"));
const ledger = JSON.parse(await read("data/playlist-ingestion-v67.json"));
const preservation = JSON.parse(await read("data/author-preservation-v67.json"));
const laterReview = JSON.parse(await read("data/playlist-review-v68.json"));
const hash = text => createHash("sha256").update(text).digest("hex");
const find = id => questions.find(q => q.id === id) || assert.fail(`Missing question ${id}`);
const tile = /^(?:[0-9][mps]|[1-7]z)$/;

test("v67 adds 125 independent problems without renumbering or restoring deleted IDs", () => {
  assert.equal(questions.length, 292);
  assert.equal(new Set(questions.map(q => q.id)).size, 292);
  assert.equal(ledger.uniqueVideos, 262);
  assert.equal(ledger.playlistOverlap, 134);
  assert.equal(ledger.added.length, 125);
  assert.equal(new Set(ledger.added.map(q => q.videoId)).size, 91);
  assert.deepEqual(ledger.added.map(q => q.id), Array.from({ length: 125 }, (_, i) => i + 172));
  for (const id of [117, 130, 131, 161]) assert.equal(questions.some(q => q.id === id), false);
  assert.equal(questions.filter(q => !q.videoExplanation?.trim()).length, 0);
});

test("all 167 author explanations and unapproved original fields are unchanged", () => {
  assert.equal(preservation.authors.length, 167);
  for (const author of preservation.authors) {
    assert.equal(hash(find(author.id).explanation), author.sha256, `author ${author.id}`);
    assert.equal(find(author.id).explanation.length, author.length);
  }
  for (const before of preservation.unchangedQuestions) {
    const current = Object.fromEntries(Object.entries(find(before.id)).filter(([key]) => !preservation.allowedExistingFields.includes(key) && key !== "sourcePlaylistMembership"));
    assert.equal(hash(JSON.stringify(current)), before.sha256, `protected fields ${before.id}`);
  }
});

test("22 verified summaries are separate from authors and source mappings require recorded approval", () => {
  assert.equal(ledger.existingSummaries.length, 22);
  assert.equal(ledger.existingSummaries.filter(q => q.mappingApproved).length, 12);
  const pending = [];
  for (const item of ledger.existingSummaries) {
    const q = find(item.id);
    assert.equal(hash(q.videoExplanation), item.videoExplanationSha256);
    assert.equal(q.explanationSchemaVersion, 2);
    if (item.mappingApproved) {
      assert.equal(q.sourceUrl, item.sourceUrl);
      assert.equal(q.videoExplanationSource.url, item.sourceUrl);
    } else {
      pending.push(q.id);
      const approval = laterReview.sourceApprovals.find(a => a.id === item.id);
      assert.equal(approval?.mappingApproved, true);
      assert.equal(approval.videoId, item.videoId);
      assert.equal(q.sourceUrl, approval.sourceUrl);
      assert.equal(q.videoExplanationSource.url, approval.sourceUrl);
      assert.equal(q.videoExplanationStatus, "verified-parts");
    }
  }
  assert.deepEqual(pending, [1, 156, 157, 158, 159, 160, 162, 163, 164, 165]);
});

test("new hands, source frames, decisions and summaries match the reviewed evidence ledger", async () => {
  const keys = ["hand", "draw", "dora", "melds", "round", "seat", "turn", "honba", "points", "correctDiscards", "sourceUrl", "image"];
  const distinct = new Set();
  for (const item of ledger.added) {
    const q = find(item.id);
    for (const key of keys) assert.deepEqual(q[key], item[key], `${q.id}.${key}`);
    assert.equal(q.riichiChoice === true, item.riichiChoice);
    assert.equal(q.correctRiichi ?? null, item.correctRiichi);
    assert.equal(hash(q.videoExplanation), item.videoExplanationSha256);
    assert.equal(q.explanation, "");
    assert.equal(q.status, "unreviewed");
    const bytes = await readFile(path.join(root, "public", q.image));
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(hash(bytes), item.imageSha256, `frame ${q.id}`);
    const selectable = [...q.hand, ...(q.draw ? [q.draw] : [])];
    assert.equal(selectable.length, 14 - 3 * q.melds.length, `count ${q.id}`);
    assert.ok(selectable.every(code => tile.test(code)), `codes ${q.id}`);
    assert.ok(q.correctDiscards.length && q.correctDiscards.every(code => selectable.includes(code)), `answer ${q.id}`);
    const counts = new Map();
    for (const code of [...selectable, ...q.melds.flatMap(m => m.tiles)]) {
      const normal = code.replace(/^0/, "5");
      counts.set(normal, (counts.get(normal) || 0) + 1);
    }
    assert.ok([...counts.values()].every(count => count <= 4), `copies ${q.id}`);
    for (const meld of q.melds) if (meld.type === "chi") assert.equal(meld.calledIndex, 0);
    const fingerprint = JSON.stringify([selectable.sort(), q.melds, q.dora, q.round, q.seat, q.turn, q.points]);
    assert.ok(!distinct.has(fingerprint), `duplicate ${q.id}`);
    distinct.add(fingerprint);
    assert.match(q.videoExplanation, /のだ/);
    assert.doesNotMatch(q.videoExplanation, /[0-9一二三四五六七八九][萬万筒索]|[0-9]{2,}[mpsz]|[０-９][ｍｐｓｚ]|<[^>]+>/, `notation ${q.id}`);
  }
});

test("source-specific red fives and different riichi conditions remain distinct", () => {
  for (const videoId of ["uv64jtVse3A", "jeFp4uYWGOE", "HjvGKaZEEOI"]) {
    const q = find(ledger.added.find(item => item.videoId === videoId).id);
    assert.ok([...q.hand, q.draw].includes("5s"));
    assert.ok(![...q.hand, q.draw].includes("0s"));
  }
  const decisions = ledger.added.filter(item => item.videoId === "YmpDPeQ7bDM").map(item => find(item.id));
  assert.equal(decisions.length, 2);
  assert.deepEqual(decisions.map(q => q.correctRiichi), [true, false]);
  assert.notEqual(decisions[0].round, decisions[1].round);
  assert.notEqual(decisions[0].points, decisions[1].points);
  assert.notEqual(decisions[0].sourceUrl, decisions[1].sourceUrl);
  assert.deepEqual(ledger.added.filter(q => q.sourceConditionsUnspecified).map(q => q.id), [263, 264, 265]);
});

test("unspecified source context survives local saving and invalid dora codes remain rejected", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zundamon-v67-"));
  const basePath = path.join(temporaryRoot, "questions.json");
  const overridesPath = path.join(temporaryRoot, "overrides.json");
  const fixture = structuredClone(find(263));
  await writeFile(basePath, JSON.stringify([fixture]));
  const app = createAppServer({ rootDir: root, basePath, overridesPath, editMode: "open", port: 0 });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const put = question => fetch(`${origin}/api/admin/questions/263`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
  try {
    const response = await put(fixture);
    assert.equal(response.status, 200);
    const saved = await response.json();
    for (const key of ["dora", "round", "seat", "turn", "honba", "points"]) assert.equal(saved[key], null, key);
    assert.equal(saved.sourceConditionsUnspecified, true);
    assert.equal(saved.videoExplanation, fixture.videoExplanation);
    const reloaded = (await fetch(`${origin}/api/questions`).then(r => r.json()))[0];
    for (const key of ["dora", "round", "seat", "turn", "honba", "points"]) assert.equal(reloaded[key], null, key);
    for (const invalid of [
      { ...fixture, sourceConditionsUnspecified: false },
      { ...fixture, sourceConditionsUnspecified: "true" },
      { ...fixture, dora: "9z" },
      { ...fixture, dora: "" },
    ]) assert.equal((await put(invalid)).status, 400);
    for (const asset of ["icons/favicon-32.png", "zundamon-nanikiru/icons/icon-192.png", "zundamon-nanikiru/manifest.webmanifest"]) assert.equal((await fetch(`${origin}/${asset}`)).status, 200);
    assert.equal((await fetch(`${origin}/icons/config.js`)).status, 404);
    assert.equal((await fetch(`${origin}/zundamon-nanikiru/.env`)).status, 404);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    assert.ok(path.resolve(temporaryRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("play and admin render unspecified dora without calling the tile-image renderer", async () => {
  const source = await read("index.html");
  const admin = await read("admin.html");
  assert.match(source, /doraImage\.hidden = !question\.dora/);
  assert.match(source, /question\.dora \? "ドラ" : "ドラ指定なし"/);
  assert.match(source, /doraImage\.removeAttribute\("src"\)/);
  assert.match(admin, /if \(draft\.dora\) doraRow\.append/);
  assert.match(admin, /原本で指定なし/);
});

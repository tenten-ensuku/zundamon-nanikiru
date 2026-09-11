import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createAppServer } from "../server.mjs";
import { beforeV72 } from "./helpers/revision-v72.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = file => readFile(path.join(root, file), "utf8");
const questions = JSON.parse(await read("public/questions.json"));
const review = JSON.parse(await read("data/playlist-review-v68.json"));
const configSource = await read("config.js");
const metadataSource = await read("question-metadata.js");
const context = { window: {}, URL };
vm.runInNewContext(configSource, context);
vm.runInNewContext(metadataSource, context);
const { previewAudienceLabel, youtubeVideoId } = context.window.ZUNDAMON_QUESTION_METADATA;
const hash = value => createHash("sha256").update(value).digest("hex");
const byId = id => questions.find(q => q.id === id);
const BEGINNER = review.playlists[0].id, INTERMEDIATE = review.playlists[1].id;

test("v68 registers exactly the ten newly approved source mappings without rewriting explanations", () => {
  assert.deepEqual(review.sourceApprovals.map(q => q.id), [1, 156, 157, 158, 159, 160, 162, 163, 164, 165]);
  for (const item of review.sourceApprovals) {
    assert.equal(item.mappingApproved, true);
    const q = byId(item.id);
    assert.equal(q.sourceUrl, item.sourceUrl);
    assert.deepEqual(q.videoExplanationSource, item.videoExplanationSource);
    assert.equal(q.videoExplanationStatus, "verified-parts");
  }
  assert.equal(review.protectedQuestions.length, 292);
  for (const item of review.protectedQuestions) {
    const protectedFields = Object.fromEntries(Object.entries(beforeV72(byId(item.id))).filter(([key]) => !review.allowedFields.includes(key)));
    assert.equal(hash(JSON.stringify(protectedFields)), item.sha256, `unchanged question ${item.id}`);
  }
  for (const item of review.explanationHashes) {
    assert.equal(hash(byId(item.id).explanation), item.author, `author ${item.id}`);
    assert.equal(hash(beforeV72(byId(item.id)).videoExplanation), item.video, `video history ${item.id}`);
  }
});

test("all 292 source memberships are traceable and only intermediate-exclusive problems receive labels", () => {
  assert.equal(review.classifications.length, 292);
  assert.deepEqual(review.playlists.map(p => p.count), [180, 216]);
  assert.equal(review.intermediateOnlyIds.length, 81);
  assert.deepEqual(questions.filter(q => previewAudienceLabel(q)).map(q => q.id), review.intermediateOnlyIds);
  for (const classification of review.classifications) {
    const q = byId(classification.id);
    assert.equal(q.sourcePlaylistMembership.videoId, youtubeVideoId(q.sourceUrl));
    assert.equal(q.sourcePlaylistMembership.videoId, classification.sourceVideoId);
    assert.deepEqual(q.sourcePlaylistMembership.playlistIds, classification.sourcePlaylistIds);
    const onlyIntermediate = classification.sourcePlaylistIds.includes(INTERMEDIATE) && !classification.sourcePlaylistIds.includes(BEGINNER);
    assert.equal(previewAudienceLabel(q), onlyIntermediate ? "中上級者向け" : "");
    assert.equal("course" in q, false);
  }
});

test("public release, missing metadata, invalid sources and changed source videos never show preview labels", () => {
  const q = byId(169);
  assert.equal(previewAudienceLabel(q), "中上級者向け");
  for (const stage of ["public", "closed", null, ""]) assert.equal(previewAudienceLabel(q, stage), "");
  for (const sourceUrl of ["https://example.com/watch?v=Aijtrqz70Os", "https://youtu.be/a3yIRViy5gc", "javascript:alert(1)", "", null]) assert.equal(previewAudienceLabel({ ...q, sourceUrl }), "");
  assert.equal(previewAudienceLabel({ sourceUrl: q.sourceUrl }), "");
  assert.equal(previewAudienceLabel({ ...q, sourcePlaylistMembership: { videoId: "Aijtrqz70Os", playlistIds: [BEGINNER, INTERMEDIATE] } }), "");
  for (const sourceUrl of ["https://youtu.be/Aijtrqz70Os?t=3", "https://www.youtube.com/watch?v=Aijtrqz70Os", "https://youtube.com/shorts/Aijtrqz70Os"]) assert.equal(previewAudienceLabel({ ...q, sourceUrl }), "中上級者向け");
});

test("duplicate audit keeps only independently different situations and visually checked near-matches", () => {
  assert.equal(questions.length, 292);
  assert.equal(review.pairCount, 42486);
  assert.deepEqual(review.sameSourceAndTime, []);
  assert.deepEqual(review.sameImageBytes, []);
  const inventory = q => JSON.stringify([[...q.hand, ...(q.draw ? [q.draw] : [])].sort(), q.melds.map(m => ({ type: m.type, open: m.open, tiles: [...m.tiles].sort() }))]);
  const groups = new Map();
  for (const q of questions) { const key = inventory(q); groups.set(key, [...(groups.get(key) || []), q.id]); }
  assert.deepEqual([...groups.values()].filter(ids => ids.length > 1), [[172, 173]]);
  assert.notEqual(byId(172).round, byId(173).round);
  assert.notEqual(byId(172).points, byId(173).points);
  assert.notEqual(byId(172).correctRiichi, byId(173).correctRiichi);
  assert.deepEqual(review.reviewedSimilarPairs.map(pair => pair.ids), [[172, 173], [4, 181], [207, 209], [218, 219]]);
  for (const [a, b] of [[4, 181], [207, 209], [218, 219]]) assert.notEqual(inventory(byId(a)), inventory(byId(b)));
});

test("catalog, play and admin use one shared preview-only classification rule", async () => {
  const appSource = await read("index.html");
  const appVersion = /const APP_VERSION = (\d+);/.exec(appSource)?.[1];
  assert.ok(appVersion);
  for (const file of ["index.html", "admin.html"]) {
    const source = await read(file);
    assert.ok(source.includes(`<script src="question-metadata.js?v=${appVersion}"></script>`));
    assert.ok(source.includes(`<script src="config.js?v=${appVersion}"></script>`));
    assert.match(source, /const \{ previewAudienceLabel \} = window\.ZUNDAMON_QUESTION_METADATA/);
    assert.match(source, /previewAudienceLabel\(question\)/);
  }
  assert.match(appSource, /id="audienceBadge" hidden/);
  assert.match(appSource, /audienceBadge\.hidden = !audienceLabel/);
  assert.match(appSource, /catalog-audience-badge/);
  assert.equal(context.window.ZUNDAMON_CONFIG.releaseStage, "preview");
});

test("local editing preserves valid optional playlist provenance and never adds it to legacy data", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zundamon-v68-"));
  const basePath = path.join(temporaryRoot, "questions.json");
  const overridesPath = path.join(temporaryRoot, "overrides.json");
  const fixture = structuredClone(byId(169));
  await writeFile(basePath, JSON.stringify([fixture]));
  const app = createAppServer({ rootDir: root, basePath, overridesPath, editMode: "open", port: 0 });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const put = async question => { const r = await fetch(`${origin}/api/admin/questions/169`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }); assert.equal(r.status, 200); return r.json(); };
  try {
    const saved = await put(fixture);
    assert.deepEqual(saved.sourcePlaylistMembership, fixture.sourcePlaylistMembership);
    const legacy = { ...fixture }; delete legacy.sourcePlaylistMembership;
    await put(legacy);
    const stored = JSON.parse(await readFile(overridesPath, "utf8"));
    assert.equal("sourcePlaylistMembership" in stored[169].questionData, false);
    assert.doesNotMatch(await readFile(overridesPath, "utf8"), /undefined/);
    const script = await fetch(`${origin}/question-metadata.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("Content-Type"), /javascript/);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    assert.ok(path.resolve(temporaryRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

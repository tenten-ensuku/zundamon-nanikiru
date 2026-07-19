import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppServer } from "../server.mjs";

const PASSWORD = "test-only-admin-password";
let temporaryRoot;
let basePath;
let overridesPath;
let app;
let origin;

const baseQuestions = [
  {
    id: 1,
    hand: ["1m", "2m", "3m", "4p", "0p", "5s", "6s", "7s", "1z", "1z", "2z", "3z", "4z", "5z"],
    explanation: "原本の解説",
    correctDiscards: [],
  },
  {
    id: 2,
    hand: ["1m", "1m", "2m", "2m", "3m", "3m", "4p", "4p", "5p", "5p", "6s", "6s", "7z", "7z"],
    explanation: "第2問",
    correctDiscards: [],
  },
];

async function startTestServer(password = PASSWORD) {
  const created = createAppServer({
    rootDir: path.resolve("."),
    basePath,
    overridesPath,
    adminPassword: password,
    port: 0,
    allowedOrigins: ["http://allowed.test"],
  });
  await new Promise((resolve) => created.server.listen(0, "127.0.0.1", resolve));
  const address = created.server.address();
  return { ...created, origin: `http://127.0.0.1:${address.port}` };
}

async function request(pathname, options = {}) {
  return fetch(`${origin}${pathname}`, options);
}

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zundamon-admin-"));
  await mkdir(path.join(temporaryRoot, "public"), { recursive: true });
  await mkdir(path.join(temporaryRoot, "data"), { recursive: true });
  basePath = path.join(temporaryRoot, "public", "questions.json");
  overridesPath = path.join(temporaryRoot, "data", "question-overrides.json");
  await writeFile(basePath, JSON.stringify(baseQuestions), "utf8");
  await writeFile(overridesPath, "{}\n", "utf8");
  app = await startTestServer();
  origin = app.origin;
});

after(async () => {
  if (app?.server.listening) await new Promise((resolve) => app.server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("public question list starts with bundled content", async () => {
  const response = await request("/api/questions");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.length, 2);
  assert.deepEqual(body[0].correctDiscards, []);
  assert.equal(body[0].explanation, "原本の解説");
  assert.equal(body[0].overridden, false);
});

test("override list is empty before edits", async () => {
  const response = await request("/api/overrides");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("login rejects malformed JSON and a wrong password", async () => {
  const malformed = await request("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);

  const wrong = await request("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "認証に失敗しました。");
});

test("login accepts the configured password", async () => {
  const response = await request("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("login reports missing server configuration", async () => {
  const missing = await startTestServer("");
  try {
    const response = await fetch(`${missing.origin}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(response.status, 503);
  } finally {
    await new Promise((resolve) => missing.server.close(resolve));
  }
});

test("mutations reject missing authentication and unknown origins", async () => {
  const noCredential = await request("/api/admin/questions/1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correctDiscards: ["1m"], explanation: "更新" }),
  });
  assert.equal(noCredential.status, 401);

  const unrelatedOrigin = await request("/api/admin/questions/1", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": PASSWORD,
      Origin: "https://unrelated.example",
    },
    body: JSON.stringify({ correctDiscards: ["1m"], explanation: "更新" }),
  });
  assert.equal(unrelatedOrigin.status, 403);
});

test("server validates IDs, answers, and explanation length", async () => {
  const headers = { "Content-Type": "application/json", "X-Admin-Password": PASSWORD };
  const missingId = await request("/api/admin/questions/999", {
    method: "PUT", headers, body: JSON.stringify({ correctDiscards: ["1m"], explanation: "更新" }),
  });
  assert.equal(missingId.status, 404);

  const blank = await request("/api/admin/questions/1", {
    method: "PUT", headers, body: JSON.stringify({ correctDiscards: ["1m"], explanation: "" }),
  });
  assert.equal(blank.status, 400);

  const invalidAnswer = await request("/api/admin/questions/1", {
    method: "PUT", headers, body: JSON.stringify({ correctDiscards: ["9p"], explanation: "更新" }),
  });
  assert.equal(invalidAnswer.status, 400);

  const tooLong = await request("/api/admin/questions/1", {
    method: "PUT", headers, body: JSON.stringify({ correctDiscards: ["1m"], explanation: "あ".repeat(20_001) }),
  });
  assert.equal(tooLong.status, 400);
});

test("review completion can be saved without editing question content", async () => {
  const headers = { "Content-Type": "application/json", "X-Admin-Password": PASSWORD };
  const unauthenticated = await request("/api/admin/questions/1", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed: true }),
  });
  assert.equal(unauthenticated.status, 401);

  const invalid = await request("/api/admin/questions/1", {
    method: "PATCH", headers, body: JSON.stringify({ reviewed: "yes" }),
  });
  assert.equal(invalid.status, 400);

  const response = await request("/api/admin/questions/1", {
    method: "PATCH", headers, body: JSON.stringify({ reviewed: true }),
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.reviewed, true);
  assert.equal(saved.overridden, false);
  assert.equal(saved.explanation, "原本の解説");

  const overrides = await request("/api/overrides").then((result) => result.json());
  assert.equal(overrides[0].reviewed, true);
  assert.equal("correctDiscards" in overrides[0], false);
  assert.equal("explanation" in overrides[0], false);
});

test("upsert reaches the merged public question list", async () => {
  const response = await request("/api/admin/questions/1", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Admin-Password": PASSWORD, Origin: "http://allowed.test" },
    body: JSON.stringify({ correctDiscards: ["1m", "0p"], explanation: "編集した解説" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://allowed.test");
  const saved = await response.json();
  assert.deepEqual(saved.correctDiscards, ["1m", "0p"]);
  assert.equal(saved.overridden, true);
  assert.equal(saved.reviewed, true);

  const publicResponse = await request("/api/questions");
  const publicQuestions = await publicResponse.json();
  assert.equal(publicQuestions[0].explanation, "編集した解説");
  assert.deepEqual(publicQuestions[0].correctDiscards, ["1m", "0p"]);

  const stored = JSON.parse(await readFile(overridesPath, "utf8"));
  assert.equal(stored["1"].explanation, "編集した解説");
});

test("admin can replace tiles and add a complete custom question", async () => {
  const headers = { "Content-Type": "application/json", "X-Admin-Password": PASSWORD };
  const replacement = {
    id: 1, image: "", images: [], explanation: "牌姿を編集", sourceUrl: "", sourceLabel: "", createdAt: "2026-01-01T00:00:00Z",
    hand: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p"], draw: null, status: "unreviewed",
    meldCount: 1, round: "east1", seat: "west", turn: 6, honba: 0, points: 25000, dora: "3p",
    melds: [{ type: "pon", open: true, calledIndex: 0, tiles: ["6z", "6z", "6z"] }], correctDiscards: ["1m"],
  };
  const replaced = await request("/api/admin/questions/1", { method: "PUT", headers, body: JSON.stringify({ question: replacement }) });
  assert.equal(replaced.status, 200);
  const savedReplacement = await replaced.json();
  assert.equal(savedReplacement.dora, "3p");
  assert.equal(savedReplacement.sourceUrl, "");

  const custom = { ...replacement, id: 3, explanation: "新規問題", hand: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p", "5p"], meldCount: 0, melds: [], dora: "1s", correctDiscards: ["1m"] };
  const created = await request("/api/admin/questions", { method: "POST", headers, body: JSON.stringify({ question: custom }) });
  assert.equal(created.status, 200);
  const publicQuestions = await request("/api/questions").then((response) => response.json());
  assert.equal(publicQuestions.find((question) => question.id === 3).explanation, "新規問題");
});

test("delete restores bundled content", async () => {
  const response = await request("/api/admin/questions/1", {
    method: "DELETE",
    headers: { "X-Admin-Password": PASSWORD },
  });
  assert.equal(response.status, 200);
  const restored = await response.json();
  assert.equal(restored.explanation, "原本の解説");
  assert.deepEqual(restored.correctDiscards, []);
  assert.equal(restored.overridden, false);
  assert.equal(restored.reviewed, true);

  const stored = JSON.parse(await readFile(overridesPath, "utf8"));
  assert.equal(stored["1"].reviewed, true);
  assert.equal("correctDiscards" in stored["1"], false);
});

test("review completion can be cleared after restoring bundled content", async () => {
  const response = await request("/api/admin/questions/1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Admin-Password": PASSWORD },
    body: JSON.stringify({ reviewed: false }),
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.reviewed, false);
  assert.equal(saved.overridden, false);
  const remainingOverrides = await request("/api/overrides").then((result) => result.json());
  assert.equal(remainingOverrides.some((override) => override.id === 1), false);
});

test("client contains a bundled-data fallback", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /fetch\("public\/questions\.json"/);
  assert.match(source, /apiUrl\("\/api\/overrides"\)/);
  assert.match(source, /\.catch\(\(\) => \[\]\)/);
});

test("hand and meld tiles keep the same per-tile width", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /container-type:\s*inline-size/);
  assert.match(source, /\.tile-button, \.meld-tile\s*\{[^}]*width:\s*var\(--tile-width\)[^}]*flex:\s*0 0 var\(--tile-width\)/s);
  assert.match(source, /const APP_VERSION = 53;/);
});

test("hand dora and red fives receive the static gloss marker", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /function isRedDora\(code\)\s*\{[\s\S]*code === "0m"[\s\S]*code === "0p"[\s\S]*code === "0s"/);
  assert.match(source, /function isHandDora\(code, dora\)\s*\{\s*return code === dora \|\| isRedDora\(code\);/);
  assert.match(source, /tile-button\.dora-in-hand::before/);
  assert.match(source, /doraInHand \? " dora-in-hand" : ""/);
});

test("pre-release menu displays the canonical app version beside the title", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /class="menu-title"><h1>重要何切る問題集（基礎）<\/h1><small class="menu-version">ver \$\{APP_VERSION\}<\/small>/);
  assert.match(source, /<title>重要何切る問題集（基礎）<\/title>/);
  assert.match(source, /\.menu-version\s*\{[^}]*position:\s*absolute[^}]*right:\s*1px[^}]*bottom:\s*-10px[^}]*font-size:\s*8px/s);
});

test("reviewing mode restores vertical scrolling after an answer", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  const playLockIndex = source.indexOf("body.play-open { overflow: hidden; }");
  const reviewUnlockIndex = source.indexOf("body.play-open.reviewing");
  assert.ok(playLockIndex >= 0);
  assert.ok(reviewUnlockIndex > playLockIndex);
  assert.match(source, /body\.play-open\.reviewing\s*\{[^}]*overflow-y:\s*auto[^}]*touch-action:\s*pan-y/s);
});

test("admin editor has a shared per-question review checkbox", async () => {
  const source = await readFile(path.resolve("admin.html"), "utf8");
  assert.match(source, /class="review-checkbox" type="checkbox"/);
  assert.match(source, /<span>確認完了<\/span>/);
  assert.match(source, /method:\s*"PATCH"/);
  assert.match(source, /JSON\.stringify\(\{ reviewed: reviewCheckbox\.checked \}\)/);
  assert.match(source, /確認完了 \$\{reviewed\}問/);
});

test("client has one continuous beginner question set without an ura mode", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  for (const label of ["初級編", "復習", "問題一覧", "自己分析", "順位", "設定"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /class="menu-admin-entry" href="admin\.html">管理画面<\/a>/);
  assert.match(source, /data-start-mode="ten"/);
  assert.match(source, /data-start-mode="all"/);
  assert.doesNotMatch(source, /中級編|intermediate|questionCourse|courseQuestions/);
  assert.doesNotMatch(source, /出題タイプを選んですぐ開始できます/);
  assert.match(source, /id="homeButton"[^>]*>メニュー</);
  assert.doesNotMatch(source, /裏モード/);
});

test("admin editor supports direct meld editing and shows the called tile sideways", async () => {
  const source = await readFile(path.resolve("admin.html"), "utf8");
  assert.match(source, /class="meld-editor"/);
  assert.match(source, /draft\.melds\.forEach/);
  assert.match(source, /meld\.open && tileIndex === meld\.calledIndex/);
  assert.match(source, /classList\.add\("sideways"\)/);
  assert.match(source, /aria-label", "横向きの牌"/);
  assert.match(source, /\.edit-tile[\s\S]*width:\s*var\(--admin-tile-width\)/);
});

test("admin editor displays the dora with the approved tile image path", async () => {
  const source = await readFile(path.resolve("admin.html"), "utf8");
  assert.match(source, /class="tile-editor-row dora-row"/);
  assert.match(source, /tileButton\(draft\.dora, target\?\.kind === "dora"/);
  assert.match(source, /image\.src = tilePath\(code\)/);
  assert.match(source, /const allTiles = \[\.\.\.Array\.from/);
});

test("admin editor provides a 37-tile palette, replacement controls, and problem creation", async () => {
  const source = await readFile(path.resolve("admin.html"), "utf8");
  assert.match(source, /id="addQuestion"/);
  assert.match(source, /class="delete-selected"/);
  assert.match(source, /class="clear-hand"/);
  assert.match(source, /class="tile-palette"/);
  assert.match(source, /"0m"[\s\S]*"0p"[\s\S]*"0s"/);
  assert.match(source, /question\.isNew \? "POST" : "PUT"/);
});

test("admin editor separates the original video URL from explanation text", async () => {
  const source = await readFile(path.resolve("admin.html"), "utf8");
  assert.match(source, /id="sourceUrl" type="url"/);
  assert.match(source, /元動画 URL/);
  assert.match(source, /参考動画は解説文に貼ります/);
  assert.match(source, /draft\.sourceUrl = sourceUrlInput\.value\.trim\(\)/);
});

test("review displays the original video below the explanation and keeps reference URLs linkified", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /id="sourceVideo" hidden/);
  assert.match(source, /id="sourceVideoLink"/);
  assert.match(source, /question\.sourceUrl/);
  assert.match(source, /const url = trimUrlPunctuation\(chunk\)/);
  assert.match(source, /new URL\(url\)/);
  assert.match(source, /link\.className = `content-link content-link--\$\{metadata\.kind\}`/);
  assert.match(source, /link\.rel = "noreferrer"/);
  assert.match(source, /setLinkContent\(sourceVideoLink, linkMetadata\(new URL\(question\.sourceUrl\)\), "問題解説動画へ飛ぶ"\)/);
  assert.doesNotMatch(source, /id="sourceLink"/);
  assert.doesNotMatch(source, /Discordの元投稿を開く/);
});

test("problem catalog opens a consecutive question session and link chips use service icons", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /openButton\.addEventListener\("click", \(\) => openCatalogQuestion\(question\.id\)\)/);
  assert.match(source, /function openCatalogQuestion\(id\)/);
  assert.match(source, /createSession\("catalog", ids, position\)/);
  assert.match(source, /state\.session\?\.mode === "single" \|\| state\.session\?\.mode === "catalog"/);
  assert.match(source, /function createLinkIcon\(kind\)/);
  assert.match(source, /kind === "youtube"/);
  assert.match(source, /kind === "google-doc"/);
  assert.match(source, /link-icon--\$\{kind\}/);
});

test("admin exit returns to the GitHub Pages app directory", async () => {
  const source = await readFile(path.resolve("admin.html"), "utf8");
  assert.match(source, /document\.getElementById\("logout"\)[\s\S]*location\.href = "\.\/";/);
  assert.doesNotMatch(source, /location\.href = "\/";/);
});

test("problem catalog displays hand, melds, dora, and persistent favorites", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /favoriteIds:\s*\[\]/);
  assert.match(source, /favoriteIds:\s*Array\.isArray\(source\.favoriteIds\)/);
  assert.match(source, /function createCatalogCard\(question\)/);
  assert.match(source, /question\.hand\.forEach\(code => hand\.append\(createCatalogTile\(code\)\)\)/);
  assert.match(source, /question\.melds\.forEach\(meld =>/);
  assert.match(source, /createCatalogTile\(question\.dora\)/);
  assert.match(source, /button\.textContent = active \? "★追加済" : "☆追加"/);
  assert.match(source, /image\.loading = "lazy"/);
});

test("problem catalog displays a rainbow accuracy progress bar", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /\.catalog-rate-bar > span[\s\S]*linear-gradient\(90deg, #ef5b55[\s\S]*#35c7a4/s);
  assert.match(source, /const rateValue = stat\.total \? Math\.max\(0, Math\.min\(100,/);
  assert.match(source, /rateBar\.setAttribute\("role", "progressbar"\)/);
  assert.match(source, /rateFill\.style\.width = `\$\{rateValue\}%`/);
});

test("question 1 contains a red five-pin", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const question = questions.find((item) => item.id === 1);
  assert.equal(question.hand.filter((tile) => tile === "0p").length, 1);
  assert.equal(question.hand.includes("5p"), false);
  assert.equal(question.hand.filter((tile) => tile === "6s").length, 2);
  assert.equal(question.hand.includes("8s"), false);
});

test("verified source videos use canonical answers and summaries", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const expected = new Map([[2, "3s"], [3, "4s"], [4, "2m"], [5, "5m"], [6, "7m"], [7, "1z"], [8, "2s"], [9, "2z"], [10, "8s"], [11, "3p"], [12, "2s"], [13, "4p"], [14, "7p"], [15, "4m"], [16, "3p"], [19, "8s"], [20, "7p"], [22, "1s"], [23, "9p"], [25, "6s"]]);
  for (const [id, discard] of expected) {
    const question = questions.find((item) => item.id === id);
    assert.deepEqual(question.correctDiscards, [discard]);
    assert.match(question.explanation, /【動画要約】/);
    assert.match(question.explanation, new RegExp(`打${discard}`));
  }
  for (const id of [20, 22]) {
    const question = questions.find((item) => item.id === id);
    assert.equal(question.riichiChoice, true);
    assert.equal(question.correctRiichi, true);
  }
});

test("saved admin explanations retain bundled video summaries", async () => {
  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /function mergeExplanationWithVideoSummary/);
  assert.match(source, /current\.includes\("【動画要約】"\)/);
});

test("admin explanation editor supports bold and red text without injecting HTML", async () => {
  const admin = await readFile(path.resolve("admin.html"), "utf8");
  const client = await readFile(path.resolve("index.html"), "utf8");
  assert.match(admin, /data-format="bold"/);
  assert.match(admin, /data-format="red"/);
  assert.match(admin, /\[red\]文字\[\/red\]/);
  assert.match(client, /function appendFormattedText/);
  assert.match(client, /document\.createElement\(token\.startsWith\("\*\*"\) \? "strong" : "span"\)/);
  assert.match(client, /explanation-red/);
});

test("Discord spoiler and annotation remnants are removed from explanations", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  assert.equal(questions.some((question) => /\|\||※/.test(String(question.explanation || ""))), false);
  const client = await readFile(path.resolve("index.html"), "utf8");
  const admin = await readFile(path.resolve("admin.html"), "utf8");
  assert.match(client, /function cleanDiscordExplanationArtifacts/);
  assert.match(admin, /function cleanDiscordExplanationArtifacts/);
});

test("question 3 contains an open three-green-dragon pon", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const question = questions.find((item) => item.id === 3);
  assert.deepEqual(question.melds, [
    { type: "pon", open: true, calledIndex: 0, tiles: ["6z", "6z", "6z"] },
  ]);
});

test("question 13 contains an open three-white pon", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const question = questions.find((item) => item.id === 13);
  assert.equal(question.meldCount, 1);
  assert.deepEqual(question.melds, [{
    type: "pon",
    open: true,
    calledIndex: 0,
    tiles: ["5z", "5z", "5z"],
  }]);
});

test("question 66 shows the discard note and records a riichi choice", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const question = questions.find((item) => item.id === 66);
  assert.equal(question.note, "南＝1枚切れ　北＝生牌（1枚も切られていない）");
  assert.equal(question.riichiChoice, true);

  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /id="situationNote" hidden/);
  assert.match(source, /id="riichiButton"[^>]*aria-pressed="false"[^>]*hidden>立直</);
  assert.match(source, /function toggleRiichi\(\)/);
  assert.match(source, /question\.riichiChoice === true \? \{ riichi: riichiSelected \} : \{\}/);
  assert.match(source, /riichiSelected \? "立直して切る" : "ダマで切る"/);
});

test("question 166 reproduces the YouTube problem and grades north with riichi", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  assert.equal(questions.length, 167);
  const question = questions.find((item) => item.id === 166);
  assert.deepEqual(question.hand, [
    "2m", "3m", "4m", "3s", "4s", "4s", "5s", "5s", "6s", "7s", "8s", "4z", "4z", "4z",
  ]);
  assert.equal(question.draw, null);
  assert.deepEqual(
    { round: question.round, seat: question.seat, turn: question.turn, honba: question.honba, points: question.points },
    { round: "east1", seat: "west", turn: 8, honba: 0, points: 25000 },
  );
  assert.equal(question.dora, "4z");
  assert.deepEqual(question.correctDiscards, ["4z"]);
  assert.equal(question.riichiChoice, true);
  assert.equal(question.correctRiichi, true);
  assert.equal(question.sourceUrl, "https://youtu.be/a3yIRViy5gc");
  assert.equal(question.sourceLabel, "YouTube動画を開く");
  assert.match(question.explanation, /3s・6s・9s待ちの三面張/);
  assert.match(question.explanation, /4z切りリーチを優先/);
  assert.doesNotMatch(question.explanation, /[萬万筒索]/);

  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /typeof question\.correctRiichi === "boolean"/);
  assert.match(source, /riichiSelected === question\.correctRiichi/);
  assert.match(source, /id="sourceVideo" hidden/);
  assert.match(source, /question\.sourceUrl/);
  assert.match(source, /"問題解説動画へ飛ぶ"/);
});

test("question 167 reproduces both left-called chi melds and grades six man", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  assert.equal(questions.length, 167);
  const question = questions.find((item) => item.id === 167);
  assert.deepEqual(question.hand, [
    "5m", "0m", "6m", "7m", "7m", "7m", "7z", "7z",
  ]);
  assert.equal(question.draw, null);
  assert.deepEqual(
    { round: question.round, seat: question.seat, turn: question.turn, honba: question.honba, points: question.points },
    { round: "east1", seat: "west", turn: 6, honba: 0, points: 25000 },
  );
  assert.equal(question.dora, "6s");
  assert.equal(question.note, "6sをチーした直後（ツモ牌表記なし）");
  assert.deepEqual(question.melds, [
    { type: "chi", open: true, calledIndex: 0, tiles: ["6s", "4s", "0s"] },
    { type: "chi", open: true, calledIndex: 0, tiles: ["3p", "4p", "5p"] },
  ]);
  assert.deepEqual(question.correctDiscards, ["6m"]);
  assert.equal(question.sourceUrl, "https://youtu.be/ADWMMNXtryw");
  assert.equal(question.sourceLabel, "YouTube動画を開く");
  assert.match(question.explanation, /4m4枚と7m1枚の計5枚/);
  assert.match(question.explanation, /40符となり1300・2600/);
  assert.doesNotMatch(question.explanation, /[萬万筒索]/);
});

test("question 168 reproduces the YouTube hand and grades eight man", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  assert.equal(questions.length, 167);
  const question = questions.find((item) => item.id === 168);
  assert.deepEqual(question.hand, [
    "3m", "4m", "8m", "9m", "9m", "2p", "3p", "4p", "6p", "7p", "5s", "6s", "7s", "7s",
  ]);
  assert.equal(question.draw, null);
  assert.deepEqual(
    { round: question.round, seat: question.seat, turn: question.turn, honba: question.honba, points: question.points },
    { round: "east1", seat: "west", turn: 6, honba: 0, points: 25000 },
  );
  assert.equal(question.dora, "4m");
  assert.equal(question.note, "7sをツモした局面（ツモ牌は手牌へ統合）");
  assert.deepEqual(question.melds, []);
  assert.deepEqual(question.correctDiscards, ["8m"]);
  assert.equal(question.sourceUrl, "https://youtu.be/VWOg74rytII");
  assert.equal(question.sourceLabel, "YouTube動画を開く");
  assert.match(question.explanation, /4sを引いて456sを作る4枚/);
  assert.match(question.explanation, /8mの3枚だけ/);
  assert.doesNotMatch(question.explanation, /[萬万筒索]/);
});

test("three non-duplicate videos continue the beginner question set", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  assert.equal(questions.length, 167);
  assert.equal(questions.some((question) => "course" in question), false);
  const added = questions.filter((question) => [169, 170, 171].includes(question.id));
  assert.deepEqual(added.map((question) => question.sourceUrl), [
    "https://youtu.be/Aijtrqz70Os",
    "https://youtu.be/EwtJuGUcYy8",
    "https://youtu.be/GucqM0jEhlA",
  ]);
});

test("question 169 keeps the comparison hand, dora, and two-man answer", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const question = questions.find((item) => item.id === 169);
  assert.deepEqual(question.hand, [
    "2m", "4m", "4m", "5m", "6m", "7m", "7m", "8m", "5p", "7p", "9p", "7s", "8s", "9s",
  ]);
  assert.equal(question.dora, "6s");
  assert.deepEqual(question.melds, []);
  assert.deepEqual(question.correctDiscards, ["2m"]);
  assert.equal("course" in question, false);
  assert.doesNotMatch(question.explanation, /[萬万筒索]/);
});

test("question 170 stores the riichi decision and question 171 stores the open red-dragon pon", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const riichi = questions.find((item) => item.id === 170);
  assert.deepEqual(riichi.hand, [
    "2m", "3m", "4m", "5m", "7m", "7m", "7m", "9p", "9p", "9p", "2s", "3s", "3s", "3s",
  ]);
  assert.equal(riichi.dora, "8s");
  assert.deepEqual(riichi.correctDiscards, ["2s"]);
  assert.equal(riichi.riichiChoice, true);
  assert.equal(riichi.correctRiichi, true);

  const openHand = questions.find((item) => item.id === 171);
  assert.deepEqual(openHand.hand, [
    "4m", "0m", "2p", "3p", "3p", "4p", "4p", "5p", "6p", "8s", "8s",
  ]);
  assert.equal(openHand.dora, "9m");
  assert.deepEqual(openHand.melds, [
    { type: "pon", open: true, calledIndex: 0, tiles: ["6z", "6z", "6z"] },
  ]);
  assert.deepEqual(openHand.correctDiscards, ["3p"]);
  assert.equal("course" in openHand, false);
  assert.doesNotMatch(openHand.explanation, /[萬万筒索]/);
});

test("user-verified video corrections are fixed in the calibration set", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const calibration = JSON.parse(await readFile(path.resolve("calibration/zundamon-nanikiru-v1/verified-questions.json"), "utf8"));
  for (const id of [169, 170]) {
    const question = questions.find((item) => item.id === id);
    const verified = calibration.questions[String(id)];
    for (const field of ["hand", "dora", "melds", "correctDiscards", "riichiChoice", "correctRiichi"]) {
      if (field in verified) assert.deepEqual(question[field], verified[field], `question ${id}: ${field}`);
    }
  }
  assert.deepEqual(calibration.correctionLedger.map((entry) => entry.id), [169, 170]);
});

test("every concealed quad offers kan as a standalone answer", async () => {
  const questions = JSON.parse(await readFile(path.resolve("public/questions.json"), "utf8"));
  const normalize = (tile) => /^0[mps]$/.test(tile) ? `5${tile[1]}` : tile;
  const quadQuestions = questions.filter((question) => {
    const counts = question.hand.reduce((map, tile) => {
      const kind = normalize(tile);
      return map.set(kind, (map.get(kind) || 0) + 1);
    }, new Map());
    return [...counts.values()].includes(4);
  });
  assert.deepEqual(quadQuestions.map((question) => question.id), [52, 78, 79, 86, 97]);
  for (const question of quadQuestions) {
    assert.equal(question.kanChoice, true);
  }

  const source = await readFile(path.resolve("index.html"), "utf8");
  assert.match(source, /id="kanButton"[^>]*aria-pressed="false"[^>]*hidden>カン！</);
  assert.match(source, /function toggleKan\(\)/);
  assert.match(source, /specialChoice === "kan" \? \{ choice: "kan" \} : \{\}/);
  assert.match(source, /\? "カン！で回答"/);

  const structureSource = await readFile(path.resolve("scripts/structure-questions.py"), "utf8");
  assert.match(structureSource, /def has_kan_choice\(hand: list\[str\]\) -> bool:/);
  assert.match(structureSource, /"5" \+ code\[1\] if code\.startswith\("0"\) else code/);
  assert.match(structureSource, /question\["kanChoice"\] = True/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRenderer, render, images, links, visibleText, descendants } from "./helpers/explanation-renderer.mjs";

const app = createRenderer();
const originalRenderer = createRenderer({ compact: false });

for (const value of [
  "7s・8s / 3m・5m / 3s・6s・9s",
  "24m・79m・12s / 335m・778s・3z・3z",
  "Ｒ５Ｍ ・ aka2･赤５ｓ·0m / １ｚ・７ｚ",
  "**3m**・[red]6m[/red]・9m",
  "3m**・**[red]6m・[/red]9m",
  "**3m ・** [red] 6m[/red]",
  "赤0p・赤0s / 赤0m**・赤**[red]0p[/red]",
]) {
  test(`tile-only separators disappear across plain and formatted runs: ${value}`, () => {
    const before = render(originalRenderer, value), after = render(app, value);
    assert.deepEqual(images(after), images(before));
    assert.ok(images(after).length >= 2);
    assert.doesNotMatch(visibleText(after), /[・･·]/u);
    assert.equal(descendants(after).filter(n => n.tagName === "STRONG").length,
      descendants(before).filter(n => n.tagName === "STRONG").length);
  });
}

for (const value of [
  "タンヤオ・平和。巡目・現在の打点・戻した後の上積み。",
  "1300・2600。3・4・5の三色。12巡目・2z。白・發。",
  "3m 6m\n・9m\n\n6s・\n9s。3s、6s。3p／6p。",
  "3m・候補の6m。3m・https://example.com/6m・9m",
  "真ん中・中張牌。発展・役牌。x3m・6pfoo。",
  "3m・赤い6m。3m・赤2p。0s・赤赤0p。",
]) {
  test(`prose, scores, URLs, unrecognized words and line boundaries stay unchanged: ${value}`, () => {
    const before = render(originalRenderer, value), after = render(app, value);
    assert.equal(visibleText(after), visibleText(before));
    assert.deepEqual(images(after), images(before));
    assert.deepEqual(links(after), links(before));
  });
}

test("all bundled and snapshot speaker explanations preserve tiles, prose, links and source data", async () => {
  const base = JSON.parse(await readFile(new URL("../public/questions.json", import.meta.url), "utf8"));
  const snapshot = JSON.parse(await readFile(new URL("../public/shared-overrides.json", import.meta.url), "utf8"));
  const questions = app.mergeOverrides(base, snapshot.rows);
  const original = JSON.stringify(questions);
  let reviewed = 0, removed = 0;
  for (const question of questions) {
    const parts = app.explanationParts(question);
    for (const field of ["video", "author"]) {
      const before = render(originalRenderer, parts[field]), after = render(app, parts[field]);
      assert.deepEqual(images(after), images(before), `${question.id}.${field} tiles`);
      assert.deepEqual(links(after), links(before), `${question.id}.${field} links`);
      const normalize = text => text.replace(/[・･· \t\u00a0\u3000]/gu, "");
      assert.equal(normalize(visibleText(after)), normalize(visibleText(before)), `${question.id}.${field} prose`);
      // Real corpus prose (including its own middle dots) must stay byte-for-byte.
      // Only pure tile separators, or a separator before an existing red label,
      // may change; synthetic cases above separately verify the image boundaries.
      const beforeText = descendants(before).filter(n => n.nodeType === 3);
      const afterText = descendants(after).filter(n => n.nodeType === 3);
      assert.equal(afterText.length, beforeText.length);
      for (let i = 0; i < beforeText.length; i++) {
        const oldText = beforeText[i].textContent, newText = afterText[i].textContent;
        if (oldText === newText) continue;
        assert.match(oldText, /^[ \t\u00a0\u3000・･·]+赤?$/u, `${question.id}.${field} changed text`);
        assert.equal(newText, oldText.replace(/[ \t\u00a0\u3000・･·]/gu, ""));
      }
      removed += (visibleText(before).match(/[・･·]/gu) || []).length - (visibleText(after).match(/[・･·]/gu) || []).length;
      assert.equal(app.compactExplanationTiles(after), 0, "Rendering is idempotent");
      reviewed++;
    }
  }
  assert.equal(reviewed, questions.length * 2);
  assert.ok(removed > 500, "Audit covers both speakers across the full corpus");
  assert.equal(JSON.stringify(questions), original);
});

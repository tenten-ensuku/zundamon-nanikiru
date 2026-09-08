import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = await readFile(path.join(root, "index.html"), "utf8");
const questions = JSON.parse(await readFile(path.join(root, "public/questions.json"), "utf8"));
const redFives = [
  { code: "0m", alias: "aka1", name: "赤5萬", sha256: "0785c1b3cfe5dedd1baeae394590c8cf190b09912f97c47a4628cc8b2896fe8e" },
  { code: "0p", alias: "aka2", name: "赤5筒", sha256: "207e034ecdb8a214a73125de28651067fae053acca3294e08b2fa3597d53a726" },
  { code: "0s", alias: "aka3", name: "赤5索", sha256: "cf8113f7f08a78c1584c743bfbf3787556302aecaf643ffa0c507a5c563b25a3" },
];
const fullwidth = value => value.replace(/[A-Za-z0-9]/g, char => String.fromCharCode(char.charCodeAt(0) + 0xfee0));
const aliases = ({ code, alias }) => {
  const suit = code[1];
  return [code, `赤5${suit}`, `r5${suit}`, `R5${suit}`, `r5${suit.toUpperCase()}`, alias, alias.toUpperCase(), ...[code, `赤5${suit}`, `r5${suit}`, `R5${suit}`, alias].map(fullwidth)];
};
class Element {
  children = [];
  attributes = {};
  constructor(tag) { this.tagName = tag.toUpperCase(); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
const document = {
  createElement: tag => new Element(tag),
  createElementNS: (namespace, tag) => Object.assign(new Element(tag), { namespaceURI: namespace }),
  createTextNode: textContent => ({ tagName: "#TEXT", textContent }),
};
const functions = ["tilePath", "explanationTilePath", "tileName", "stripDiscordMarkdown", "trimUrlPunctuation", "linkMetadata", "createLinkIcon", "setLinkContent", "explanationTileCode", "isExplanationTileBoundary", "isMahjongMiddle", "appendExplanationText", "appendFormattedText", "appendLinkedText"]
  .map(name => source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name)).join("\n");
const app = new Function("document", `const APP_VERSION=1, HONOR_NAMES={1:'東',2:'南',3:'西',4:'北',5:'白',6:'發',7:'中'}, SUIT_NAMES={m:'萬',p:'筒',s:'索'}; ${functions}; return { tilePath, explanationTilePath, explanationTileCode, appendExplanationText, appendLinkedText };`)(document);
const all = node => [node, ...(node.children || []).flatMap(all)];
const tiles = node => all(node).filter(item => item.className === "explanation-tile");
const text = node => all(node).filter(item => item.tagName === "#TEXT").map(item => item.textContent).join("");

test("every red-five alias normalizes to the correct suit including upper/lowercase and fullwidth r", () => {
  for (const red of redFives) for (const alias of aliases(red)) assert.equal(app.explanationTileCode(alias), red.code, alias);
});

test("red-five aliases actually tokenize into the same approved image rather than plain text", () => {
  for (const red of redFives) {
    const target = new Element("div"), input = aliases(red).join("＝");
    app.appendExplanationText(target, input);
    assert.equal(tiles(target).length, aliases(red).length);
    for (const image of tiles(target)) {
      assert.equal(image.alt, red.name);
      assert.equal(image.src, `tiles/${red.alias}-66-90-l.png?v=1`);
      assert.equal(image.width, 66);
      assert.equal(image.height, 90);
    }
    assert.equal(text(target), "＝".repeat(aliases(red).length - 1));
  }
});

test("red-five images in both asset directories match the visually verified canonical files", async () => {
  for (const red of redFives) for (const directory of ["tiles", "tiles/explanation"]) {
    const bytes = await readFile(path.join(root, directory, `${red.alias}-66-90-l.png`));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), red.sha256, `${directory}/${red.alias}`);
    assert.equal(bytes.readUInt32BE(16), 66);
    assert.equal(bytes.readUInt32BE(20), 90);
  }
});

test("hand and explanation red fives always share the same image mapping", () => {
  for (const { code } of redFives) assert.equal(app.explanationTilePath(code), app.tilePath(code));
  for (const code of ["5m", "5p", "5s"]) {
    assert.notEqual(app.explanationTilePath(code), app.explanationTilePath(`0${code[1]}`));
    assert.doesNotMatch(app.explanationTilePath(code), /aka/);
  }
});

test("invalid aliases, English identifiers and fullwidth digits around a token stay as original text", () => {
  const input = "aka0 aka4 aka10 AKA１0 ａｋａ１０ xaka1 aka2x xr5m r5px r4m ｒ６ｐ 50ms ０ｍ９";
  const target = new Element("div");
  app.appendExplanationText(target, input);
  assert.equal(tiles(target).length, 0);
  assert.equal(text(target), input);
});

test("bold/color rendering keeps red-five aliases correct and never transforms URLs", () => {
  const target = new Element("div");
  const input = "**Ｒ５Ｍ** [red]aka2[/red] 赤５ｓ https://example.com/aka1?r5p=0s <img src=x>";
  app.appendLinkedText(target, input);
  assert.deepEqual(tiles(target).map(image => image.alt), redFives.map(red => red.name));
  assert.equal(all(target).find(node => node.tagName === "A").href, "https://example.com/aka1?r5p=0s");
  assert.ok(text(target).includes("<img src=x>"));
  assert.equal(all(target).filter(node => node.tagName === "STRONG").length, 1);
});

test("question 5 renders red man in both speaker explanations without changing either saved text", () => {
  const question = questions.find(q => q.id === 5);
  const before = JSON.stringify(question);
  for (const [field, count] of [["videoExplanation", 2], ["explanation", 1]]) {
    const target = new Element("div");
    app.appendLinkedText(target, question[field]);
    const redImages = tiles(target).filter(image => image.alt.startsWith("赤"));
    assert.equal(redImages.length, count);
    assert.ok(redImages.every(image => image.alt === "赤5萬" && image.src === "tiles/aka1-66-90-l.png?v=1"));
  }
  assert.equal(JSON.stringify(question), before);
});

test("all saved explanation red fives resolve to the approved suit-specific files", () => {
  const names = new Map(redFives.map(red => [red.name, red.alias]));
  let count = 0;
  for (const question of questions) for (const field of ["videoExplanation", "explanation", "note"]) {
    if (!question[field]) continue;
    const target = new Element("div");
    app.appendLinkedText(target, question[field]);
    for (const image of tiles(target).filter(image => image.alt.startsWith("赤"))) {
      assert.equal(image.src, `tiles/${names.get(image.alt)}-66-90-l.png?v=1`, `question ${question.id} ${field}`);
      count++;
    }
  }
  assert.ok(count > 3);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
const functions = ["isRedDora", "isHandDora", "selectableHand", "createTileFace", "updateHandSelection", "renderHand"]
  .map(name => source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(`Missing ${name}`)).join("\n");

function harness() {
  class Element {
    children = [];
    dataset = {};
    attributes = {};
    className = "";
    style = { setProperty() {} };
    classList = {
      add: value => this.classList.toggle(value, true),
      toggle: (value, enabled) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) names.add(value); else names.delete(value);
        this.className = [...names].join(" ");
      },
    };
    constructor(tagName) { this.tagName = tagName; }
    append(...nodes) { this.children.push(...nodes); }
    set innerHTML(value) { assert.equal(value, ""); this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener() {}
    querySelectorAll(selector) { assert.equal(selector, ".tile-button"); return this.children; }
  }
  const elements = Object.fromEntries(["handTiles", "meldTiles", "tilesLine"].map(id => [id, new Element("div")]));
  const document = { createElement: tag => new Element(tag), getElementById: id => elements[id] };
  const api = new Function("document", "tilePath", "tileName", `let selectedIndex = null, revealed = false; ${functions}; return { isHandDora, renderHand, select(index) { selectedIndex = index; }, reveal() { revealed = true; } };`)(document, code => `tiles/${code}.png`, code => code);
  return { ...api, elements };
}

test("dora matching distinguishes the three suits and treats red fives as actual fives", () => {
  const { isHandDora } = harness();
  for (const suit of "mps") {
    assert.equal(isHandDora(`0${suit}`, "1z"), true);
    assert.equal(isHandDora(`5${suit}`, `5${suit}`), true);
    assert.equal(isHandDora(`5${suit}`, `0${suit}`), true);
  }
  assert.equal(isHandDora("5p", "5m"), false);
  assert.equal(isHandDora("4p", "5p"), false);
  assert.equal(isHandDora("4z", "3z"), false);
  assert.equal(isHandDora("4z", "4z"), true);
  assert.equal(isHandDora("5p", null), false);
});

const question = { id: 167, hand: ["5m", "0m", "6m", "7z", "7z"], dora: "6s", melds: [{ type: "chi", open: true, calledIndex: 0, tiles: ["6s", "4s", "0s"] }] };

test("tile faces and animations survive selecting and revealing the same question", () => {
  const app = harness();
  app.renderHand(question);
  const button = app.elements.handTiles.children[1];
  const face = button.children[0];
  const meld = app.elements.meldTiles.children[0];
  assert.equal(face.className, "tile-face is-dora");
  assert.equal(face.children[0].src, "tiles/0m.png");
  app.select(1);
  app.renderHand(question);
  assert.equal(app.elements.handTiles.children[1], button);
  assert.equal(button.children[0], face);
  assert.match(button.className, /selected/);
  assert.equal(button.attributes["aria-pressed"], "true");
  assert.equal(app.elements.meldTiles.children[0], meld);
  app.reveal();
  app.renderHand(question);
  assert.equal(button.disabled, true);
  assert.equal(button.children[0], face);
});

test("sideways melds and red melds use the same face, without mutating question data", () => {
  const app = harness();
  const before = JSON.stringify(question);
  app.renderHand(question);
  const tiles = app.elements.meldTiles.children[0].children;
  assert.match(tiles[0].className, /sideways/);
  assert.equal(tiles[0].children[0].className, "tile-face is-dora");
  assert.equal(tiles[1].children[0].className, "tile-face");
  assert.equal(tiles[2].children[0].className, "tile-face is-dora");
  for (const tile of tiles) {
    const image = tile.children[0].children[0];
    assert.equal(image.width, 66);
    assert.equal(image.height, 90);
  }
  assert.equal(JSON.stringify(question), before);
});

test("a different question or corrected tile data rebuilds the faces", () => {
  const app = harness();
  app.renderHand(question);
  const first = app.elements.handTiles.children[0];
  app.renderHand({ ...question, id: 168 });
  assert.notEqual(app.elements.handTiles.children[0], first);
  const second = app.elements.handTiles.children[0];
  app.renderHand({ ...question, id: 168, dora: "5m" });
  assert.notEqual(app.elements.handTiles.children[0], second);
  assert.equal(app.elements.handTiles.children[0].children[0].className, "tile-face is-dora");
});

test("explicit drawn tile stays last, selectable and aligned with normal tile faces", () => {
  const app = harness();
  const q = { ...question, hand: ["1m", "2m", "3m"], draw: "0p" };
  app.renderHand(q);
  const drawButton = app.elements.handTiles.children.at(-1);
  assert.equal(app.elements.handTiles.children.length, 4);
  assert.match(drawButton.className, /draw-tile/);
  assert.equal(drawButton.attributes["aria-label"], "ツモ牌 0pを切る");
  assert.equal(drawButton.children[0].className, "tile-face is-dora");
  app.select(3);
  app.renderHand(q);
  assert.equal(app.elements.handTiles.children.at(-1), drawButton);
  assert.equal(drawButton.attributes["aria-pressed"], "true");
});

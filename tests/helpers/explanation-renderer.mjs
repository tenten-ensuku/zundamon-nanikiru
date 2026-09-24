import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const names = ["tilePath", "explanationTilePath", "tileName", "stripDiscordMarkdown", "trimUrlPunctuation", "linkMetadata", "createLinkIcon", "setLinkContent", "explanationTileCode", "isExplanationTileBoundary", "isMahjongMiddle", "appendExplanationText", "appendFormattedText", "compactExplanationTiles", "appendLinkedText", "explanationParts", "mergeExplanationWithVideoSummary", "mergeOverrides"];

export class Element {
  nodeType = 1;
  children = [];
  get childNodes() { return this.children; }
  constructor(tag) { this.tagName = tag.toUpperCase(); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
}
const document = {
  createElement: tag => new Element(tag),
  createElementNS: (_, tag) => new Element(tag),
  createTextNode: textContent => ({ nodeType: 3, textContent }),
};
export const descendants = node => [node, ...(node.childNodes || []).flatMap(descendants)];
export const images = node => descendants(node).filter(n => n.className === "explanation-tile").map(n => ({ src: n.src, alt: n.alt }));
export const links = node => descendants(node).filter(n => n.tagName === "A").map(n => n.href);
export const visibleText = node => descendants(node).filter(n => n.nodeType === 3).map(n => n.textContent).join("");

export function createRenderer({ compact = true } = {}) {
  const functions = names.map(name => {
    if (!compact && name === "compactExplanationTiles") return "function compactExplanationTiles() { return 0; }";
    return source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name);
  }).join("\n");
  return new Function("document", `
    const APP_VERSION=1, HONOR_NAMES={1:'東',2:'南',3:'西',4:'北',5:'白',6:'發',7:'中'}, SUIT_NAMES={m:'萬',p:'筒',s:'索'};
    ${functions}
    return { appendLinkedText, compactExplanationTiles, explanationParts, mergeOverrides };
  `)(document);
}

export function render(renderer, value) {
  const target = new Element("div");
  renderer.appendLinkedText(target, value);
  return target;
}

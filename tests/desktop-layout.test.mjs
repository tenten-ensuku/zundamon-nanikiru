import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAppServer } from "../server.mjs";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const admin = await readFile(new URL("../admin.html", import.meta.url), "utf8");
const css = await readFile(new URL("../desktop.css", import.meta.url), "utf8");

test("desktop styles load after shared UI styles using the app release version", () => {
  const version = index.match(/const APP_VERSION = (\d+);/)[1];
  for (const html of [index, admin]) {
    assert.ok(html.includes(`href="desktop.css?v=${version}"`));
    assert.ok(html.indexOf('href="desktop.css') > html.indexOf('href="question-review.css'));
  }
});

test("every desktop override stays inside a desktop-width media query", () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let cursor = 0;
  let blocks = 0;
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    if (!rest.trim()) break;
    const header = rest.match(/^\s*@media\s*\(min-width:\s*(\d+)px\)[^{]*\{/);
    assert.ok(header, "A desktop rule escaped its width guard");
    assert.ok(Number(header[1]) >= 1024, "Phone/tablet rules must remain untouched");
    cursor += header[0].length;
    let depth = 1;
    while (cursor < source.length && depth) {
      if (source[cursor] === "{") depth++;
      if (source[cursor] === "}") depth--;
      cursor++;
    }
    assert.equal(depth, 0, "Unbalanced desktop stylesheet");
    blocks++;
  }
  assert.ok(blocks >= 1);
  assert.match(css, /\.menu-app:not\(\.result-app\)/);
  assert.doesNotMatch(css, /overflow(?:-y)?:\s*(?:auto|scroll)/, "Keep document-based catalog scroll restoration");
});

test("the local server serves the same versioned desktop asset as Pages", async () => {
  const { server } = createAppServer({ port: 0, editMode: "closed" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/desktop.css?v=84`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/css/);
    assert.equal(await response.text(), css);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

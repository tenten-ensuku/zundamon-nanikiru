import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const [snapshot, base, html] = await Promise.all([
  read('public/shared-overrides.json').then(JSON.parse),
  read('public/questions.json').then(JSON.parse),
  read('index.html'),
]);
// Load in the release tests, so the standalone renderer cases also run while
// the publisher is still preparing the historical release ledger.
let ledgerPromise;
const readLedger = () => ledgerPromise ??= read('data/tenten2-all-v76.json').then(JSON.parse);
const extract = name => html.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name);
const merge = new Function(`${extract('mergeExplanationWithVideoSummary')}\n${extract('mergeOverrides')}; return mergeOverrides;`)();
const merged = merge(base, snapshot.rows);
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const expectedIds = [157, 158, 160, ...range(162, 168), 170, ...range(172, 296)];

function isReleaseSnapshot(t, ledger) {
  if (snapshot.cursor === ledger.snapshotCursor) return true;
  t.skip('A later editable snapshot is present; the immutable v76 ledger contract is checked separately.');
  return false;
}

test('v76 records all 136 previously blank author bodies as AI drafts awaiting user review', async () => {
  const ledger = await readLedger();
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.revision, 76);
  assert.equal(ledger.generatedBy, 'tenten-2');
  assert.equal(ledger.status, 'awaiting-user-review');
  assert.ok(Number.isSafeInteger(ledger.snapshotCursor) && ledger.snapshotCursor > 208);
  assert.equal(ledger.requestedCount, 136);
  assert.equal(ledger.savedCount, 136);
  assert.equal(ledger.entries.length, 136);
  assert.deepEqual(ledger.entries.map(entry => entry.id).sort((a, b) => a - b), expectedIds);
  assert.deepEqual(ledger.skipped, {});
  assert.deepEqual(ledger.finalDrift, []);
  assert.deepEqual(ledger.protectedOmittedFields, ['explanation', 'overridden', 'overrideUpdatedAt']);
  for (const entry of ledger.entries) {
    assert.equal(typeof entry.beforeExplanation, 'string');
    assert.equal(entry.beforeExplanation.trim(), '', `previously blank ${entry.id}`);
    assert.equal(entry.generatedBy, 'tenten-2');
    assert.equal(entry.status, 'awaiting-user-review');
    assert.equal(typeof entry.savedOverrideUpdatedAt, 'string');
    assert.ok(Number.isFinite(Date.parse(entry.savedOverrideUpdatedAt)), `saved date ${entry.id}`);
    for (const field of ['beforeQuestionSha256', 'newTextSha256', 'protectedSha256']) {
      assert.match(entry[field], hashPattern, `${field} ${entry.id}`);
    }
  }
});

test('v76 historical ledger preserves all 156 existing author bodies and non-target questions', async () => {
  const ledger = await readLedger();
  assert.equal(ledger.untouched.beforeCount, 156);
  assert.equal(ledger.untouched.afterCount, 156);
  assert.equal(ledger.untouched.unchanged, true);
  assert.equal(ledger.preservedAuthored.count, 156);
  assert.equal(ledger.preservedAuthored.unchanged, true);
  for (const group of [ledger.untouched, ledger.preservedAuthored]) {
    assert.match(group.beforeSha256, hashPattern);
    assert.match(group.afterSha256, hashPattern);
    assert.equal(group.beforeSha256, group.afterSha256);
  }
});

test('v76 release snapshot changes only each target author body and preserves all existing content', async t => {
  const ledger = await readLedger();
  if (!isReleaseSnapshot(t, ledger)) return;
  assert.equal(merged.length, 292);
  const byId = new Map(merged.map(question => [question.id, question]));
  assert.equal(byId.size, merged.length);
  for (const entry of ledger.entries) {
    const question = byId.get(entry.id);
    assert.ok(question, `question ${entry.id}`);
    assert.ok(question.explanation.trim(), `new author body ${entry.id}`);
    assert.equal(sha(question.explanation), entry.newTextSha256, `author ${entry.id}`);
    assert.equal(question.overrideUpdatedAt, entry.savedOverrideUpdatedAt, `saved time ${entry.id}`);
    const protectedData = JSON.parse(JSON.stringify(question));
    for (const field of ledger.protectedOmittedFields) delete protectedData[field];
    assert.equal(sha(protectedData), entry.protectedSha256, `protected ${entry.id}`);
  }
  const ids = new Set(ledger.entries.map(entry => entry.id));
  const untouched = merged.filter(question => !ids.has(question.id));
  assert.equal(untouched.length, 156);
  assert.equal(sha([...untouched].sort((a, b) => a.id - b.id)), ledger.untouched.afterSha256);
  assert.ok(untouched.every(question => question.explanation.trim()), 'existing authored questions remain nonempty');
  assert.equal(sha(untouched.map(question => ({ id: question.id, explanation: question.explanation }))), ledger.preservedAuthored.afterSha256);
});

class Element {
  children = [];
  attributes = {};
  constructor(tag) { this.tagName = tag.toUpperCase(); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
}
const documentStub = {
  createElement: tag => new Element(tag),
  createTextNode: textContent => ({ tagName: '#TEXT', textContent }),
};
const rendererFunctions = [
  'tilePath', 'explanationTilePath', 'tileName', 'explanationTileCode',
  'isExplanationTileBoundary', 'isMahjongMiddle', 'appendExplanationText',
].map(extract).join('\n');
const version = Number(html.match(/const APP_VERSION = (\d+)/)?.[1]);
assert.ok(Number.isSafeInteger(version));
const renderer = new Function('document', `
  const APP_VERSION = ${version};
  const HONOR_NAMES = { 1: '東', 2: '南', 3: '西', 4: '北', 5: '白', 6: '發', 7: '中' };
  const SUIT_NAMES = { m: '萬', p: '筒', s: '索' };
  ${rendererFunctions}
  return { appendExplanationText, explanationTilePath };
`)(documentStub);
const allNodes = node => [node, ...(node.children || []).flatMap(allNodes)];

// This expectation is independent of the app tokenizer: suit runs are expanded
// one digit at a time (including red 0), while honors are always a single tile.
const canonicalCodes = value => [...value.matchAll(/([0-9]+)([mps])|([1-7]z)/g)]
  .flatMap(match => match[3] ? [match[3]] : [...match[1]].map(digit => digit + match[2]));
const checkedAssets = new Set();
async function assertRendered(value, expected, label) {
  const target = new Element('div');
  renderer.appendExplanationText(target, value);
  const nodes = allNodes(target);
  const images = nodes.filter(node => node.className === 'explanation-tile');
  assert.deepEqual(images.map(node => node.src), expected.map(renderer.explanationTilePath), `tile order ${label}`);
  for (const image of images) {
    assert.equal(image.width, 66);
    assert.equal(image.height, 90);
    assert.equal(image.decoding, 'async');
    const path = image.src.split('?')[0];
    assert.match(path, /^tiles\/(?:explanation\/)?(?:man[1-9]|pin[1-9]|sou[1-9]|aka[1-3]|ji[1-7])-66-90-l\.png$/);
    if (!checkedAssets.has(path)) {
      const bytes = await readFile(new URL('../' + path, import.meta.url));
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `approved PNG exists ${path}`);
      checkedAssets.add(path);
    }
  }
  const remainingText = nodes.filter(node => node.tagName === '#TEXT').map(node => node.textContent).join('');
  assert.doesNotMatch(remainingText, /[0-9]+[mps]|[1-7]z/, `unconverted tile code ${label}`);
  return { images, remainingText };
}

test('every canonical tile in all 136 v76 bodies renders in order with an existing asset', async t => {
  const ledger = await readLedger();
  if (!isReleaseSnapshot(t, ledger)) return;
  const byId = new Map(merged.map(question => [question.id, question]));
  for (const entry of ledger.entries) {
    const value = byId.get(entry.id).explanation;
    assert.doesNotMatch(value, /[０-９][ｍｐｓｚ]|<img|[🀀-🀫]/u, `canonical source ${entry.id}`);
    const expected = canonicalCodes(value);
    assert.ok(expected.length > 0, `tile references ${entry.id}`);
    await assertRendered(value, expected, `question ${entry.id}`);
  }
});

for (const [shape, expected] of [
  ['455567p', ['4p', '5p', '5p', '5p', '6p', '7p']],
  ['446688p', ['4p', '4p', '6p', '6p', '8p', '8p']],
  ['4506p', ['4p', '5p', '0p', '6p']],
  ['3s・6s・9s', ['3s', '6s', '9s']],
]) {
  test(`compact-shape renderer: ${shape}`, async () => {
    assert.deepEqual(canonicalCodes(shape), expected);
    const result = await assertRendered(`形は${shape}。`, expected, shape);
    assert.equal(result.remainingText, shape.includes('・') ? '形は・・。' : '形は。');
    if (shape === '4506p') {
      assert.equal(result.images[1].src.split('?')[0], 'tiles/explanation/pin5-66-90-l.png');
      assert.equal(result.images[2].src.split('?')[0], 'tiles/aka2-66-90-l.png');
    }
  });
}

test('compact-shape renderer keeps all red suits and single honors distinct', async () => {
  const value = '405m・405p・405s、1z・2z・3z・4z・5z・6z・7z';
  const result = await assertRendered(value, [
    '4m', '0m', '5m', '4p', '0p', '5p', '4s', '0s', '5s', ...range(1, 7).map(n => `${n}z`),
  ], 'red suits and honors');
  assert.deepEqual([1, 4, 7].map(i => result.images[i].src.split('?')[0]), [
    'tiles/aka1-66-90-l.png', 'tiles/aka2-66-90-l.png', 'tiles/aka3-66-90-l.png',
  ]);
});

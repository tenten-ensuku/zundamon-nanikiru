import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');
const ledger=JSON.parse(await read('data/tenten2-pilot-v74.json'));
const snapshot=JSON.parse(await read('public/shared-overrides.json'));
const base=JSON.parse(await read('public/questions.json'));
const html=await read('index.html');
const extract=name=>html.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))?.[0]||assert.fail(name);
const merge=new Function(`${extract('mergeExplanationWithVideoSummary')}\n${extract('mergeOverrides')};return mergeOverrides;`)();
const merged=merge(base,snapshot.rows);
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

test('v74 pilot records exactly ten previously empty author explanations as AI drafts for user review',()=>{
  assert.equal(ledger.revision,74);
  assert.equal(ledger.generatedBy,'tenten-2');
  assert.equal(ledger.status,'awaiting-user-review');
  assert.deepEqual(ledger.entries.map(e=>e.id),[14,15,27,58,59,61,62,133,136,156]);
  assert.equal(ledger.untouched.beforeCount,282);
  assert.equal(ledger.untouched.afterCount,282);
  for(const e of ledger.entries){
    assert.equal(e.beforeExplanation.trim(),'');
    assert.equal(e.generatedBy,'tenten-2');
    assert.equal(e.status,'awaiting-user-review');
    for(const key of ['beforeQuestionSha256','newTextSha256','protectedSha256'])assert.match(e[key],/^[a-f0-9]{64}$/);
  }
});

test('v74 release snapshot changes only the target author body and preserves its video, tiles, answer, difficulty and review',()=>{
  // Later intentional shared edits are allowed. This is the immutable release
  // contract for this exact snapshot, not a prohibition on future user review.
  if(snapshot.cursor!==ledger.snapshotCursor)return;
  for(const e of ledger.entries){
    const q=merged.find(q=>q.id===e.id);
    assert.equal(sha(q.explanation),e.newTextSha256,`author ${e.id}`);
    assert.equal(q.overrideUpdatedAt,e.savedOverrideUpdatedAt);
    const protectedData=JSON.parse(JSON.stringify(q));
    for(const key of ledger.protectedOmittedFields)delete protectedData[key];
    assert.equal(sha(protectedData),e.protectedSha256,`protected ${e.id}`);
  }
  assert.deepEqual(ledger.concurrentChangesPreserved,[{id:30,fields:['explanation','overrideUpdatedAt']}]);
});

class Element{
  children=[];attributes={};
  constructor(tag){this.tagName=tag.toUpperCase();}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(k,v){this.attributes[k]=v;}
}
const doc={createElement:tag=>new Element(tag),createTextNode:textContent=>({tagName:'#TEXT',textContent})};
const functions=['tilePath','explanationTilePath','tileName','explanationTileCode','isExplanationTileBoundary','isMahjongMiddle','appendExplanationText'].map(extract).join('\n');
const renderer=new Function('document',`const APP_VERSION=74,HONOR_NAMES={1:'東',2:'南',3:'西',4:'北',5:'白',6:'發',7:'中'},SUIT_NAMES={m:'萬',p:'筒',s:'索'};${functions};return {appendExplanationText,explanationTilePath};`)(doc);
const all=node=>[node,...(node.children||[]).flatMap(all)];
test('every canonical tile in the ten pilot texts renders in order with an existing approved asset',async()=>{
  if(snapshot.cursor!==ledger.snapshotCursor)return;
  for(const e of ledger.entries){
    const value=merged.find(q=>q.id===e.id).explanation;
    assert.doesNotMatch(value,/[0-9]{2,}[mps]|[０-９][ｍｐｓ]|<img|[🀀-🀫]/u);
    const expected=value.match(/(?:[0-9][mps]|[1-7]z)/g)||[];
    const target=new Element('div');renderer.appendExplanationText(target,value);
    const images=all(target).filter(n=>n.className==='explanation-tile');
    assert.deepEqual(images.map(n=>n.src),expected.map(renderer.explanationTilePath),`tile order ${e.id}`);
    for(const src of new Set(images.map(n=>n.src)))assert.ok((await readFile(new URL('../'+src.split('?')[0],import.meta.url))).length>0);
    assert.doesNotMatch(all(target).filter(n=>n.tagName==='#TEXT').map(n=>n.textContent).join(''),/[0-9][mpsz]/);
  }
});

test('app and Worker release versions agree and preview editing stays open',async()=>{
  const version=Number(html.match(/const APP_VERSION = (\d+)/)[1]);
  assert.ok(version>=74);
  assert.match(await read('cloudflare/worker.mjs'),new RegExp(`version:${version},storage`));
  assert.match(await read('config.js'),/releaseStage: "preview"/);
  assert.match(await read('cloudflare/wrangler.jsonc'),/"QUESTION_EDIT_MODE": "open"/);
});

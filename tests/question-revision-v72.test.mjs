import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { beforeV72, revisionV72 } from "./helpers/revision-v72.mjs";
import { validQuestion } from "../cloudflare/worker-model.mjs";

const questions = JSON.parse(await readFile(new URL("../public/questions.json", import.meta.url), "utf8"));
const byId = id => questions.find(q => q.id === id);
const hash = value => createHash("sha256").update(value).digest("hex");
const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
const grade = new Function(`${source.match(/    function gradeAnswer\([^]*?\n    }/)[0]}; return gradeAnswer;`)();

test("v72 modifies only the 40 explicitly audited questions and preserves every author byte", () => {
  assert.equal(revisionV72.revision, 72);
  assert.equal(revisionV72.changes.length, 40);
  assert.equal(revisionV72.beforeQuestionHashes.length, 292);
  for (const expected of revisionV72.beforeQuestionHashes) {
    const q = byId(expected.id);
    assert.equal(hash(q.explanation), expected.authorSha256, `author ${q.id}`);
    assert.equal(hash(JSON.stringify(beforeV72(q))), expected.sha256, `unapproved change ${q.id}`);
  }
  for (const item of revisionV72.changes) {
    for (const key of ["explanation", "reviewed", "reviewStatus", "reviewUpdatedAt"]) assert.equal(key in item.fields, false);
    assert.ok(item.reasons.length);
    if (item.id !== 295) assert.ok(item.evidence.length);
    for (const e of item.evidence) { assert.match(e.url, /^https:\/\/youtu\.be\//); assert.match(e.sha256, /^[a-f0-9]{64}$/); }
  }
});

test("all 292 corrected records remain valid, complete and separately editable", () => {
  assert.equal(questions.length, 292);
  assert.equal(new Set(questions.map(q => q.id)).size, 292);
  for (const q of questions) {
    assert.ok(validQuestion(q, q.id), `valid question ${q.id}`);
    assert.ok(q.correctDiscards.length || q.correctKan === true, `registered decision ${q.id}`);
    assert.ok(q.videoExplanation?.trim(), `summary ${q.id}`);
  }
  const revisions = questions.filter(q => q.videoExplanationSource?.revision === 72);
  assert.deepEqual(revisions.map(q => q.id), [20,66,118,125,138,139,149,167,169,180,202,217,228,268,284]);
  for (const q of revisions) {
    assert.match(q.videoExplanation, /のだ/);
    assert.doesNotMatch(q.videoExplanation, /[0-9一二三四五六七八九][萬万筒索]|[0-9]{2,}[mpsz]|[０-９][ｍｐｓｚ]|<[^>]+>/);
    assert.equal(q.videoExplanationSource.url, q.sourceUrl);
  }
});

test("newly confirmed video answers and north-riichi decision are actually graded", () => {
  for (const [id, tile] of [[156,"8p"],[157,"1s"],[158,"7p"],[159,"6m"],[160,"6s"],[163,"6p"],[164,"7s"],[165,"2p"]]) {
    assert.deepEqual(byId(id).correctDiscards, [tile]);
    assert.deepEqual(byId(id).videoCorrectDiscards, [tile]);
    assert.equal(byId(id).answerSource.revision, 72);
    assert.deepEqual(grade(byId(id), {tile}), {graded:true,correct:true});
    const wrong = byId(id).hand.find(t => t !== tile);
    assert.deepEqual(grade(byId(id), {tile:wrong}), {graded:true,correct:false});
  }
  assert.deepEqual(grade(byId(66), {tile:"4z",riichi:true}), {graded:true,correct:true});
  assert.deepEqual(grade(byId(66), {tile:"4z",riichi:false}), {graded:true,correct:false});
  assert.deepEqual(byId(169).videoCorrectDiscards, ["2m"]);
  assert.equal(byId(169).answerSource.kind, "instructor-and-video");
});

test("corrected red fives, dora and explicitly separate draws cannot regress", () => {
  assert.ok(byId(217).hand.includes("0s"));
  assert.ok(byId(217).hand.includes("7s"));
  assert.ok(!byId(217).hand.includes("9s"));
  assert.ok(byId(272).hand.includes("0m"));
  assert.ok(!byId(272).hand.includes("5m"));
  assert.equal(byId(270).dora, "1m");
  assert.equal(byId(277).draw, "2s");
  assert.ok(byId(277).hand.includes("3s"));
  assert.ok(!byId(295).hand.includes("2s"));
  assert.ok(byId(295).hand.includes("3s"));
});

// A separate complete-hand decomposition oracle: unlike the audit's shanten
// calculator, this enumerates a pair + melds, and checks every drawn tile.
const code = i => `${i % 9 + 1}${"mpsz"[Math.floor(i / 9)]}`;
const index = t => "mpsz".indexOf(t[1]) * 9 + (t[0] === "0" ? 4 : Number(t[0]) - 1);
const counts = tiles => { const c=Array(34).fill(0);for(const t of tiles)c[index(t)]++;return c; };
const completeCache = new Map();
function complete(c, open=0) {
  const key=`${open}:${c.join("")}`;
  if(completeCache.has(key))return completeCache.get(key);
  const solve = () => {
    if(c.some(n=>n>4)||c.reduce((a,b)=>a+b,0)!==14-3*open)return false;
    if(!open && c.filter(n=>n===2).length===7)return true;
    const terminals=[0,8,9,17,18,26,27,28,29,30,31,32,33];
    if(!open&&terminals.every(i=>c[i])&&terminals.some(i=>c[i]===2))return true;
    const melds = () => {
      const i=c.findIndex(n=>n>0);if(i<0)return true;
      if(c[i]>=3){c[i]-=3;const ok=melds();c[i]+=3;if(ok)return true;}
      if(i<27&&i%9<=6&&c[i+1]&&c[i+2]){c[i]--;c[i+1]--;c[i+2]--;const ok=melds();c[i]++;c[i+1]++;c[i+2]++;if(ok)return true;}
      return false;
    };
    for(let i=0;i<34;i++)if(c[i]>=2){c[i]-=2;const ok=melds();c[i]+=2;if(ok)return true;}
    return false;
  };
  const answer=solve();completeCache.set(key,answer);return answer;
}
function waits(c,open=0){const result=[];for(let i=0;i<34;i++)if(c[i]<4){c[i]++;if(complete(c,open))result.push(i);c[i]--;}return result;}
function afterCut(id,cut){const q=byId(id),c=counts([...q.hand,...(q.draw?[q.draw]:[])]);assert.ok(c[index(cut)]);c[index(cut)]--;return {q,c};}
function effective(id,cut){
  const {q,c}=afterCut(id,cut),open=q.melds.length;
  const known=counts([...q.hand,...(q.draw?[q.draw]:[]),...q.melds.flatMap(m=>m.tiles)]);
  if(q.dora){const d=index(q.dora);const indicator=d<27?Math.floor(d/9)*9+(d%9+8)%9:d<31?27+(d-27+3)%4:31+(d-31+2)%3;known[indicator]++;}
  const tiles=[];let remaining=0;
  for(let i=0;i<34;i++)if(known[i]<4){
    c[i]++;let ready=complete(c,open);
    if(!ready)for(let j=0;j<34;j++)if(c[j]){c[j]--;const ok=waits(c,open).length>0;c[j]++;if(ok){ready=true;break;}}
    c[i]--;if(ready){tiles.push(code(i));remaining+=4-known[i];}
  }
  return {tiles,remaining};
}
test("rewritten tenpai summaries use the independently decomposed waits", () => {
  for(const [id,cut,expected]of [[125,"7p",["3s","5s","6s","8s"]],[139,"2p",["1p","4p","6p","7p"]],[167,"6m",["5m","7z"]],[167,"5m",["4m","7m","7z"]],[202,"7m",["2m","5m"]],[202,"4m",["2m","5m","8m"]]]){
    const {q,c}=afterCut(id,cut);assert.deepEqual(waits(c,q.melds.length).map(code),expected,`${id}/${cut}`);
  }
  assert.match(byId(167).videoExplanation,/5mでは役がなく/);
  assert.match(byId(167).videoExplanation,/フリテン/);
  assert.match(byId(118).videoExplanation,/3pや7p/);
  assert.match(byId(118).videoExplanation,/5p.*完成/);
});
test("rewritten one-away summaries have the verified tile types and remaining counts", () => {
  for(const [id,cut,tiles,remaining]of [
    [138,"3s",["5p","6p","8p","9p","6s","9s"],20],
    [169,"2m",["6m","9m","6p","8p"],15],
    [217,"6m",["3p","6p","2s","5s","8s"],19],
    [268,"3p",["6m","9m","4p","6p","9p"],18],
    [284,"3m",["4m","6m","9m","5p","8p"],19],
  ])assert.deepEqual(effective(id,cut),{tiles,remaining},`${id}/${cut}`);
  assert.match(byId(228).videoExplanation,/2s・5s/);
  assert.match(byId(180).videoExplanation,/5sを引く手替わりまでなくなるわけではない/);
});

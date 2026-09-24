import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {validQuestion} from '../cloudflare/worker-model.mjs';
const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const [base,snapshot,ledger]=await Promise.all(['public/questions.json','public/shared-overrides.json','data/question-124-correction-v82.json'].map(read));
const q=base.find(q=>q.id===124), row=snapshot.rows.find(r=>r.id===124);
test('Q124 baseline and shared answer correctly discard 6m, not 8m',()=>{
  for(const question of [q,{...q,...row.questionData}]){
    assert.ok(validQuestion(question,124));
    assert.deepEqual(question.correctDiscards,['6m']);
    assert.deepEqual(question.videoCorrectDiscards,['6m']);
    assert.equal(question.draw,'1p');assert.equal(question.dora,'9s');
    assert.deepEqual(question.hand,['6m','8m','9m','9m','9m','1p','1p','2s','3s','4s','0s','7s','9s']);
    assert.notEqual(question.riichiChoice,true,'Future 6s draw is not a current riichi question');
  }
});
test('Q124 video explanation follows verified frames and distinguishes the future draw',()=>{
  assert.match(q.videoExplanation,/^おすすめは6m切り/);
  assert.match(q.videoExplanation,/1pを引いて雀頭だった1pが暗刻/);
  assert.match(q.videoExplanation,/8999m/);
  assert.match(q.videoExplanation,/789mと99m/);
  assert.match(q.videoExplanation,/先に6sを引いた場合/);
  assert.match(q.videoExplanation,/ドラ9sを切って7m・8m待ちでリーチ/);
  assert.doesNotMatch(q.videoExplanation,/おすすめは8m|6mと9mの暗刻/);
  assert.equal(q.videoExplanation,row.questionData.videoExplanation);
  assert.deepEqual(q.videoExplanationSource.reviewedTimestamps,[1,17.5,20,24,28,33,37,42,47]);
  assert.equal(ledger.protectedSha256,ledger.afterProtectedSha256);
  assert.equal(ledger.sourceUrl,'https://youtu.be/mpHrvC2BYG0');
  assert.equal(row.explanation,'','Do not restore the removed source-only author comment');
});

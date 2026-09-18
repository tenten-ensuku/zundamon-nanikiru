import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const questions=JSON.parse(await readFile(new URL('../public/questions.json',import.meta.url),'utf8'));
const ledger=JSON.parse(await readFile(new URL('../data/content-corrections-v79.json',import.meta.url),'utf8'));
const q=id=>questions.find(x=>x.id===id);
test('Q123 keeps the red five and discards the normal five-pin',()=>{
  assert.deepEqual(q(123).correctDiscards,['5p']);
  assert.deepEqual(q(123).videoCorrectDiscards,['5p']);
  assert.ok(q(123).hand.includes('5p') && q(123).hand.includes('0p'));
  assert.match(q(123).videoExplanation,/^ここは5p切り/);
});
test('Q275 retains its first explanation block but removes the requested headless tail',()=>{
  assert.match(q(275).videoExplanation,/今回は雀頭がないので/);
  assert.match(q(275).videoExplanation,/雀頭と1面子を作りやすいのだ。$/);
  assert.doesNotMatch(q(275).videoExplanation,/ヘッドレス/);
});
test('all nine audited missing decisions have a complete, provenance-labelled answer key',()=>{
  assert.deepEqual(ledger.riichiAdded,[44,57,86,89,97,122,125,126,150]);
  for(const id of ledger.riichiAdded){
    assert.equal(q(id).riichiChoice,true);
    assert.equal(q(id).correctRiichi,true);
    assert.ok(q(id).correctDiscards.length);
    const source=q(id).riichiDecisionSource;
    if([125,126,150].includes(id)){
      assert.equal(source.kind,'theory-supplement');
      assert.equal(source.videoExplicitRiichi,false);
      assert.ok(source.assumption && source.theoryDocumentId);
    } else {
      assert.equal(source.kind,'video-frame');
      assert.ok(source.seconds>0 && /リーチ|ダマにするのは/.test(source.conclusion));
    }
  }
});

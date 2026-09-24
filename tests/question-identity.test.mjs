import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const extract=name=>html.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))?.[0]||assert.fail(name);
function harness(){
  const nodes=Object.fromEntries(['counter','playQuestionId','reviewQuestionId'].map(id=>[id,{textContent:''}]));
  const api=new Function('document',`
    let currentIndex=0;const playQuestions=[{id:77},{id:275},{id:123}];
    ${extract('renderQuestionIdentity')}
    return {show:index=>{currentIndex=index;renderQuestionIdentity(playQuestions[index]);},questions:playQuestions};
  `)({getElementById:id=>nodes[id]});
  return {...api,nodes};
}

test('shuffled play uses the stable question ID, separately from session order',()=>{
  const app=harness(),original=JSON.stringify(app.questions);
  for(const [position,id]of [[0,77],[2,123],[1,275],[0,77]]){
    app.show(position);
    assert.equal(app.nodes.counter.textContent,`第 ${position+1} / 3 問`);
    assert.equal(app.nodes.playQuestionId.textContent,`問題 No.${id}`);
    assert.equal(app.nodes.reviewQuestionId.textContent,`No.${id}`);
  }
  assert.equal(JSON.stringify(app.questions),original);
});

test('every question render updates both IDs, regardless of answer state or session mode',()=>{
  assert.match(extract('renderQuestion'),/const question = playQuestions\[currentIndex\]/);
  assert.match(extract('renderQuestion'),/\n      renderQuestionIdentity\(question\);/);
  const identity=extract('renderQuestionIdentity');
  assert.doesNotMatch(identity,/state\.session|revealed|localStorage|fetch\(/);
  assert.equal((html.match(/id="playQuestionId"/g)||[]).length,1);
  assert.equal((html.match(/id="reviewQuestionId"/g)||[]).length,1);
  assert.match(html,/<h2>解説<small class="question-id" id="reviewQuestionId"><\/small><\/h2>/);
});

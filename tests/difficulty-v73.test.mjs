import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {beforeV73,revisionV73} from './helpers/revision-v73.mjs';
import {createAppServer} from '../server.mjs';
import {validQuestion} from '../cloudflare/worker-model.mjs';
const root=path.resolve(import.meta.dirname,'..');
const read=file=>readFile(path.join(root,file),'utf8');
const questions=JSON.parse(await read('public/questions.json'));
const source=await read('index.html');
const metadataSource=await read('question-metadata.js');
const context={window:{},URL};vm.runInNewContext(metadataSource,context);
const metadata=context.window.ZUNDAMON_QUESTION_METADATA;
const plain=value=>JSON.parse(JSON.stringify(value));
const extract=name=>source.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    }`))?.[0]||assert.fail(name);

test('v73 classifies exactly 292 unique questions while preserving every previous content byte',()=>{
  assert.equal(questions.length,292);assert.equal(revisionV73.entries.length,292);
  for(const q of questions){
    const expected=revisionV73.entries.find(e=>e.id===q.id);
    assert.equal(createHash('sha256').update(JSON.stringify(beforeV73(q))).digest('hex'),expected.beforeSha256,`content ${q.id}`);
    assert.ok(validQuestion(q,q.id));assert.ok(expected.reason);assert.equal(metadata.questionDifficulty(q),expected.difficulty);
  }
  assert.deepEqual(revisionV73.counts,{beginner:58,intermediate:153,advanced:81});
  assert.equal(revisionV73.entries.filter(e=>e.provisional).length,211);
});
test('exactly the approved 81 migrate; saved manual choices override playlist and release stage',async()=>{
  const previous=JSON.parse(await read('data/playlist-review-v68.json'));
  assert.deepEqual(questions.filter(q=>q.difficulty==='advanced').map(q=>q.id),previous.intermediateOnlyIds);
  const q=questions.find(q=>q.difficulty==='advanced');
  assert.equal(metadata.difficultyLabel({...q,difficulty:'beginner'}),'初級');
  assert.equal(metadata.difficultyLabel(q),'中級～上級');
  context.window.ZUNDAMON_CONFIG={releaseStage:'public'};
  assert.equal(metadata.difficultyLabel(q),'中級～上級');
  const old=beforeV73(q);assert.equal(metadata.questionDifficulty(old),'advanced');
  assert.equal(metadata.questionDifficulty({...old,sourceUrl:'https://youtu.be/DIFFERENT01'}),'beginner');
  assert.deepEqual(plain(metadata.DIFFICULTIES.map(d=>d.label)),['初級','中級','中級～上級']);
});
test('10/all challenges are restricted to the chosen difficulty and never duplicate questions',()=>{
  const make=new Function('metadata','questions',`const {filterByDifficulty}=metadata;const state={settings:{difficulty:'beginner'}};let session;function createSession(mode,ids,position,difficulty){session={mode,ids,position,difficulty}};${extract('shuffledIds')}\n${extract('startChallenge')};return {startChallenge,get:()=>session};`);
  for(const difficulty of ['beginner','intermediate','advanced'])for(const mode of ['ten','all']){
    const api=make(metadata,questions);api.startChallenge(mode,difficulty);const session=api.get();
    assert.equal(session.ids.length,mode==='ten'?10:revisionV73.counts[difficulty]);assert.equal(new Set(session.ids).size,session.ids.length);
    assert.ok(session.ids.every(id=>questions.find(q=>q.id===id).difficulty===difficulty));assert.equal(session.difficulty,difficulty);
  }
  const small=make(metadata,[questions[0]]);small.startChallenge('ten',questions[0].difficulty);assert.deepEqual(small.get().ids,[questions[0].id]);
  const empty=make(metadata,[]);empty.startChallenge('ten','beginner');assert.equal(empty.get(),undefined);
});
test('old settings, ongoing sessions and results keep their IDs and history; new choice survives reload',()=>{
  const normalize=new Function('isDifficulty','ZundamonAnswerFeedback',`${extract('defaultState')}\n${extract('normalizeState')};return normalizeState;`)(metadata.isDifficulty,{DEFAULT_VOLUME:40,normalizeVolume:v=>v??40});
  const old={responses:{1:{correct:true}},wrongIds:[2],favoriteIds:[3],questionStats:{1:{total:2,correct:1}},results:[{mode:'ten',correct:5,graded:10}],settings:{nickname:'保持',soundVolume:0},session:{mode:'all',ids:[1,2,3],position:2,responses:{1:{correct:true}}}};
  const result=normalize(old);
  for(const key of ['responses','wrongIds','favoriteIds','questionStats','results'])assert.deepEqual(result[key],old[key]);
  assert.deepEqual(result.session.ids,old.session.ids);assert.equal(result.session.position,2);assert.equal(result.session.difficulty,undefined);
  assert.equal(result.settings.difficulty,'beginner');assert.equal(result.settings.soundVolume,0);
  result.settings.difficulty='advanced';assert.equal(normalize(JSON.parse(JSON.stringify(result))).settings.difficulty,'advanced');
  assert.equal(normalize({settings:{difficulty:'invalid'}}).settings.difficulty,'beginner');
});
test('catalog and mixed cache merge respect manual difficulty, without erasing content',()=>{
  const merge=new Function(`${extract('mergeExplanationWithVideoSummary')}\n${extract('mergeOverrides')};return mergeOverrides;`)();
  const q=questions[0],other=q.difficulty==='beginner'?'intermediate':'beginner';
  const merged=merge([q],[{id:q.id,questionData:{difficulty:other}}]);
  assert.equal(merged[0].difficulty,other);for(const key of ['hand','explanation','videoExplanation','correctDiscards','draw','melds'])assert.deepEqual(merged[0][key],q[key]);
  const legacy=merge([q],[{id:q.id,questionData:{note:'existing'}}]);assert.equal(legacy[0].difficulty,q.difficulty);
  assert.equal(metadata.filterByDifficulty(merged,other).length,1);assert.equal(metadata.filterByDifficulty(merged,q.difficulty).length,0);
  const catalog=new Function('questions','filterByDifficulty',`let problemDifficulty='intermediate',session;function createSession(mode,ids,position){session={mode,ids,position}};${extract('openCatalogQuestion')};return {openCatalogQuestion,get:()=>session};`)(questions,metadata.filterByDifficulty);
  const target=questions.find(q=>q.difficulty==='intermediate');catalog.openCatalogQuestion(target.id);assert.equal(catalog.get().ids.length,153);assert.equal(catalog.get().ids[catalog.get().position],target.id);
});
test('local difficulty-only save validates, detects conflicts and preserves content/review after reload',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'zundamon-v73-')),basePath=path.join(dir,'questions.json'),overridesPath=path.join(dir,'overrides.json');
  const q=questions[0];await writeFile(basePath,JSON.stringify([q]));
  const app=createAppServer({rootDir:root,basePath,overridesPath,editMode:'open',port:0});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=(endpoint,method,body)=>fetch(origin+endpoint,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  try{
    const review=await request('/api/admin/questions/1','PATCH',{reviewStatus:'complete',expectedReviewUpdatedAt:null}).then(r=>r.json());
    const r=await request('/api/admin/questions/1/difficulty','PATCH',{difficulty:'beginner',expectedUpdatedAt:null});assert.equal(r.status,200);const saved=await r.json();
    const merged=await request('/api/questions','GET').then(r=>r.json());assert.equal(merged[0].difficulty,'beginner');
    for(const key of ['hand','draw','explanation','videoExplanation','correctDiscards','melds'])assert.deepEqual(merged[0][key],q[key],key);
    assert.equal(merged[0].reviewUpdatedAt,review.reviewUpdatedAt);assert.equal(merged[0].reviewStatus,'complete');
    const stored=JSON.parse(await readFile(overridesPath,'utf8'));assert.deepEqual(stored[1].questionData,{difficulty:'beginner'});
    assert.equal((await request('/api/admin/questions/1/difficulty','PATCH',{difficulty:'advanced',expectedUpdatedAt:null})).status,409);
    assert.equal((await request('/api/admin/questions/1/difficulty','PATCH',{difficulty:'bad',expectedUpdatedAt:saved.overrideUpdatedAt})).status,400);
    assert.equal((await request('/api/admin/questions/1/difficulty','PATCH',{difficulty:'advanced'})).status,400);
  }finally{await new Promise(r=>app.server.close(r));assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
});

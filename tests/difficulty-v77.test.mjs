import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {revisionV77} from './helpers/revision-v77.mjs';
const read = file => readFile(new URL('../'+file, import.meta.url), 'utf8');
const base = JSON.parse(await read('public/questions.json'));
const html = await read('index.html'), context = {window:{},URL};
vm.runInNewContext(await read('question-metadata.js'),context);
const metadata=context.window.ZUNDAMON_QUESTION_METADATA;
const extract=name=>html.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    }`))?.[0]||assert.fail(name);
const plain=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('v77 partitions 292 IDs into two levels, preserving all non-difficulty base fields',()=>{
  assert.equal(base.length,292);assert.equal(new Set(base.map(q=>q.id)).size,292);
  assert.equal(revisionV77.entries.length,292);
  assert.ok(revisionV77.counts.beginner>=160&&revisionV77.counts.beginner<=200);
  assert.equal(revisionV77.counts.beginner+revisionV77.counts.intermediate,292);
  for(const q of base){
    const entry=revisionV77.entries.find(e=>e.id===q.id), protectedData={...q};delete protectedData.difficulty;
    assert.equal(sha(protectedData),entry.baseProtectedSha256,`content ${q.id}`);
    assert.equal(q.difficulty,entry.difficulty);assert.ok(entry.reason.trim());
    assert.ok(['beginner','intermediate'].includes(q.difficulty));
  }
  for(const difficulty of ['beginner','intermediate'])assert.equal(base.filter(q=>q.difficulty===difficulty).length,revisionV77.counts[difficulty]);
});

test('all beginner-exclusive sources are beginner and membership is tied to the actual video',()=>{
  const B='PLsPI0JcKZ3E7QqaFQpJsLkmkS7dZlPXRv',I='PLsPI0JcKZ3E75g3aLjIL1ofwMsyvFJjCH';
  const groups={beginnerOnly:[],both:[],intermediateOnly:[]};
  for(const q of base){
    assert.equal(q.sourcePlaylistMembership.videoId,metadata.youtubeVideoId(q.sourceUrl));
    const ids=q.sourcePlaylistMembership.playlistIds;
    const group=ids.includes(B)?ids.includes(I)?'both':'beginnerOnly':'intermediateOnly';groups[group].push(q);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),{beginnerOnly:46,both:165,intermediateOnly:81});
  assert.ok(groups.beginnerOnly.every(q=>q.difficulty==='beginner'));
  assert.ok(groups.intermediateOnly.every(q=>q.difficulty==='intermediate'));
  const sample=groups.beginnerOnly[0],old={...sample};delete old.difficulty;
  assert.equal(metadata.questionDifficulty(old),'beginner');
  assert.equal(metadata.questionDifficulty({...old,sourceUrl:'https://youtu.be/DIFFERENT01'}),'intermediate');
  assert.equal(metadata.questionDifficulty({...sample,difficulty:'intermediate'}),'intermediate','manual changes must remain possible');
});

test('legacy settings migrate while progress, ongoing session and historical classifications stay intact',()=>{
  const normalize=new Function('isDifficulty','ZundamonAnswerFeedback',`${extract('defaultState')}\n${extract('normalizeState')};return normalizeState;`)(metadata.isDifficulty,{DEFAULT_VOLUME:40,normalizeVolume:v=>v??40});
  const old={settings:{difficulty:'advanced',nickname:'保持',soundVolume:0},favoriteIds:[54],wrongIds:[55],questionStats:{54:{total:2,correct:1}},results:[{mode:'all',difficulty:'advanced',total:81}],session:{mode:'all',difficulty:'advanced',ids:[169,170,171],position:1,responses:{169:{correct:true}}}};
  const result=normalize(structuredClone(old));
  assert.equal(result.settings.difficulty,'intermediate');
  for(const key of ['favoriteIds','wrongIds','questionStats','results'])assert.deepEqual(result[key],old[key]);
  assert.equal(result.session.difficulty,'advanced');assert.deepEqual(result.session.ids,old.session.ids);assert.equal(result.session.position,1);
  assert.equal(metadata.recordDifficultyLabel(result.results[0]),'中級～上級（旧区分）');
  assert.equal(metadata.recordDifficultyLabel({difficulty:'beginner'}),'初級（旧区分）');
  assert.equal(metadata.recordDifficultyLabel({difficulty:'beginner',difficultyRevision:77}),'初級');
  assert.equal(metadata.questionDifficulty({difficulty:'advanced'}),'intermediate');
  assert.deepEqual(plain(metadata.DIFFICULTIES.map(item=>item.id)),['beginner','intermediate']);
  const create=new Function(`const state={};const saveState=()=>{},resumeSession=()=>{};${extract('createSession')};return {createSession,get:()=>state.session};`)();
  create.createSession('ten',[1,2],0,'beginner');assert.equal(create.get().difficultyRevision,77);
});

test('v77 shared snapshot preserves every effective content and review field during difficulty-only migration',async t=>{
  const migration=JSON.parse(await read('data/difficulty-migration-v77.json'));
  const snapshot=JSON.parse(await read('public/shared-overrides.json'));
  assert.equal(migration.revision,77);assert.equal(migration.finalDrift.length,0);assert.deepEqual(migration.skipped,{});
  if(snapshot.cursor!==migration.snapshotCursor){t.skip('Later shared edits; immutable migration ledger remains checked.');return;}
  const merge=new Function(`${extract('mergeExplanationWithVideoSummary')}\n${extract('mergeOverrides')};return mergeOverrides;`)();
  const effective=merge(base,snapshot.rows);assert.equal(effective.length,292);
  for(const q of effective){
    const entry=revisionV77.entries.find(e=>e.id===q.id),protectedData=plain(q);
    for(const field of ['difficulty','overridden','overrideUpdatedAt'])delete protectedData[field];
    assert.equal(sha(protectedData),entry.effectiveProtectedSha256,`effective content ${q.id}`);
    assert.equal(q.difficulty,entry.difficulty,`effective classification ${q.id}`);
  }
});

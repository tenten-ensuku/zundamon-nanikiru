import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import worker from "../cloudflare/worker.mjs";
import { validQuestion } from "../cloudflare/worker-model.mjs";
import { importSql, checksum } from "../cloudflare/prepare-import.mjs";
const schema=await readFile(new URL("../cloudflare/migrations/0001_questions.sql",import.meta.url),"utf8");
const fixture={id:1,hand:["1m","2m","3m","4p","0p","5s","6s","7s","1z","1z","2z","3z","4z"],draw:"5z",dora:"2m",melds:[],explanation:"  作者の文\n",videoExplanation:"5zを切るのだ。",correctDiscards:["5z"]};
function harness(mode="open") {
  const sqlite=new DatabaseSync(":memory:");sqlite.exec(schema);
  const db={prepare(sql){const statement=sqlite.prepare(sql);let params=[];const query={bind(...args){params=args;return query;},async first(){return statement.get(...params)||null;},async all(){return{results:statement.all(...params)};}};return query;}};
  const env={DB:db,QUESTION_EDIT_MODE:mode,ADMIN_PASSWORD:"isolated-test-only",ALLOWED_ORIGINS:"https://allowed.example"};
  const request=(url,method="GET",body,headers={})=>worker.fetch(new Request("https://fixture.example"+url,{method,headers:{"Content-Type":"application/json",Origin:"https://allowed.example",...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  return {sqlite,env,request};
}
test("D1 stores every speaker without replacing answers; all mutation types use CAS",async()=>{
  const h=harness();try {
    let r=await h.request("/questions/1","PUT",{question:fixture,expectedUpdatedAt:null});assert.equal(r.status,200);let row=await r.json();
    assert.equal((await h.request("/questions/1","PUT",{question:fixture,expectedUpdatedAt:null})).status,409);
    r=await h.request("/questions/1/explanation","PATCH",{changes:{videoExplanation:" 新しい動画\n"},expectedUpdatedAt:row.overrideUpdatedAt});assert.equal(r.status,200);row=await r.json();
    const item=await h.request("/overrides/1").then(r=>r.json());
    assert.equal(item.explanation,fixture.explanation);assert.deepEqual(item.correctDiscards,fixture.correctDiscards);assert.deepEqual(item.hand,fixture.hand);assert.equal(item.videoExplanation," 新しい動画\n");
    assert.equal((await h.request("/questions/1","DELETE",{expectedUpdatedAt:null})).status,409);
    assert.equal((await h.request("/questions/1","DELETE",{expectedUpdatedAt:row.overrideUpdatedAt})).status,200);
    assert.equal((await h.request("/overrides/1").then(r=>r.json())).overridden,undefined);
    r=await h.request("/questions/1/explanation","PATCH",{changes:{explanation:""},expectedUpdatedAt:null});assert.equal(r.status,200);
    const only=await h.request("/overrides/1").then(r=>r.json());assert.equal(only.explanation,"");assert.equal("correctDiscards" in only,false);assert.equal("videoExplanation" in only.questionData,false);
  }finally{h.sqlite.close();}
});
test("three review states, clearing and review conflicts are independent from content",async()=>{
  const h=harness();try {
    let stamp=null;
    for(const status of ["complete","check","fix",null]){
      const r=await h.request("/questions/1","PATCH",{reviewStatus:status,expectedReviewUpdatedAt:stamp});assert.equal(r.status,200);const data=await r.json();
      assert.equal(data.reviewStatus,status);assert.equal(data.reviewed,status==="complete");stamp=data.reviewUpdatedAt;
      if(stamp)assert.equal((await h.request("/questions/1","PATCH",{reviewStatus:"fix",expectedReviewUpdatedAt:null})).status,409);
      assert.equal((await h.request("/overrides/1").then(r=>r.json())).overridden,undefined);
    }
    assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM zundamon_question_overrides").get().n,0);
    assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM zundamon_question_reviews").get().n,0);
  }finally{h.sqlite.close();}
});
test("server editing policy, origin, missing and invalid credentials apply on each write",async()=>{
  const h=harness();try{
    const methods=[["/questions/1","PUT",{question:fixture,expectedUpdatedAt:null}],["/questions/1/explanation","PATCH",{changes:{explanation:"change"},expectedUpdatedAt:null}],["/questions/1","PATCH",{reviewStatus:"complete",expectedReviewUpdatedAt:null}],["/questions/1","DELETE",{expectedUpdatedAt:null}],["/questions","POST",{question:{...fixture,id:9999},expectedUpdatedAt:null}]];
    for(const mode of ["closed","password","invalid",undefined]){
      h.env.QUESTION_EDIT_MODE=mode;
      for(const [url,method,body] of methods)assert.equal((await h.request(url,method,body)).status,mode==="password"?401:403);
      assert.equal((await h.request("/overrides/1")).status,200);
    }
    h.env.QUESTION_EDIT_MODE="password";
    assert.equal((await h.request("/login","POST",{password:"bad"})).status,401);
    assert.equal((await h.request("/login","POST",{password:h.env.ADMIN_PASSWORD})).status,200);
    assert.equal((await h.request(...methods[0],{"X-Admin-Password":h.env.ADMIN_PASSWORD})).status,200);
    h.env.QUESTION_EDIT_MODE="open";
    assert.equal((await h.request("/questions/1","DELETE",{expectedUpdatedAt:null},{Origin:"https://unrelated.example"})).status,403);
    h.sqlite.exec("UPDATE sync_state SET writes_enabled=0");
    assert.equal((await h.request(...methods[2])).status,403);
  }finally{h.sqlite.close();}
});
test("delta paging has a bounded index, stable cursor and deletion tombstones",async()=>{
  const h=harness();try{
    for(let id=1;id<=112;id++)h.sqlite.prepare("INSERT INTO zundamon_question_reviews VALUES(?,1,'complete','2026-09-10T00:00:00Z')").run(id);
    let cursor=0,until=null,ids=[];
    for(let p=0;p<3;p++){
      const data=await h.request(`/sync?since=${cursor}${until?`&until=${until}`:""}`).then(r=>r.json());
      assert.ok(data.rows.length<=50);ids.push(...data.rows.map(row=>row.id));cursor=data.cursor;until=data.until;
      assert.equal(data.more,p<2);
    }
    assert.equal(new Set(ids).size,112);
    assert.deepEqual((await h.request(`/sync?since=${cursor}`).then(r=>r.json())).rows,[]);
    h.sqlite.exec("DELETE FROM zundamon_question_reviews WHERE question_id=1");
    const tombstone=await h.request(`/sync?since=${cursor}`).then(r=>r.json());assert.equal(tombstone.rows[0].id,1);assert.equal(tombstone.rows[0].reviewStatus,null);
    for(const query of ["since=-1","since=no","since=9999","since=0&until=-1","since=0&limit=100000"])assert.ok((await h.request("/sync?"+query)).status>=400);
    const explain=h.sqlite.prepare("EXPLAIN QUERY PLAN SELECT question_id FROM question_changes WHERE revision>? ORDER BY revision LIMIT 51").all(90);assert.ok(explain.some(row=>row.detail.includes("INDEX")));
  }finally{h.sqlite.close();}
});
test("idempotent SQL import preserves source fields, IDs, timestamps and review completion",()=>{
  const h=harness();try{
    const source={overrides:[{question_id:1,correct_discards:["0p"],explanation:"  text's\n",question_data:{...fixture},updated_at:"2026-09-07T19:48:20.677667+00:00"}],reviews:[{question_id:1,reviewed:true,updated_at:"2026-07-16T09:59:01.013+00:00"}]};
    h.sqlite.exec(importSql(source));const revision=h.sqlite.prepare("SELECT revision FROM sync_state").get().revision;h.sqlite.exec(importSql(source));assert.equal(h.sqlite.prepare("SELECT revision FROM sync_state").get().revision,revision);
    const rows=h.sqlite.prepare("SELECT * FROM zundamon_question_overrides").all().map(row=>({...row,correct_discards:JSON.parse(row.correct_discards),question_data:JSON.parse(row.question_data)}));
    assert.equal(checksum(rows),checksum(source.overrides));
    const review=h.sqlite.prepare("SELECT * FROM zundamon_question_reviews").get();assert.equal(review.review_status,"complete");assert.equal(review.updated_at,source.reviews[0].updated_at);
  }finally{h.sqlite.close();}
});
test("validation, request limits, throttling and database failure reject without false success",async()=>{
  const h=harness();try{
    assert.equal(validQuestion({...fixture,draw:"9z"},1),null);assert.equal(validQuestion({...fixture,correctDiscards:["9m"]},1),null);assert.equal(validQuestion({...fixture,explanation:"x".repeat(20001)},1),null);
    assert.ok(validQuestion({...fixture,sourceConditionsUnspecified:true,dora:null},1));
    assert.equal((await h.request("/questions/1/explanation","PATCH",{changes:{correctDiscards:[]},expectedUpdatedAt:null})).status,400);
    assert.equal((await h.request("/questions/1","PUT",{question:fixture})).status,400);
    assert.equal((await h.request("/questions/1","PUT",{question:{...fixture,explanation:"x".repeat(140000)},expectedUpdatedAt:null})).status,413);
    h.env.WRITE_LIMIT={limit:async()=>({success:false})};assert.equal((await h.request("/questions/1","PATCH",{reviewStatus:"complete",expectedReviewUpdatedAt:null})).status,429);delete h.env.WRITE_LIMIT;
    h.sqlite.exec("UPDATE sync_state SET daily_mutations=1000,write_day=date('now')");assert.equal((await h.request("/questions/1","PATCH",{reviewStatus:"complete",expectedReviewUpdatedAt:null})).status,429);
    h.env.DB={prepare(){throw Error("mock quota/timeout containing private SQL");}};
    const failure=await h.request("/overrides/1");assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/private SQL/);
  }finally{h.sqlite.close();}
});

test("difficulty-only D1 edits preserve both speakers, answers, shapes and independent review stamps", async () => {
  const h=harness();try {
    const saved=await h.request('/questions/1','PUT',{question:fixture,expectedUpdatedAt:null}).then(r=>r.json());
    const review=await h.request('/questions/1','PATCH',{reviewStatus:'complete',expectedReviewUpdatedAt:null}).then(r=>r.json());
    const r=await h.request('/questions/1/difficulty','PATCH',{difficulty:'advanced',expectedUpdatedAt:saved.overrideUpdatedAt});assert.equal(r.status,200);
    const changed=await r.json();const row=await h.request('/overrides/1').then(r=>r.json());
    assert.equal(row.difficulty,'advanced');assert.equal(row.reviewUpdatedAt,review.reviewUpdatedAt);
    for(const key of Object.keys(fixture))assert.deepEqual(row.questionData[key],fixture[key],key);
    assert.equal((await h.request('/questions/1/difficulty','PATCH',{difficulty:'beginner',expectedUpdatedAt:saved.overrideUpdatedAt})).status,409);
    for(const difficulty of [null,'','expert',[],{}])assert.equal((await h.request('/questions/1/difficulty','PATCH',{difficulty,expectedUpdatedAt:changed.overrideUpdatedAt})).status,400);
    for(const mode of ['closed','password']){h.env.QUESTION_EDIT_MODE=mode;assert.equal((await h.request('/questions/1/difficulty','PATCH',{difficulty:'beginner',expectedUpdatedAt:changed.overrideUpdatedAt})).status,mode==='closed'?403:401);}
    h.env.QUESTION_EDIT_MODE='open';
    assert.equal((await h.request('/questions/1/difficulty','PATCH',{difficulty:'beginner',expectedUpdatedAt:changed.overrideUpdatedAt},{Origin:'https://other.example'})).status,403);
    // No existing full override: only difficulty must be returned to clients.
    assert.equal((await h.request('/questions/2/difficulty','PATCH',{difficulty:'intermediate',expectedUpdatedAt:null})).status,200);
    let partial=await h.request('/overrides/2').then(r=>r.json());
    assert.deepEqual(partial.questionData,{difficulty:'intermediate'});assert.equal('explanation' in partial,false);assert.equal('correctDiscards' in partial,false);
    await h.request('/questions/2/explanation','PATCH',{changes:{videoExplanation:'new'},expectedUpdatedAt:partial.overrideUpdatedAt});
    partial=await h.request('/overrides/2').then(r=>r.json());assert.deepEqual(partial.questionData,{videoExplanation:'new',difficulty:'intermediate'});
    const delta=await h.request('/sync?since=0').then(r=>r.json());assert.equal(delta.rows.find(row=>row.id===2).questionData.difficulty,'intermediate');
    assert.equal(validQuestion({...fixture,difficulty:'impossible'},1),null);
  }finally{h.sqlite.close();}
});

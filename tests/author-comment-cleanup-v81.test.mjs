import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cleanAuthorComment,youtubeId} from '../scripts/clean-author-comments.mjs';
const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const [base,snapshot,ledger]=await Promise.all(['public/questions.json','public/shared-overrides.json','data/author-comment-cleanup-v81.json'].map(read));
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const rows=new Map(snapshot.rows.map(r=>[r.id,r]));
const effective=base.map(q=>{const r=rows.get(q.id);return {...q,...r?.questionData,explanation:r?.explanation??q.explanation,reviewed:r?.reviewed===true,reviewStatus:r?.reviewStatus??null,reviewUpdatedAt:r?.reviewUpdatedAt??null};});
const protectedQuestion=q=>Object.fromEntries(Object.entries(q).filter(([key])=>!['explanation','overridden','overrideUpdatedAt'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));

test('v81 cleanup ledger records author-only changes with all other question fields preserved',()=>{
  assert.equal(ledger.revision,81);
  assert.equal(ledger.scope,'author-explanation-only');
  assert.equal(ledger.requestedCount,98);
  assert.equal(ledger.savedCount,98);
  assert.equal(ledger.ratingQuestionCount,32);
  assert.equal(ledger.removedUrlCount,83);
  assert.equal(new Set(ledger.entries.map(e=>e.id)).size,98);
  for(const entry of ledger.entries){
    assert.match(entry.protectedSha256,/^[a-f0-9]{64}$/);
    assert.equal(entry.afterProtectedSha256,entry.protectedSha256,`protected ${entry.id}`);
    assert.match(entry.beforeTextSha256,/^[a-f0-9]{64}$/);
    assert.match(entry.afterTextSha256,/^[a-f0-9]{64}$/);
  }
});

test('v81 release snapshot has clean comments, keeps supplemental lessons and source metadata',t=>{
  if(snapshot.cursor!==ledger.snapshotCursor){t.skip('Later shared edits exist; the immutable cleanup ledger is checked separately.');return;}
  assert.equal(effective.length,292);
  const ids=new Set(effective.map(q=>youtubeId(q.sourceUrl)).filter(Boolean));
  for(const q of effective){
    assert.equal(cleanAuthorComment(q,ids).text,q.explanation,`no residual cleanup ${q.id}`);
    assert.ok(q.sourceUrl,`source retained ${q.id}`);
  }
  for(const entry of ledger.entries){
    const q=effective.find(q=>q.id===entry.id);
    assert.equal(sha(q.explanation),entry.afterTextSha256,`comment ${entry.id}`);
    assert.equal(sha(protectedQuestion(q)),entry.protectedSha256,`other fields ${entry.id}`);
  }
  for(const [id,url]of [[5,'VJEg2Q_ReH8'],[29,'3VafS2YYWW8'],[70,'PBp4Q7_qnVU'],[171,'VJEg2Q_ReH8']]){
    assert.ok(effective.find(q=>q.id===id).explanation.includes(url),`author lesson ${id}`);
  }
  assert.equal(effective.find(q=>q.id===64).explanation,'');
  assert.ok(effective.find(q=>q.id===34).explanation.includes('https://discord.com/'));
});

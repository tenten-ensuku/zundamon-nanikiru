import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const revisionV82=JSON.parse(readFileSync(new URL('../../data/question-124-correction-v82.json',import.meta.url),'utf8'));
export function beforeV82(question){
  const result=structuredClone(question);
  if(question.id!==revisionV82.questionId)return result;
  for(const[key,value]of Object.entries(revisionV82.patch)){
    assert.deepEqual(question[key],value,`v82 correction ${question.id}.${key}`);
    if(Object.hasOwn(revisionV82.beforeBase,key))result[key]=structuredClone(revisionV82.beforeBase[key]);
    else delete result[key];
  }
  return result;
}

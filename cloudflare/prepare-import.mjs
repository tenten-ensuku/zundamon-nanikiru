import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { publicRow } from "./worker-model.mjs";
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const checksum = rows => createHash("sha256").update(JSON.stringify(canonical([...rows].sort((a,b)=>a.question_id-b.question_id)))).digest("hex");
export async function sourceRows(dir) {
  const files=(await readdir(dir)).filter(name=>/^source-overrides-page-[0-9]+\.json$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const overrides=(await Promise.all(files.map(name=>readFile(path.join(dir,name),"utf8").then(JSON.parse)))).flat();
  const reviews=JSON.parse(await readFile(path.join(dir,"source-reviews-page-1.json"),"utf8"));
  for(const rows of [overrides,reviews]) if(new Set(rows.map(row=>row.question_id)).size!==rows.length)throw Error("duplicate source ID");
  return {overrides,reviews};
}
const quote = value => "'"+String(value).replace(/'/g,"''")+"'";
export function importSql({overrides,reviews}) {
  let sql="-- Idempotent initial import. Existing rows are NEVER overwritten. Verify hashes after import.\n";
  for(const row of overrides)sql+=`INSERT INTO zundamon_question_overrides(question_id,correct_discards,explanation,question_data,updated_at) VALUES(${row.question_id},${quote(JSON.stringify(row.correct_discards))},${quote(row.explanation)},${quote(JSON.stringify(row.question_data))},${quote(row.updated_at)}) ON CONFLICT(question_id) DO NOTHING;\n`;
  for(const row of reviews)sql+=`INSERT INTO zundamon_question_reviews(question_id,reviewed,review_status,updated_at) VALUES(${row.question_id},${row.reviewed?1:0},'complete',${quote(row.updated_at)}) ON CONFLICT(question_id) DO NOTHING;\n`;
  return sql;
}
if(process.argv[2] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir=path.resolve(process.argv[2]);
  const repo=path.resolve(fileURLToPath(new URL("..",import.meta.url)));
  if(dir.startsWith(repo+path.sep))throw Error("Use a private directory outside the published repository");
  const source=await sourceRows(dir);
  await writeFile(path.join(dir,"d1-import.sql"),importSql(source),{flag:"wx"});
  const byId=new Map(source.overrides.map(row=>[row.question_id,{...row}]));
  for(const row of source.reviews)byId.set(row.question_id,{...(byId.get(row.question_id)||{question_id:row.question_id}),review_status:"complete",review_updated_at:row.updated_at});
  const snapshot={schema:1,source:"https://zundamon-question-api.naga-study.workers.dev",cursor:source.overrides.length+source.reviews.length,rows:[...byId.values()].map(publicRow).sort((a,b)=>a.id-b.id)};
  // Runtime fallback contains only fields already returned by the public read API, never a database dump.
  await writeFile(path.join(dir,"runtime-overrides.json"),JSON.stringify(snapshot,null,2)+"\n",{flag:"wx"});
  const report={overrides:{count:source.overrides.length,sha256:checksum(source.overrides)},reviews:{count:source.reviews.length,sha256:checksum(source.reviews)},initialRevision:snapshot.cursor};
  await writeFile(path.join(dir,"import-manifest.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify(report));
}

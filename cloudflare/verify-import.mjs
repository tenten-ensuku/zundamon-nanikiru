import { readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { sourceRows, checksum } from "./prepare-import.mjs";
const [dir,exportPath,reportPath] = process.argv.slice(2);
if(!dir||!exportPath||!reportPath)throw Error("Usage: node cloudflare/verify-import.mjs privateSourceDir privateExport.sql privateReport.json");
const source=await sourceRows(dir);
const db=new DatabaseSync(":memory:");
try {
  db.exec(await readFile(exportPath,"utf8"));
  const overrides=db.prepare("SELECT question_id,correct_discards,explanation,question_data,updated_at FROM zundamon_question_overrides ORDER BY question_id").all().map(row=>({...row,correct_discards:JSON.parse(row.correct_discards),question_data:JSON.parse(row.question_data)}));
  const reviews=db.prepare("SELECT question_id,reviewed,updated_at FROM zundamon_question_reviews ORDER BY question_id").all().map(row=>({...row,reviewed:row.reviewed===1}));
  const checks={};
  for(const [name,rows] of Object.entries({overrides,reviews})){
    checks[name]={count:rows.length,expected:source[name].length,sha256:checksum(rows),sourceSha256:checksum(source[name])};
    if(checks[name].sha256!==checks[name].sourceSha256)throw Error(name+" data mismatch");
  }
  const report={checkedAt:new Date().toISOString(),sourceDirectory:path.resolve(dir),restoreFile:path.resolve(exportPath),checks,restoredToIsolatedSqlite:true,syncState:db.prepare("SELECT * FROM sync_state").get(),integrity:db.prepare("PRAGMA integrity_check").get(),triggers:db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'").get().n};
  if(report.triggers!==6)throw Error("Missing restore triggers");
  await writeFile(reportPath,JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(report));
}finally{db.close();}

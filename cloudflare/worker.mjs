import { publicRow, validQuestion, validId, validStamp, validDifficulty, isObject, MAX_TEXT } from "./worker-model.mjs";
import BASE_IDS from "./base-question-ids.json" with { type: "json" };
const baseIds = new Set(BASE_IDS);
const joinColumns = `i.question_id,o.correct_discards,o.explanation,o.question_data,o.updated_at,r.review_status,r.updated_at AS review_updated_at`;
const joins = `LEFT JOIN zundamon_question_overrides o ON o.question_id=i.question_id LEFT JOIN zundamon_question_reviews r ON r.question_id=i.question_id`;
export const rowQuery = `SELECT ${joinColumns} FROM (SELECT ? AS question_id) i ${joins}`;
const fail = (status, message) => Object.assign(new Error(message), { status });
const modeOf = env => ["open", "password", "closed"].includes(env.QUESTION_EDIT_MODE) ? env.QUESTION_EDIT_MODE : "closed";
const timestamp = prior => new Date(Math.max(Date.now(), (Date.parse(prior) || 0) + 1)).toISOString();
async function equalPassword(supplied, expected) {
  if (typeof supplied !== "string" || !expected || supplied.length > 1024) return false;
  const digest = value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a,b] = await Promise.all([digest(supplied), digest(expected)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i=0;i<left.length;i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
async function bodyOf(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw fail(415,"JSON形式で送信してください。");
  if (Number(request.headers.get("content-length") || 0)>131072) throw fail(413,"入力が大きすぎます。");
  const reader=request.body?.getReader(), chunks=[];
  let length=0;
  if(reader) while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>131072){await reader.cancel();throw fail(413,"入力が大きすぎます。");}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes)||"{}");}catch{throw fail(400,"JSONを読み取れません。");}
  if(!isObject(body))throw fail(400,"入力形式が正しくありません。");
  return body;
}
async function writeAuth(request,env,bodyPassword) {
  const mode=modeOf(env);
  if(mode==="closed")throw fail(403,"編集は停止中です。");
  if(mode==="password"){
    if(!env.ADMIN_PASSWORD)throw fail(503,"管理パスワードが設定されていません。");
    if(!await equalPassword(bodyPassword??request.headers.get("X-Admin-Password"),env.ADMIN_PASSWORD))throw fail(401,"認証に失敗しました。");
  }
}
const currentRow = (db,id) => db.prepare(rowQuery).bind(id).first();
function assertExpected(body,key,current) {
  if(!Object.hasOwn(body,key)||!validStamp(body[key]))throw fail(400,"更新日時が不正です。画面を開き直してください。");
  if(body[key]!==current)throw fail(409,"他の編集が先に保存されています。入力を控えてから開き直してください。");
}
async function saveOverride(db,row,expected) {
  let query;
  const params=[row.correct_discards,row.explanation,row.question_data,row.updated_at,row.question_id];
  if(expected===null)query=db.prepare("INSERT INTO zundamon_question_overrides(correct_discards,explanation,question_data,updated_at,question_id) VALUES(?,?,?,?,?) ON CONFLICT(question_id) DO NOTHING RETURNING question_id").bind(...params);
  else query=db.prepare("UPDATE zundamon_question_overrides SET correct_discards=?,explanation=?,question_data=?,updated_at=? WHERE question_id=? AND updated_at=? RETURNING question_id").bind(...params,expected);
  if(!(await query.all()).results.length)throw fail(409,"他の編集が先に保存されています。開き直してください。");
}
export default { async fetch(request,env,ctx={}) {
  const url=new URL(request.url), origin=request.headers.get("origin");
  const allowed=new Set((env.ALLOWED_ORIGINS||"https://tenten-ensuku.github.io").split(",").map(s=>s.trim()));
  const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Vary":"Origin"};
  const json=(status,data,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});
  if(origin&&!allowed.has(origin))return json(403,{error:"この接続元からは利用できません。"});
  if(origin)Object.assign(headers,{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Admin-Password"});
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  try {
    const ip=request.headers.get("CF-Connecting-IP")||"unknown";
    if(env.EDGE_LIMIT&&!((await env.EDGE_LIMIT.limit({key:ip})).success))return json(429,{error:"アクセスが多いため、少し待ってください。"},{"Retry-After":"60"});
    if(request.method==="GET"&&url.pathname==="/health")return json(200,{ok:true,app:"zundamon-nanikiru",version:73,storage:"d1"});
    if(request.method==="GET"&&url.pathname==="/access")return json(200,{mode:modeOf(env),requiresPassword:modeOf(env)==="password",canEdit:modeOf(env)==="open"});
    if(request.method==="POST"&&url.pathname==="/login"){
      if(env.WRITE_LIMIT&&!((await env.WRITE_LIMIT.limit({key:ip})).success))return json(429,{error:"少し待ってから操作してください。"},{"Retry-After":"60"});
      const body=await bodyOf(request);await writeAuth(request,env,body.password);return json(200,{ok:true});
    }
    const db=env.DB;
    if(request.method==="GET"&&url.pathname==="/sync"){
      const sinceText=url.searchParams.get("since")||"0";
      if(!/^[0-9]{1,15}$/.test(sinceText)||[...url.searchParams.keys()].some(k=>!["since","until","fresh"].includes(k))||(url.searchParams.has("fresh")&&url.searchParams.get("fresh")!=="1"))throw fail(400,"取得位置が不正です。");
      const since=Number(sinceText), untilText=url.searchParams.get("until");
      if(untilText!==null&&!/^[0-9]{1,15}$/.test(untilText))throw fail(400,"取得位置が不正です。");
      const cache=url.searchParams.has("fresh")?null:globalThis.caches?.default;
      const key=new Request(url.origin+url.pathname+url.search);
      const cached=cache?await cache.match(key):null;
      if(cached)return json(200,await cached.json());
      const head=await db.prepare("SELECT revision FROM sync_state WHERE singleton=1").first();
      const until=untilText===null?head.revision:Number(untilText);
      if(since>until||until>head.revision)throw fail(409,"共有データの取得位置が変わりました。画面を再読み込みしてください。");
      const rows=await db.prepare(`SELECT ${joinColumns},i.revision FROM (SELECT question_id,revision FROM question_changes WHERE revision>? AND revision<=? ORDER BY revision LIMIT 51) i ${joins} ORDER BY i.revision`).bind(since,until).all();
      const more=rows.results.length>50, page=rows.results.slice(0,50);
      const data={rows:page.map(publicRow),cursor:more?page.at(-1).revision:until,until,more};
      if(cache&&ctx.waitUntil)ctx.waitUntil(cache.put(key,new Response(JSON.stringify(data),{headers:{"Cache-Control":"public,max-age=10","Content-Type":"application/json"}})));
      return json(200,data);
    }
    const readMatch=/^\/overrides\/([0-9]+)$/.exec(url.pathname);
    if(request.method==="GET"&&readMatch){const id=Number(readMatch[1]);if(!validId(id))throw fail(404,"問題が見つかりません。");return json(200,publicRow(await currentRow(db,id)));}
    const match=/^\/questions\/([0-9]+)(\/(?:explanation|difficulty))?$/.exec(url.pathname);
    const create=request.method==="POST"&&url.pathname==="/questions";
    if(!create&&(!match||!["PUT","PATCH","DELETE"].includes(request.method)||(match[2]&&request.method!=="PATCH")))throw fail(404,"APIが見つかりません。");
    await writeAuth(request,env);
    if(env.WRITE_LIMIT&&!((await env.WRITE_LIMIT.limit({key:ip})).success))return json(429,{error:"保存回数が多いため、少し待ってください。"},{"Retry-After":"60"});
    const body=await bodyOf(request), id=create?body.question?.id:Number(match[1]);
    if(!validId(id))throw fail(404,"問題が見つかりません。");
    const existing=await currentRow(db,id);
    if(create&&(baseIds.has(id)||existing?.updated_at))throw fail(409,"同じ番号の問題がすでにあります。");
    if(!create&&!baseIds.has(id)&&!existing?.updated_at)throw fail(404,"問題が見つかりません。");
    if(request.method==="PATCH"&&!match[2]){
      const status=body.reviewStatus;
      if(status!==null&&!["complete","check","fix"].includes(status))throw fail(400,"確認状態が正しくありません。");
      assertExpected(body,"expectedReviewUpdatedAt",existing?.review_updated_at||null);
      const stamp=timestamp(existing?.review_updated_at);
      let result;
      if(status===null){
        if(existing?.review_updated_at){result=await db.prepare("DELETE FROM zundamon_question_reviews WHERE question_id=? AND updated_at=? RETURNING question_id").bind(id,existing.review_updated_at).all();}
      }else if(existing?.review_updated_at){
        result=await db.prepare("UPDATE zundamon_question_reviews SET reviewed=?,review_status=?,updated_at=? WHERE question_id=? AND updated_at=? RETURNING question_id").bind(status==="complete"?1:0,status,stamp,id,existing.review_updated_at).all();
      }else{
        result=await db.prepare("INSERT INTO zundamon_question_reviews(question_id,reviewed,review_status,updated_at) VALUES(?,?,?,?) ON CONFLICT(question_id) DO NOTHING RETURNING question_id").bind(id,status==="complete"?1:0,status,stamp).all();
      }
      if(result&&!result.results.length)throw fail(409,"確認状態が更新されています。開き直してください。");
      return json(200,{id,reviewStatus:status,reviewed:status==="complete",reviewUpdatedAt:status?stamp:null});
    }
    assertExpected(body,"expectedUpdatedAt",existing?.updated_at||null);
    if(request.method==="DELETE"){
      if(existing?.updated_at){
        const result=await db.prepare("DELETE FROM zundamon_question_overrides WHERE question_id=? AND updated_at=? RETURNING question_id").bind(id,existing.updated_at).all();
        if(!result.results.length)throw fail(409,"他の編集が先に保存されています。");
      }
      return json(200,{id,restored:true});
    }
    const stamp=timestamp(existing?.updated_at);
    let row;
    if(match?.[2]==="/difficulty"){
      if(!validDifficulty(body.difficulty))throw fail(400,"難易度は初級・中級・中級～上級から選択してください。");
      const data=existing?.question_data?JSON.parse(existing.question_data):{explanationOnly:true};
      row={question_id:id,correct_discards:existing?.correct_discards||"[]",explanation:existing?.explanation||"",question_data:JSON.stringify({...data,difficulty:body.difficulty}),updated_at:stamp};
      await saveOverride(db,row,existing?.updated_at||null);
      return json(200,{id,difficulty:body.difficulty,overrideUpdatedAt:stamp});
    }
    if(match?.[2]){
      const entries=isObject(body.changes)?Object.entries(body.changes):[];
      if(!entries.length||entries.some(([key,value])=>!["explanation","videoExplanation"].includes(key)||typeof value!=="string"||value.length>MAX_TEXT))throw fail(400,"解説は各20,000文字以内で入力してください。");
      const changes=Object.fromEntries(entries);
      const data=existing?.question_data?JSON.parse(existing.question_data):{explanationOnly:true};
      row={question_id:id,correct_discards:existing?.correct_discards||"[]",explanation:changes.explanation??existing?.explanation??"",question_data:JSON.stringify({...data,...changes}),updated_at:stamp};
      await saveOverride(db,row,existing?.updated_at||null);
      return json(200,{id,changes,overrideUpdatedAt:stamp});
    }
    const question=validQuestion(body.question,id);
    if(!question)throw fail(400,"牌姿・ドラ・正解・解説の入力を確認してください。");
    row={question_id:id,correct_discards:JSON.stringify(question.correctDiscards),explanation:question.explanation,question_data:JSON.stringify(question),updated_at:stamp};
    await saveOverride(db,row,existing?.updated_at||null);
    return json(200,publicRow({...row,review_status:existing?.review_status,review_updated_at:existing?.review_updated_at}));
  } catch(error) {
    const message=String(error?.message||"");
    if(message.includes("daily_mutation_limit"))return json(429,{error:"本日の共有保存上限です。入力を控え、翌日再試行してください。"},{"Retry-After":String(Math.ceil((Date.parse(new Date(Date.now()+86400000).toISOString().slice(0,10)+"T00:00:00Z")-Date.now())/1000))});
    if(message.includes("writes_disabled"))return json(403,{error:"保存は一時停止中です。入力は残っています。"});
    const status=error?.status||503;
    return json(status,{error:status>=500?"保存サービスに接続できません。入力は残っています。時間をおいて再試行してください。":message});
  }
}};

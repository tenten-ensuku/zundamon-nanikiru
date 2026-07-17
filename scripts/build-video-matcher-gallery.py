#!/usr/bin/env python
"""Build a local visual confirmation page from video matcher artifacts."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "video-matcher"


def main() -> None:
    questions = json.loads((ROOT / "public" / "questions.json").read_text(encoding="utf-8"))
    gallery_questions = [{
        "id": question["id"],
        "hand": question.get("hand", []),
        "dora": question.get("dora"),
        "melds": question.get("melds", []),
        "sourceUrl": question.get("sourceUrl"),
    } for question in questions]
    (OUTPUT / "gallery-questions.json").write_text(json.dumps(gallery_questions, ensure_ascii=False), encoding="utf-8")
    (OUTPUT / "index.html").write_text("""<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>何切る 動画照合</title>
<style>
:root{color-scheme:dark;font-family:"Yu Gothic",sans-serif;background:#06110f;color:#f6f2df}*{box-sizing:border-box}body{margin:0}.app{max-width:1200px;margin:auto;padding:16px}.top{position:sticky;top:0;z-index:4;background:#06110f;padding-bottom:10px;border-bottom:1px solid #35574e}h1{font-size:22px;margin:0 0 10px}.controls{display:flex;gap:8px;flex-wrap:wrap}select,input,button{font:inherit;border-radius:7px;border:1px solid #49665d;background:#102b25;color:#f6f2df;padding:8px}button{cursor:pointer;background:#b65a22;border-color:#e7863b;font-weight:bold}.status{color:#f2d27b;font-size:13px;margin:8px 0}.compare{display:grid;grid-template-columns:minmax(250px,1fr) 2fr;gap:12px;margin:14px 0}.question{border:1px solid #49665d;border-radius:10px;padding:10px;background:#0b201c}.question img{width:100%;border-radius:6px;background:#173c33}.question p{margin:7px 0;font-size:13px}.videos{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.card{border:1px solid #294b43;border-radius:8px;overflow:hidden;background:#0b201c}.card img{display:block;width:100%;height:108px;object-fit:cover;background:#173c33}.card .body{padding:8px}.card strong{font-size:12px;line-height:1.35;display:block;min-height:3.8em}.meta{font-size:11px;color:#b3c2bd;margin:5px 0}.card a{color:#f2d27b;font-size:12px}.card button{width:100%;margin-top:7px;padding:6px;font-size:12px}.matched{outline:2px solid #f2d27b}.export{background:#173c33;border-color:#49665d}@media(max-width:650px){.app{padding:10px}.compare{grid-template-columns:1fr}.videos{grid-template-columns:repeat(2,minmax(0,1fr))}.card img{height:92px}}
</style>
<main class="app"><section class="top"><h1>何切る 動画照合</h1><div class="controls"><select id="question"></select><select id="view"><option value="candidates">ドラ一致候補</option><option value="all">全180件</option></select><input id="search" placeholder="動画番号・タイトルで絞り込み"><button id="export" class="export">対応表CSVを保存</button></div><div id="status" class="status"></div></section><section class="compare"><article class="question" id="questionCard"></article><section id="videos" class="videos"></section></section></main>
<script>
const questionImageBase='../../public/questions/';
const storeKey='zundamon-video-matcher-v1';
let questions=[],matches=[],questionCandidates={},mapping=JSON.parse(localStorage.getItem(storeKey)||'{}');
const qSelect=document.querySelector('#question'), view=document.querySelector('#view'), search=document.querySelector('#search'), videos=document.querySelector('#videos'), status=document.querySelector('#status'), qCard=document.querySelector('#questionCard');
const questionImage=id=>`${questionImageBase}question-${String(id).padStart(3,'0')}.png`;
const save=()=>localStorage.setItem(storeKey,JSON.stringify(mapping));
function selected(){return Number(qSelect.value)}
function renderQuestion(){const q=questions.find(x=>x.id===selected());if(!q)return;qCard.innerHTML=`<strong>問題 No.${q.id}</strong><img src="${questionImage(q.id)}" alt="問題${q.id}"><p>手牌: ${q.hand.join(' ')}<br>ドラ: ${q.dora||'—'}</p><p>${mapping[q.id]?`対応動画: ${mapping[q.id].playlistIndex}番`:'未照合'}</p>`}
function assign(match){mapping[selected()]={playlistIndex:match.playlistIndex,videoId:match.videoId,url:match.url,title:match.title};save();renderQuestion();renderVideos()}
function renderVideos(){const needle=search.value.trim().toLowerCase();const qid=selected();const ranked=questionCandidates[String(qid)]||[];const rankByVideo=new Map(ranked.map((candidate,index)=>[candidate.videoId,{rank:index+1,score:candidate.score,handMatch:candidate.handMatch}]));const base=view.value==='all'?matches:ranked.map(candidate=>matches.find(match=>match.videoId===candidate.videoId)).filter(Boolean);const visible=base.filter(m=>!needle||String(m.playlistIndex).includes(needle)||m.title.toLowerCase().includes(needle));status.textContent=`問題${qid}を選択中。${view.value==='all'?'全件':'ドラ牌コードが一致した候補'} ${visible.length}件を表示 / 確定済み ${Object.keys(mapping).length}件`;videos.replaceChildren(...visible.map(m=>{const card=document.createElement('article');card.className='card'+(mapping[qid]?.videoId===m.videoId?' matched':'');const frame=m.frames?.[0]||'';const rank=rankByVideo.get(m.videoId);const videoDora=(m.doraCodes||[]).join(' / ')||'未認識';card.innerHTML=`<img src="${frame}" alt="動画${m.playlistIndex}の問題画面"><div class="body"><strong>${m.playlistIndex}. ${m.title}</strong><div class="meta">動画ドラ: ${videoDora}<br>${rank?`ドラ一致 / 手牌一致度 ${Math.round(rank.handMatch*100)}% / 候補 ${rank.rank}位`:'ドラ候補外'}</div><a href="${m.url}" target="_blank" rel="noreferrer">YouTubeを開く</a><button type="button">この問題に対応付け</button></div>`;card.querySelector('button').addEventListener('click',()=>assign(m));return card}))}
function exportCsv(){const rows=[['問題No.','動画No.','動画タイトル','動画URL']];Object.entries(mapping).sort((a,b)=>Number(a[0])-Number(b[0])).forEach(([id,m])=>rows.push([id,m.playlistIndex,m.title,m.url]));const csv=rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\\r\\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='nanikiru-video-mapping.csv';a.click();URL.revokeObjectURL(a.href)}
Promise.all([fetch('gallery-questions.json').then(r=>r.json()),fetch('matches.json').then(r=>r.json())]).then(([q,report])=>{questions=q;matches=report.matches;questionCandidates=report.questionCandidates||{};q.forEach(x=>qSelect.add(new Option(`問題 ${x.id}`,x.id)));qSelect.addEventListener('change',()=>{renderQuestion();renderVideos()});view.addEventListener('change',renderVideos);search.addEventListener('input',renderVideos);document.querySelector('#export').addEventListener('click',exportCsv);renderQuestion();renderVideos()});
</script></html>""", encoding="utf-8")
    print(OUTPUT / "index.html")


if __name__ == "__main__":
    main()

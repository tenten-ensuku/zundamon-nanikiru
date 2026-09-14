import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const extract = name => html.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name);

test("opening a catalog card persists its original anchor, filters and viewport offset", () => {
  const events = [];
  const document = { querySelector(selector) {
    assert.equal(selector, '#problemList [data-question-id="54"]');
    return { getBoundingClientRect: () => ({ top: 240 }) };
  } };
  const api = new Function("document", "window", "events", `
    let state={}, problemDifficulty="intermediate", problemSort="weak";
    const questions=[{id:53},{id:54},{id:55}], filterByDifficulty=(qs,d)=>qs;
    const saveState=()=>events.push(JSON.parse(JSON.stringify(state))), resumeSession=()=>events.push("resume");
    ${["captureCatalogPosition", "openCatalogQuestion", "createSession"].map(extract).join("\n")}
    return {openCatalogQuestion, createSession, get:()=>state};
  `)(document, { scrollY: 4800 }, events);
  api.openCatalogQuestion(54);
  assert.deepEqual(events[0].session.catalogReturn, { questionId:54, difficulty:"intermediate", sort:"weak", scrollY:4800, offset:240 });
  assert.equal(events[0].session.position, 1);
  assert.equal(events[1], "resume");
  api.createSession("ten", [53,54]);
  assert.equal(Object.hasOwn(api.get().session, "catalogReturn"), false);
});

function menuHarness(session, allowed=true) {
  const calls=[];
  const api = new Function("session", "allowed", "calls", `
    const state={session}, playQuestions=[{id:54},{id:55}];
    const questions=[{id:2,difficulty:"beginner"},{id:54,difficulty:"intermediate"},{id:55,difficulty:"beginner"}];
    const questionDifficulty=question=>question.difficulty;
    let currentIndex=1, problemDifficulty="all", problemSort="default";
    const leaveExplanationEditor=()=>allowed, saveState=()=>calls.push("saved");
    const isDifficulty=x=>["beginner","intermediate"].includes(x);
    const renderMenu=(...args)=>calls.push(args);
    ${extract("goMenu")}
    return {goMenu, get:()=>({state, problemDifficulty, problemSort})};
  `)(session, allowed, calls);
  return {...api, calls};
}

test("catalog return keeps original card after moving to another question and restores filters", () => {
  const position = { questionId:54, difficulty:"advanced", sort:"weak", scrollY:4800, offset:240 };
  const api = menuHarness({ mode:"catalog", catalogReturn:position, position:1, responses:{54:{tile:"5m"}} });
  api.goMenu();
  assert.deepEqual(api.calls, ["saved", ["problems", position]]);
  assert.deepEqual(api.get(), { state:{session:null}, problemDifficulty:"intermediate", problemSort:"weak" });
});

test("cancelled or busy explanation editor prevents clearing session and navigation", () => {
  const session={mode:"catalog",catalogReturn:{questionId:54}};
  const api=menuHarness(session,false);
  api.goMenu();
  assert.deepEqual(api.calls,[]);
  assert.equal(api.get().state.session,session);
});

test("catalog return follows its original question when the two-level migration moved it", () => {
  const position={questionId:2,difficulty:"intermediate",sort:"weak",scrollY:4800,offset:240};
  const api=menuHarness({mode:"catalog",catalogReturn:position});
  api.goMenu();
  assert.equal(api.get().problemDifficulty,"beginner");
  assert.deepEqual(api.calls[1],["problems",position]);
});

test("normal challenges and review keep existing menu behavior and progress", () => {
  for (const mode of ["ten","all","review"]) {
    const api=menuHarness({mode,position:0});
    api.goMenu();
    assert.deepEqual(api.calls,["saved",["challenge"]]);
    assert.equal(api.get().state.session.position,1);
  }
  const single=menuHarness({mode:"single"});
  single.goMenu();
  assert.equal(single.get().state.session,null);
  assert.deepEqual(single.calls,["saved",["challenge"]]);
});

test("older catalog sessions fall back to current question; invalid filters cannot leak through", () => {
  const api=menuHarness({mode:"catalog"});
  api.goMenu();
  assert.equal(api.calls[1][1].questionId,55);
  const invalid=menuHarness({mode:"catalog",catalogReturn:{questionId:54,difficulty:"unknown",sort:"unknown"}});
  invalid.goMenu();
  assert.equal(invalid.get().problemDifficulty,"all");
  assert.equal(invalid.get().problemSort,"default");
});

function scrollHarness({found=true, screen="menu", tab="problems", cardTop=5200, height=844}={}) {
  const calls=[], frames=[];
  const document={querySelector(selector) {
    calls.push(["query",selector]);
    return found ? { getBoundingClientRect:()=>({top:cardTop}), querySelector:()=>({focus:options=>calls.push(["focus",options])}) } : null;
  }};
  const window={scrollY:0,innerHeight:height,scrollTo:options=>calls.push(["scroll",options])};
  const restore=new Function("document","window","requestAnimationFrame", "currentScreen", "activeTab", `${extract("restoreCatalogPosition")};return restoreCatalogPosition;`)(document,window,cb=>frames.push(cb),screen,tab);
  return {calls, restore, flush:()=>frames.splice(0).forEach(cb=>cb())};
}

test("restore waits for layout and targets the card even when weak sorting moves it", () => {
  const api=scrollHarness({cardTop:1700});
  api.restore({questionId:54,offset:240,scrollY:4800});
  assert.deepEqual(api.calls,[]);
  api.flush();
  assert.deepEqual(api.calls,[["query",'#problemList [data-question-id="54"]'],["focus",{preventScroll:true}],["scroll",{top:1460,behavior:"instant"}]]);
});

test("missing cards use saved scroll and corrupt numeric values stay finite", () => {
  for (const [scrollY,expected] of [[4800,4800],[-5,0],[Infinity,0],["invalid",0]]) {
    const api=scrollHarness({found:false});
    api.restore({questionId:54,scrollY});api.flush();
    assert.deepEqual(api.calls.at(-1),["scroll",{top:expected,behavior:"instant"}]);
  }
  const api=scrollHarness({height:360,cardTop:1000});
  api.restore({questionId:54,offset:800});api.flush();
  assert.equal(api.calls.at(-1)[1].top,740);
});

test("pending restoration cannot scroll gameplay or a different menu tab", () => {
  for (const options of [{screen:"play"},{tab:"challenge"}]) {
    const api=scrollHarness(options);api.restore({questionId:54});api.flush();
    assert.deepEqual(api.calls,[]);
  }
  assert.match(extract("renderMenu"), /tab === "problems" && catalogReturn/);
  assert.match(extract("createCatalogCard"), /card\.dataset\.questionId = String\(question.id\)/);
});

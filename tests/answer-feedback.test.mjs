import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const script = await readFile(new URL("../answer-feedback.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const extract = name => html.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    }`))?.[0] || assert.fail(name);
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ reduced = false, defer = false, unsupported = false } = {}) {
  class Param {
    value = 0; events = [];
    setValueAtTime(...args) { this.events.push(["set", ...args]); }
    linearRampToValueAtTime(...args) { this.events.push(["linear", ...args]); }
    exponentialRampToValueAtTime(...args) { this.events.push(["exponential", ...args]); }
    setTargetAtTime(...args) { this.events.push(["target", ...args]); }
  }
  class Audio {
    static instances = [];
    state = "suspended"; currentTime = 1; destination = {}; gains = []; oscillators = []; resumes = 0;
    constructor() { Audio.instances.push(this); }
    createGain() { const node = { gain: new Param(), connect() {}, disconnect() { this.disconnected = true; } }; this.gains.push(node); return node; }
    createOscillator() { const node = { frequency: new Param(), stops: [], connect() {}, disconnect() { this.disconnected = true; }, start(t) { this.started = t; }, stop(t) { this.stops.push(t); } }; this.oscillators.push(node); return node; }
    resume() { this.resumes++; if (defer) return new Promise(resolve => { this.release = () => { this.state = "running"; resolve(); }; }); this.state = "running"; return Promise.resolve(); }
  }
  class Element {
    children = []; animations = []; isConnected = true; attributes = {};
    append(...items) { this.children.push(...items); for (const item of items) item.parent = this; }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelector() { return this.title ||= new Element(); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
    animate(frames, options) { const a = {frames,options,finished:new Promise(resolve => { this.resolveAnimation = resolve; }), cancel: () => { a.canceled = true; this.resolveAnimation(); } }; this.animations.push(a); return a; }
  }
  const document = { hidden: false, handlers: {}, createElement: () => new Element(), addEventListener(name, fn) { this.handlers[name] = fn; } };
  const media = { matches: reduced, addEventListener(name, fn) { this.changed = fn; } };
  const context = vm.createContext({ document, AudioContext: unsupported ? undefined : Audio, matchMedia: () => media, addEventListener() {} });
  vm.runInContext(script, context);
  let volume = 40;
  return { api: context.ZundamonAnswerFeedback, document, media, Audio, Element, create: () => context.ZundamonAnswerFeedback.create({ getVolume: () => volume }), setVolume(value) { volume = value; } };
}

test("sound volume defaults safely, respects zero and clamps restored settings", () => {
  const { api } = harness();
  assert.equal(api.DEFAULT_VOLUME, 40);
  for (const value of [undefined,null,"broken",NaN,Infinity]) assert.equal(api.normalizeVolume(value),40);
  assert.equal(api.normalizeVolume(0),0);assert.equal(api.normalizeVolume(-1),0);assert.equal(api.normalizeVolume(200),100);
  const normalize = new Function("ZundamonAnswerFeedback", `${extract("defaultState")}\n${extract("normalizeState")} return normalizeState;`)(api);
  const data = normalize({ settings: { nickname: "保存名", soundVolume: 0 }, favoriteIds: [3], questionStats: {3:{correct:1,total:2}} });
  assert.equal(data.settings.soundVolume,0);assert.equal(data.settings.nickname,"保存名");assert.deepEqual(data.favoriteIds,[3]);assert.equal(data.questionStats[3].total,2);
  assert.equal(normalize({settings:{nickname:"旧データ"}}).settings.soundVolume,40);
});

test("short local chime has smooth attack/release, bounded duration and mute produces no nodes", () => {
  const { api, Audio } = harness();const ctx = new Audio();ctx.state = "running";
  api.scheduleChime(ctx,0);assert.equal(ctx.oscillators.length,0);
  const sound=api.scheduleChime(ctx,40);assert.equal(ctx.oscillators.length,6);assert.equal(ctx.gains[0].gain.value,.4);
  assert.deepEqual(ctx.oscillators.map(node=>node.frequency.events[0][1]),[523.251,1046.502,659.255,1318.51,783.991,1567.982]);
  for (const node of ctx.oscillators) assert.ok(node.stops[0]-ctx.currentTime<.7);
  for (const node of ctx.gains.slice(1)) { assert.equal(node.gain.events[0][1],0);assert.equal(node.gain.events.at(-1)[1],0);assert.ok(node.gain.events.some(event=>event[0]==="exponential")); }
  sound.stop();assert.equal(ctx.gains[0].gain.events.at(-1)[0],"target");
  for(const node of ctx.oscillators) node.onended();assert.equal(ctx.gains[0].disconnected,true);
});

test("audio context is reused and resumes after interruption; mute cancels pending audio", async () => {
  const h=harness(), player=h.create();await player.unlock();player.play();await flush();
  const ctx=h.Audio.instances[0];assert.equal(ctx.oscillators.length,6);
  ctx.state="interrupted";await player.unlock();assert.equal(ctx.resumes,2);assert.equal(h.Audio.instances.length,1);
  player.play();await flush();assert.equal(ctx.oscillators.length,12);assert.equal(ctx.oscillators[0].stops.length,2);
  h.setVolume(0);player.stop();player.play();await flush();assert.equal(ctx.oscillators.length,12);
  const pending=harness({defer:true}), late=pending.create();late.play();late.stop();pending.Audio.instances[0].release();await flush();assert.equal(pending.Audio.instances[0].oscillators.length,0);
});

test("animation is short, nonsemantic and cleaned up on navigation, hide or reduced motion", async () => {
  const h=harness(), player=h.create(), target=new h.Element();player.play(target);await flush();
  assert.equal(target.children.length,1);assert.equal(target.children[0].attributes["aria-hidden"],"true");
  for(const child of target.children[0].children) for(const animation of child.animations) assert.ok(animation.options.duration+(animation.options.delay||0)<700);
  player.stop();assert.equal(target.children.length,0);
  player.play(target);h.document.hidden=true;h.document.handlers.visibilitychange();await flush();assert.equal(target.children.length,0);
  const quiet=harness({reduced:true,unsupported:true}), quietTarget=new quiet.Element();quiet.create().play(quietTarget);await flush();assert.equal(quietTarget.children.length,0);
});

test("only a newly confirmed graded-correct answer celebrates, never wrong, ungraded or a redraw", () => {
  for (const [answers,chosen,expected] of [[["1m"],0,1],[["2m"],0,0],[[],0,0]]) {
    const calls=[];
    const run=new Function("question","answerFeedback", `const playQuestions=[question],currentIndex=0;let selectedIndex=${chosen},specialChoice=null,riichiSelected=null,revealed=false;
      const state={responses:{},wrongIds:[],questionStats:{},session:{responses:{},answeredIds:[]}},document={getElementById:()=>({})};
      const saveState=()=>{},renderHand=()=>{},renderDecision=()=>{},renderReview=()=>{},renderProgress=()=>{};
      ${["selectableHand","gradeAnswer","confirmSelection"].map(extract).join("\n")}
      return confirmSelection;` )({id:1,hand:["1m","2m"],correctDiscards:answers},{play:target=>calls.push(target)});
    run();run();assert.equal(calls.length,expected);
  }
  for(const name of ["renderReview","renderQuestion","beginExplanationEdit","saveExplanationEdit"]) assert.doesNotMatch(extract(name),/answerFeedback\.play/);
});

test("feedback remains click-through and versioned; settings provide persistent volume and preview", async () => {
  const css=await readFile(new URL("../answer-feedback.css",import.meta.url),"utf8");
  assert.match(css,/\.correct-celebration[^}]*pointer-events: none/);assert.match(css,/prefers-reduced-motion/);
  const version=html.match(/const APP_VERSION = (\d+);/)[1];
  for(const file of ["answer-feedback.js","answer-feedback.css"]) assert.ok(html.includes(`${file}?v=${version}`));
  assert.match(extract("renderSettingsPanel"),/id="soundVolume"/);assert.match(extract("renderSettingsPanel"),/id="previewCorrectSound"/);
  assert.match(extract("renderSettingsPanel"),/state.settings.soundVolume = ZundamonAnswerFeedback.normalizeVolume/);
});

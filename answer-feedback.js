(function (root) {
  "use strict";
  const DEFAULT_VOLUME = 40;
  const normalizeVolume = value => typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value))) : DEFAULT_VOLUME;

  // A soft major arpeggio, synthesized locally: no audio downloads or delayed playback.
  function scheduleChime(context, volume) {
    const level = normalizeVolume(volume) / 100;
    if (!level) return { stop() {} };
    const output = context.createGain();
    output.gain.value = level;
    output.connect(context.destination);
    const voices = [];
    let remaining = 6, stopped = false;
    const start = context.currentTime + .008;
    for (const [index, frequency] of [523.251, 659.255, 783.991].entries()) {
      const at = start + index * .075;
      const decay = index === 2 ? .46 : .30;
      for (const harmonic of [1, 2]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency * harmonic, at);
        const duration = harmonic === 1 ? decay : .11;
        const peak = harmonic === 1 ? .23 : .024;
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(peak, at + .009);
        envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
        envelope.gain.linearRampToValueAtTime(0, at + duration + .025);
        oscillator.connect(envelope);
        envelope.connect(output);
        oscillator.onended = () => {
          oscillator.disconnect(); envelope.disconnect();
          if (--remaining === 0) output.disconnect();
        };
        oscillator.start(at);
        oscillator.stop(at + duration + .03);
        voices.push(oscillator);
      }
    }
    return { stop() {
      if (stopped) return;
      stopped = true;
      const now = context.currentTime;
      output.gain.setTargetAtTime(0, now, .005);
      for (const voice of voices) try { voice.stop(now + .03); } catch {}
    } };
  }

  function create({ getVolume = () => DEFAULT_VOLUME, document = root.document } = {}) {
    let context = null, resuming = null, sound = null, visual = null, generation = 0;
    const reducedMotion = root.matchMedia?.("(prefers-reduced-motion: reduce)");
    function stopVisual() { visual?.(); visual = null; }
    function stop() { generation++; sound?.stop(); sound = null; stopVisual(); }
    function unlock() {
      if (!normalizeVolume(getVolume()) || document.hidden) return Promise.resolve(null);
      try {
        const AudioContext = root.AudioContext || root.webkitAudioContext;
        if (!AudioContext) return Promise.resolve(null);
        if (!context || context.state === "closed") context = new AudioContext({ latencyHint: "interactive" });
        if (context.state === "running") return Promise.resolve(context);
        // Called from a tile tap / keyboard action, including after a device wakes up.
        resuming ||= Promise.resolve(context.resume()).then(() => context.state === "running" ? context : null).catch(() => null).finally(() => { resuming = null; });
        return resuming;
      } catch { return Promise.resolve(null); }
    }
    function showVisual(target) {
      if (!target?.isConnected || reducedMotion?.matches || typeof target.animate !== "function") return;
      const layer = document.createElement("span");
      layer.className = "correct-celebration";
      layer.setAttribute("aria-hidden", "true");
      const shimmer = document.createElement("span"); shimmer.className = "correct-shimmer";
      const ring = document.createElement("span"); ring.className = "correct-ring";
      layer.append(shimmer, ring); target.append(layer);
      const animations = [];
      const animate = (element, frames, options) => {
        const animation = element.animate(frames, options);
        animations.push(animation);
      };
      const clean = () => { for (const animation of animations) animation.cancel(); layer.remove(); };
      try {
        const title = target.querySelector("strong");
        if (title) animate(title, [{ transform: "scale(.90)", offset: 0 }, { transform: "scale(1.09)", offset: .32 }, { transform: "scale(1)", offset: 1 }], { duration: 380, easing: "cubic-bezier(.2,.7,.3,1)" });
        animate(shimmer, [{ opacity: 0 }, { opacity: .7, offset: .2 }, { opacity: 0 }], { duration: 580, easing: "ease-out" });
        animate(ring, [{ transform: "translate(-50%,-50%) scale(.65)", opacity: .7 }, { transform: "translate(-50%,-50%) scale(1.5)", opacity: 0 }], { duration: 510, easing: "ease-out" });
        for (const [index, [x, y]] of [[-36,-17],[-14,-30],[20,-28],[49,-12],[43,22],[9,28],[-29,21]].entries()) {
          const spark = document.createElement("span");
          spark.className = `correct-spark${index % 2 ? " correct-spark--dot" : ""}`;
          layer.append(spark);
          animate(spark, [{ transform: "translate(-50%,-50%) scale(.15)", opacity: 0 }, { transform: `translate(calc(-50% + ${x * .35}px),calc(-50% + ${y * .35}px)) scale(1)`, opacity: .9, offset: .18 }, { transform: `translate(calc(-50% + ${x}px),calc(-50% + ${y}px)) scale(.3)`, opacity: 0 }], { duration: 560, delay: index * 12, easing: "cubic-bezier(.15,.6,.35,1)" });
        }
        visual = clean;
        Promise.allSettled(animations.map(animation => animation.finished)).then(() => { if (visual === clean) { clean(); visual = null; } });
      } catch { clean(); }
    }
    function play(target = null) {
      stop();
      if (document.hidden) return;
      const token = generation;
      showVisual(target);
      // Never await audio in the answer/grade path. Blocked sound must not block play.
      void unlock().then(ready => {
        if (!ready || generation !== token || document.hidden || !normalizeVolume(getVolume())) return;
        try { sound = scheduleChime(ready, getVolume()); } catch {}
      });
    }
    document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
    root.addEventListener?.("pagehide", stop);
    reducedMotion?.addEventListener?.("change", stopVisual);
    return Object.freeze({ unlock, play, stop });
  }
  root.ZundamonAnswerFeedback = Object.freeze({ DEFAULT_VOLUME, normalizeVolume, scheduleChime, create });
})(globalThis);

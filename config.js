window.ZUNDAMON_CONFIG = Object.freeze({
  // 全体公開時は "public" に変更する。仕分け用の難易度注釈は preview 中だけ表示。
  releaseStage: "preview",
  apiBaseUrl: "https://zundamon-question-api.naga-study.workers.dev",
  // ユーザー指定の原画像。丸い切り抜きは表示側のCSSだけで行う。
  explanationSpeakers: {
    video: { name: "ずんだもん", image: "assets/speakers/zundamon.png" },
    author: { name: "エンスク", image: "assets/speakers/ensuku.png" },
  },
});

(() => {
  "use strict";
  const BEGINNER_PLAYLIST = "PLsPI0JcKZ3E7QqaFQpJsLkmkS7dZlPXRv";
  const INTERMEDIATE_PLAYLIST = "PLsPI0JcKZ3E75g3aLjIL1ofwMsyvFJjCH";
  const DIFFICULTIES = Object.freeze([
    Object.freeze({ id: "beginner", label: "初級" }),
    Object.freeze({ id: "intermediate", label: "中級" }),
    Object.freeze({ id: "advanced", label: "中級～上級" }),
  ]);
  const isDifficulty = value => DIFFICULTIES.some(item => item.id === value);

  // Explicit saved choices always win over historical playlist membership.
  function questionDifficulty(question) {
    if (isDifficulty(question?.difficulty)) return question.difficulty;
    return previewAudienceLabel(question, "preview") ? "advanced" : "beginner";
  }
  function difficultyLabel(value) {
    const id = typeof value === "object" && value !== null ? questionDifficulty(value) : value;
    return DIFFICULTIES.find(item => item.id === id)?.label || "全難易度";
  }
  function filterByDifficulty(questions, difficulty = "all") {
    return difficulty === "all" ? [...questions] : questions.filter(q => questionDifficulty(q) === difficulty);
  }

  function youtubeVideoId(value) {
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol)) return null;
      if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0];
      if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) return url.searchParams.get("v") || /^\/(?:shorts|embed)\/([^/]+)/.exec(url.pathname)?.[1] || null;
    } catch { /* A missing or user-edited source has no verified membership. */ }
    return null;
  }

  function previewAudienceLabel(question, releaseStage = window.ZUNDAMON_CONFIG?.releaseStage) {
    if (releaseStage !== "preview") return "";
    const membership = question?.sourcePlaylistMembership;
    if (!membership || membership.videoId !== youtubeVideoId(question.sourceUrl) || !Array.isArray(membership.playlistIds)) return "";
    return membership.playlistIds.includes(INTERMEDIATE_PLAYLIST) && !membership.playlistIds.includes(BEGINNER_PLAYLIST) ? "中上級者向け" : "";
  }

  window.ZUNDAMON_QUESTION_METADATA = Object.freeze({ youtubeVideoId, previewAudienceLabel, DIFFICULTIES, isDifficulty, questionDifficulty, difficultyLabel, filterByDifficulty });
})();

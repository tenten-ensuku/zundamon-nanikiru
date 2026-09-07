(() => {
  "use strict";
  const BEGINNER_PLAYLIST = "PLsPI0JcKZ3E7QqaFQpJsLkmkS7dZlPXRv";
  const INTERMEDIATE_PLAYLIST = "PLsPI0JcKZ3E75g3aLjIL1ofwMsyvFJjCH";

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

  window.ZUNDAMON_QUESTION_METADATA = Object.freeze({ youtubeVideoId, previewAudienceLabel });
})();

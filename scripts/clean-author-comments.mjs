/** One-time, source-aware author-comment cleanup; not a render-time filter. */
export function youtubeId(value) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return url.pathname.split('/')[1] || null;
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      return url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|video)\/([\w-]+)/)?.[1] || null;
    }
  } catch {}
  return null;
}

// These two comments consist entirely of praise, not an explanation. Match
// exactly so a subsequently expanded author comment can never be erased.
const praiseOnly = new Map([
  [38, 'とじょ完全正解💯\nとじょ犬くんの完璧な解説を是非ご覧ください✨'],
  [64, '||とじょくんの説明に付け足す事は何もありません。仕事泥棒！💯 ||'],
]);

export function cleanAuthorComment(question, sourceVideoIds) {
  const before = String(question.explanation ?? '');
  let text = before, removedUrls = [], removedRatings = 0;
  const removeUrl = (whole, url = whole) => {
    const id = youtubeId(url);
    if (!id || !sourceVideoIds.has(id)) return whole;
    removedUrls.push(url);
    return '';
  };
  text = text.replace(/\[[^\]\n]*\]\((https?:\/\/[^\s)]+)\)/g, removeUrl);
  text = text.replace(/<(https?:\/\/[^\s<>]+)>/g, removeUrl);
  text = text.replace(/https?:\/\/[^\s<>"'|)）]+/g, url => removeUrl(url));
  if (praiseOnly.get(question.id) === text.trim()) {
    removedRatings = (text.match(/💯/gu) || []).length;
    text = '';
  } else {
    text = text.replace(/💯\uFE0F?/gu, () => { removedRatings++; return ''; });
    // Only a standalone rating is removed; never a mahjong score in prose.
    text = text.split('\n').map(line => {
      if (/^[\s|]*(?:100点|１００点|百点)[!！。\s|]*$/.test(line)) {
        removedRatings++; return '';
      }
      return line;
    }).join('\n');
  }
  if (question.id === 55 && removedUrls.length) {
    text = text.replace('今回から余力あれば元動画も貼っていきます。', '');
  }
  if (text !== before) {
    text = text.replace(/^[ \t|]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return {text, removedUrls, removedRatings};
}

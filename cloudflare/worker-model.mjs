export const TILE_CODE = /^(?:[1-9][mps]|[1-7]z|0[mps])$/;
export const MAX_TEXT = 20000;
export const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const validId = id => Number.isInteger(id) && id > 0 && id <= 9999;
export const validStamp = value => value === null || (typeof value === "string" && value.length < 60 && Number.isFinite(Date.parse(value)));
export const reviewStatus = value => ["complete", "check", "fix"].includes(value) ? value : null;
export function publicRow(row) {
  if (!row) return null;
  const id = Number(row.question_id);
  let item = { id, reviewed: row.review_status === "complete", reviewStatus: row.review_status || null, reviewUpdatedAt: row.review_updated_at || null };
  if (row.updated_at) {
    const data = typeof row.question_data === "string" ? JSON.parse(row.question_data) : row.question_data || {};
    if (data.explanationOnly === true) {
      const texts = Object.fromEntries(["explanation", "videoExplanation"].filter(key => typeof data[key] === "string").map(key => [key, data[key]]));
      item = { ...item, questionData: texts, ...(typeof texts.explanation === "string" ? { explanation: texts.explanation } : {}) };
    } else {
      item = { ...data, ...item, correctDiscards: typeof row.correct_discards === "string" ? JSON.parse(row.correct_discards) : row.correct_discards, explanation: row.explanation, questionData: data };
    }
    item.overridden = true;
    item.overrideUpdatedAt = row.updated_at;
  }
  return item;
}
export function validQuestion(value, id) {
  if (!isObject(value) || value.id !== id || !validId(id)) return null;
  if (!Array.isArray(value.hand) || !value.hand.length || value.hand.some(code => typeof code !== "string" || !TILE_CODE.test(code))) return null;
  if (value.draw != null && (typeof value.draw !== "string" || !TILE_CODE.test(value.draw))) return null;
  const draw = value.draw ?? null, hand = value.hand;
  const selectable = [...hand, ...(draw ? [draw] : [])];
  const melds = value.melds ?? [];
  if (!Array.isArray(melds) || melds.length > 4 || melds.some(m => !isObject(m) || !["chi", "pon", "kan"].includes(m.type) || !Array.isArray(m.tiles) || m.tiles.length !== (m.type === "kan" ? 4 : 3) || m.tiles.some(code => typeof code !== "string" || !TILE_CODE.test(code)) || !Number.isInteger(m.calledIndex) || m.calledIndex < 0 || m.calledIndex >= m.tiles.length || (m.type === "chi" && m.calledIndex !== 0))) return null;
  if (selectable.length !== 14 - melds.length * 3) return null;
  if (!(value.sourceConditionsUnspecified === true && value.dora === null) && !TILE_CODE.test(value.dora || "")) return null;
  for (const key of ["explanation", "videoExplanation", "note"]) if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > MAX_TEXT)) return null;
  if (value.sourceUrl && (typeof value.sourceUrl !== "string" || value.sourceUrl.length > 2048 || !/^https?:\/\//.test(value.sourceUrl))) return null;
  if (value.correctDiscards !== undefined && (!Array.isArray(value.correctDiscards) || value.correctDiscards.some(code => !selectable.includes(code)))) return null;
  const counts = new Map(), concealed = new Map();
  const count = (map, code) => { const tile = code.replace(/^0/, "5"); map.set(tile, (map.get(tile) || 0) + 1); };
  selectable.forEach(code => count(concealed, code));
  [...selectable, ...melds.flatMap(m => m.tiles)].forEach(code => count(counts, code));
  if ([...counts.values()].some(n => n > 4)) return null;
  const kanChoice = [...concealed.values()].includes(4);
  if (value.correctKan === true && !kanChoice) return null;
  for (const key of ["correctKan", "correctRiichi"]) if (value[key] != null && typeof value[key] !== "boolean") return null;
  const question = { ...value, id, hand, draw, melds, meldCount: melds.length, correctDiscards: [...new Set(value.correctDiscards || [])], explanation: value.explanation ?? "", kanChoice, correctKan: kanChoice && typeof value.correctKan === "boolean" ? value.correctKan : null };
  for (const key of ["reviewed", "reviewStatus", "reviewUpdatedAt", "overrideUpdatedAt", "overridden", "isNew", "__proto__", "constructor", "prototype"]) delete question[key];
  return question;
}

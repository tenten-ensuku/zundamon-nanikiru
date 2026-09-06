// 全体公開前の一時的な編集開放。公開時は closed に変更して再配信する。
// QUESTION_EDIT_MODE 環境変数があれば優先する。パスワードそのものは置かない。
export const DEFAULT_EDIT_MODE = "open";

export function resolveEditMode(value = DEFAULT_EDIT_MODE) {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["open", "password", "closed"].includes(mode) ? mode : "closed";
}

export function editAccess(mode) {
  return { mode, requiresPassword: mode === "password", canEdit: mode === "open" };
}

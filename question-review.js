(function (root) {
  "use strict";
  const choices = Object.freeze([["complete", "○", "完成"], ["check", "△", "要確認"], ["fix", "×", "要修正"]]);
  function statusOf(question) {
    return choices.some(([value]) => value === question?.reviewStatus) ? question.reviewStatus : question?.reviewed === true ? "complete" : null;
  }
  function createControl(question, save, { disabled = false, onSaved = () => {} } = {}) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "question-review-control";
    fieldset.disabled = disabled;
    const legend = document.createElement("legend");
    legend.textContent = "問題の確認";
    fieldset.append(legend);
    const message = document.createElement("span");
    message.className = "question-review-message";
    message.setAttribute("role", "status");
    const inputs = [];
    const refresh = () => inputs.forEach(input => { input.checked = input.value === statusOf(question); });
    for (const [value, symbol, name] of choices) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.setAttribute("aria-label", `${symbol} ${name}`);
      label.append(input, document.createTextNode(`${symbol} ${name}`));
      inputs.push(input);
      fieldset.append(label);
      input.addEventListener("change", async () => {
        const selected = input.checked ? value : null;
        refresh(); // Do not show an unsaved change as completed.
        fieldset.disabled = true;
        message.textContent = "保存中…";
        try {
          const result = await save(selected, question.reviewUpdatedAt || null);
          Object.assign(question, { reviewStatus: result.reviewStatus ?? (result.reviewed ? "complete" : null), reviewed: result.reviewed === true, reviewUpdatedAt: result.reviewUpdatedAt || null });
          refresh();
          message.textContent = "保存済み";
          onSaved(result);
        } catch (error) {
          refresh();
          message.textContent = error.message || "保存できませんでした。";
        } finally { fieldset.disabled = disabled; }
      });
    }
    fieldset.addEventListener("click", event => event.stopPropagation());
    fieldset.append(message);
    refresh();
    return fieldset;
  }
  root.ZundamonReview = Object.freeze({ choices, statusOf, createControl });
})(globalThis);

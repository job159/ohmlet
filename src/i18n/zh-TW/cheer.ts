/**
 * zh-TW strings of the honest-celebration rules (owner: cheer —
 * src/ui/fx/lesson-pass.ts, success-watch.ts): a lesson passed with the
 * loaded answer gets no 「完成！」, only this plain sentence (the lesson
 * panel's own wording: 載入的解答 / 自己接一次). Keys are the English
 * sources passed to t() ("source|context").
 */
const zh: Record<string, string> = {
  // 「電路正常運作 ✓ · U1 的 PA5 切換了」: a pin that changed once and holds its new level
  // (one that keeps changing reads 「{id} 的 {pin} 在切換」 — vivid.ts)
  '{id} switched {pin}': '{id} 的 {pin} 切換了',
  'All {n} acceptance checks pass, but with the loaded solution — build it yourself to complete the lesson.|cheer':
    '驗收 {n} 項全部通過，但用的是載入的解答——自己接一次，才算完成本課。',
  // the lesson was already earned on the learner's own circuit: it stays 「已完成」
  'All {n} acceptance checks pass (with the loaded solution).|cheer': '驗收 {n} 項全部通過（用的是載入的解答）。',
}

export default zh

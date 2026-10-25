/**
 * Spacing of zh-TW text assembled from names (UX fix SH-F11 — one
 * implementation for the lessons engine and the shell's hints / toasts).
 *
 * Templates put a space around every `{placeholder}` so that Latin names
 * read well (「U1 PA5 這一排」); when the inserted name itself ends (or
 * starts) with Chinese, the space lands between two Chinese words:
 * 「從 PS1 正端 拉線」, 「a33（R1 第 1 腳 這一排）」. tidyCjkSpaces removes
 * exactly those spaces — 「從 PS1 正端拉線」, 「a33（R1 第 1 腳這一排）」 —
 * and keeps every space next to Latin text or digits. English text has no
 * CJK, so it comes back unchanged.
 *
 * Pure module: safe in node tests and workers.
 */

/** No space between two Chinese words (a full-width bracket / quote counts as Chinese). */
export function tidyCjkSpaces(text: string): string {
  return text.replace(/([㐀-鿿）」』])[ \t]+(?=[㐀-鿿（「『])/g, '$1')
}

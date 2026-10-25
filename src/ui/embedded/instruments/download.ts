/**
 * Browser download of generated text (VCD / CSV exports): a Blob behind a
 * temporary object URL, clicked through an off-screen anchor. Works in
 * browsers and Electron (which turns it into a regular download). The
 * object URL is revoked a little later (some browsers read it
 * asynchronously after the click).
 */

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
}

/** "ohmlet-logic_3.000100s-3.002100s.vcd" — window bounds in the file name. */
export function exportName(prefix: string, t0: number, t1: number, ext: string): string {
  const s = (t: number) => `${Math.max(0, t).toFixed(6)}s`
  return `${prefix}_${s(t0)}-${s(t1)}.${ext}`
}

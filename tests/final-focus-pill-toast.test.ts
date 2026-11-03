/**
 * Phone selection pill vs toasts (product chrome, round 5 final polish).
 *
 * The product pill sits one row above the undo pill on phones (bottom +139 px,
 * +201 px in wire mode) — the same row the toasts take while the undo pill
 * shows (UndoPill.css +140 px, app.css +203 px), so a toast from the pill's
 * own 複製 / 換新 covered it (toast z 60 over pill z 42). While the product
 * pill shows, <body> carries `app-sel-visible` and the phone toasts float one
 * row above it: pill row + pill height + 6 px. The classic chrome (pill +83,
 * never the class) and the desktop (≥ 900 px) are unchanged.
 *
 * No DOM in the suite: the CSS rows and selectors are read from the sources
 * (the real-browser check is the 390×844 / 320×640 walk in the stream report).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEL_VISIBLE_CLASS } from '../src/ui/chrome/SelectionPill'

const ROOT = path.resolve(__dirname, '..')
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

const pillCss = read('src/ui/chrome/SelectionPill.css')
const undoCss = read('src/ui/chrome/UndoPill.css')
const appCss = read('src/app.css')
const pillTsx = read('src/ui/chrome/SelectionPill.tsx')

/** Every `@media (max-width: 899px) { … }` block of a stylesheet. */
function phoneBlocks(css: string): string[] {
  return [...css.matchAll(/@media \(max-width: 899px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1])
}

/** The `bottom: calc(var(--lg-safe-bottom) + Npx)` of `selector` inside `css` (exact selector text). */
function bottomOf(css: string, selector: string): number | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|\\n)\\s*${esc} \\{\\s*bottom: calc\\(var\\(--lg-safe-bottom\\) \\+ (\\d+)px\\);`).exec(css)
  return m ? Number(m[1]) : null
}

/** (classes + pseudo-classes incl. :not's argument, elements) — enough for these selectors. */
function specificity(sel: string): [number, number] {
  const classes = (sel.match(/\.[\w-]+/g) ?? []).length + (sel.match(/:(?!not\()[\w-]+/g) ?? []).length
  const elements = (sel.replace(/\([^)]*\)/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
  return [classes, elements]
}
const beats = (a: string, b: string) => {
  const [ac, ae] = specificity(a)
  const [bc, be] = specificity(b)
  return ac > bc || (ac === bc && ae > be)
}

// …and not while a sheet rests: the toasts float above its top edge then (persona fix — kit.css lg-sheet-resting)
const TOAST_SEL = 'body.app-sel-visible:not(.lg-dock-covered):not(.app-wire-armed):not(.lg-sheet-resting) .lg-toast-host'
const TOAST_WIRE_SEL = 'body.app-sel-visible.app-wire-armed:not(.lg-dock-covered):not(.lg-sheet-resting) .lg-toast-host'

describe('phone toasts take the row above the product selection pill', () => {
  const phone = phoneBlocks(pillCss).join('\n')
  // the pill: 3 px padding + 44 px buttons + 3 px padding
  const pillH = 3 + 44 + 3

  it('the pill is 50 px tall (44 px targets + 3 px padding) — the row arithmetic below rests on it', () => {
    expect(pillCss).toMatch(/\.app-sel-pill \{[^}]*padding: 3px 6px 3px 16px;/)
    expect(pillCss).toMatch(/\.app-sel-btn \{[^}]*height: 44px;/)
  })

  it('outside wire mode: toasts sit at pill row + pill + 6 px (they covered it on the shared +139 / +140 row)', () => {
    const pillRow = bottomOf(phone, '.app-sel-pill.is-product')
    const toastRow = bottomOf(phone, TOAST_SEL)
    expect(pillRow).toBe(139)
    expect(toastRow).toBe((pillRow ?? 0) + pillH + 6)
    // the toast row the pill used to share (UndoPill.css) is below the pill's top edge
    const undoToastRow = bottomOf(phoneBlocks(undoCss).join('\n'), 'body.app-undo-visible:not(.app-wire-armed) .lg-toast-host')
    expect(undoToastRow).toBe(140)
    expect(undoToastRow!).toBeLessThan(pillRow! + pillH)
    expect(toastRow!).toBeGreaterThanOrEqual(pillRow! + pillH)
  })

  it('in wire mode: the same above the pill’s wire-mode hop (+201 → +257)', () => {
    const pillRow = bottomOf(phone, 'body.app-wire-armed .app-sel-pill.is-product')
    const toastRow = bottomOf(phone, TOAST_WIRE_SEL)
    expect(pillRow).toBe(201)
    expect(toastRow).toBe((pillRow ?? 0) + pillH + 6)
    const wireToastRow = bottomOf(phoneBlocks(appCss).join('\n'), 'body.app-wire-armed.app-undo-visible .lg-toast-host')
    expect(wireToastRow).toBe(203)
    expect(wireToastRow!).toBeLessThan(pillRow! + pillH)
  })

  it('the rules win over the undo-pill / wire-strip toast rows whatever the stylesheet order', () => {
    expect(beats(TOAST_SEL, 'body.app-undo-visible:not(.app-wire-armed) .lg-toast-host')).toBe(true)
    expect(beats(TOAST_SEL, 'body.ws-on:not(.app-wire-armed) .lg-toast-host')).toBe(true)
    expect(beats(TOAST_WIRE_SEL, 'body.app-wire-armed.app-undo-visible .lg-toast-host')).toBe(true)
    expect(beats(TOAST_WIRE_SEL, 'body.app-wire-armed .lg-toast-host')).toBe(true)
  })

  it('phones only (the desktop keeps its rows) and not while a sheet hides the pill (lg-dock-covered)', () => {
    const outside = pillCss.replace(/@media \(max-width: 899px\) \{[\s\S]*?\n\}/g, '')
    expect(outside).not.toContain('.lg-toast-host')
    expect(TOAST_SEL).toContain(':not(.lg-dock-covered)')
    expect(TOAST_WIRE_SEL).toContain(':not(.lg-dock-covered)')
    expect(pillCss).toMatch(/body\.lg-dock-covered \.app-sel-pill \{\s*opacity: 0;/)
  })

  it('the class is set only while the PRODUCT pill shows (the classic chrome never gets it) and removed after', () => {
    expect(SEL_VISIBLE_CLASS).toBe('app-sel-visible')
    expect(pillTsx).toMatch(
      /useEffect\(\(\) => \{\s*if \(legacy \|\| !visible\) return\s*document\.body\.classList\.add\(SEL_VISIBLE_CLASS\)\s*return \(\) => document\.body\.classList\.remove\(SEL_VISIBLE_CLASS\)\s*\}, \[legacy, visible\]\)/,
    )
    // the classic pill keeps its +83 row and nothing else references the class
    expect(/\.app-sel-pill \{([^}]*)\}/.exec(pillCss)?.[1]).toMatch(/bottom: calc\(var\(--lg-safe-bottom\) \+ 83px\)/)
  })
})

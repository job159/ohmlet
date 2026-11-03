/**
 * SH-9 in the phone layout (< 900 px: a narrow desktop window, a tablet with
 * a keyboard): a kit phone sheet (儀器, 屬性, 更多 — `.lg-sheet`, aria-modal
 * for screen readers) is NOT a modal for the run keys.
 *
 * A Segmented radio clicked inside one keeps its focus (src/ui/kit/focus.ts —
 * the arrows pick the neighbour instead of nudging the part), so the key's
 * target is that radio. describeKeyTarget used to call ANY aria-modal
 * ancestor a modal: Space then passed to the radio (re-selecting a stale
 * segment after click + ←, the slide switch flipped back a → b) and F5 was
 * swallowed — Space / F5 / F10 stopped running, pausing and debugging after
 * a click in a sheet. Now it uses blockingModalOpen's rule (BLOCKING_MODAL):
 * only a dialog that is not a kit sheet (the shortcuts list, the onboarding)
 * owns the keys, as part-keys.ts already did.
 *
 * No DOM in the suite: a tiny element stand-in with closest() for the
 * selectors keys.ts asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BLOCKING_MODAL, blockingModalOpen, describeKeyTarget, routeGlobalKey, type KeyAppInfo } from '../src/ui/chrome/keys'

class FakeEl {
  isContentEditable = false
  constructor(
    public tagName: string,
    public attrs: Record<string, string> = {},
    public parent: FakeEl | null = null,
  ) {}
  getAttribute(n: string): string | null {
    return n in this.attrs ? this.attrs[n] : null
  }
  hasAttribute(n: string): boolean {
    return n in this.attrs
  }
  get classes(): string[] {
    return (this.attrs.class ?? '').split(/\s+/).filter(Boolean)
  }
  /** one compound selector: tag, .class, [attr], [attr="v"], trailing :not(.class) */
  private one(sel: string): boolean {
    let s = sel.trim()
    const not = /:not\(\.([\w-]+)\)$/.exec(s)
    if (not) {
      if (this.classes.includes(not[1])) return false
      s = s.slice(0, not.index)
    }
    const tag = /^[a-z]+/i.exec(s)?.[0]
    if (tag && tag.toUpperCase() !== this.tagName) return false
    for (const m of s.matchAll(/\.([\w-]+)/g)) if (!this.classes.includes(m[1])) return false
    for (const m of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!(m[1] in this.attrs)) return false
      if (m[2] !== undefined && this.attrs[m[1]] !== m[2]) return false
    }
    return true
  }
  matches(sel: string): boolean {
    return sel.split(',').some((s) => this.one(s))
  }
  closest(sel: string): FakeEl | null {
    for (let e: FakeEl | null = this; e; e = e.parent) if (e.matches(sel)) return e
    return null
  }
}

const body = new FakeEl('BODY')
let open: FakeEl[] = []
const APP: KeyAppInfo = { legacy: false, mcuCount: 1, blockingModal: false }
const SPACE = { key: ' ', code: 'Space' }

beforeEach(() => {
  open = []
  vi.stubGlobal('Element', FakeEl)
  vi.stubGlobal('document', {
    body,
    documentElement: new FakeEl('HTML'),
    querySelector: (sel: string) => open.find((d) => d.matches(sel)) ?? null,
  })
})
afterEach(() => vi.unstubAllGlobals())

/** a dialog root + a radio group with a clicked (pointer-focused) segment in it */
function radioIn(dialogAttrs: Record<string, string>): { dialog: FakeEl; radio: FakeEl } {
  const dialog = new FakeEl('DIV', { role: 'dialog', ...dialogAttrs }, body)
  open.push(dialog)
  const content = new FakeEl('DIV', { class: 'lg-sheet-content' }, dialog)
  const group = new FakeEl('DIV', { role: 'radiogroup', class: 'lg-seg' }, content)
  const radio = new FakeEl('BUTTON', { type: 'button', role: 'radio', 'aria-checked': 'false', class: 'lg-seg-item' }, group)
  return { dialog, radio }
}
const app = (): KeyAppInfo => ({ ...APP, blockingModal: blockingModalOpen() })
const route = (key: { key: string; code?: string; shiftKey?: boolean }, el: FakeEl) =>
  routeGlobalKey(key, describeKeyTarget(el as unknown as EventTarget), app())

describe('a segment clicked inside a phone sheet: Space / F5 / F10 still act (SH-9)', () => {
  it('the 儀器 sheet’s 「邏輯」 (kit sheet, aria-modal for screen readers) is no modal for the run keys', () => {
    const { radio } = radioIn({ class: 'lg-sheet', 'aria-modal': 'true' })
    const info = describeKeyTarget(radio as unknown as EventTarget)
    expect(info).toMatchObject({ inModal: false, widget: true, keyboardFocused: false, textEntry: false })
    expect(blockingModalOpen()).toBe(false)
    // Space runs / pauses and drops the radio's focus — never re-activates a stale segment
    expect(route(SPACE, radio)).toEqual({ kind: 'run', blur: true })
    // F5 / F10 / Shift+F5 debug instead of being swallowed
    expect(route({ key: 'F5' }, radio)).toEqual({ kind: 'debug', key: 'F5', blur: true })
    expect(route({ key: 'F10' }, radio)).toEqual({ kind: 'debug', key: 'F10', blur: true })
    expect(route({ key: 'F5', shiftKey: true }, radio)).toEqual({ kind: 'debug', key: 'Shift+F5', blur: true })
  })

  it('an iOS-modal action sheet / the firmware picker (.lg-sheet.is-modal) follows the same rule as blockingModalOpen', () => {
    const { radio } = radioIn({ class: 'lg-sheet is-modal insp-fwp-sheet', 'aria-modal': 'true' })
    expect(describeKeyTarget(radio as unknown as EventTarget).inModal).toBe(blockingModalOpen())
    expect(route(SPACE, radio)).toEqual({ kind: 'run', blur: true })
  })

  it('the sheet itself (it takes the focus when it opens) lets Space run', () => {
    const { dialog } = radioIn({ class: 'lg-sheet', 'aria-modal': 'true', tabindex: '-1' })
    expect(route(SPACE, dialog)).toEqual({ kind: 'run', blur: false })
  })

  it('a blocking dialog (the shortcuts list, the onboarding) still keeps Space and swallows F5', () => {
    const { radio } = radioIn({ class: 'app-keys', 'aria-modal': 'true' })
    expect(describeKeyTarget(radio as unknown as EventTarget).inModal).toBe(true)
    expect(blockingModalOpen()).toBe(true)
    expect(route(SPACE, radio)).toEqual({ kind: 'pass' })
    expect(route({ key: 'F5' }, radio)).toEqual({ kind: 'swallow' })
    expect(route({ key: 'F10' }, radio)).toEqual({ kind: 'pass' })
  })

  it('a desktop panel (aria-modal="false") is no modal either; the classic chrome routes nothing', () => {
    const { radio } = radioIn({ class: 'lg-panel lg-panel-right', 'aria-modal': 'false' })
    expect(route(SPACE, radio)).toEqual({ kind: 'run', blur: true })
    expect(routeGlobalKey(SPACE, describeKeyTarget(radio as unknown as EventTarget), { ...APP, legacy: true })).toEqual({ kind: 'pass' })
  })

  it('one rule: the target check and the open-anywhere check share BLOCKING_MODAL (as part-keys.ts)', () => {
    expect(BLOCKING_MODAL).toBe('[aria-modal="true"]:not(.lg-sheet)')
  })
})

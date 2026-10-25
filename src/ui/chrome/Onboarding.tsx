/**
 * Onboarding — first-launch 3-step coach overlay (DESIGN.md §2; UX wave
 * SH-3): what this is (an STM32 electronics lab) → how to look around (the
 * mouse or the touch wording, by the primary pointer) → start with lesson 1.
 * The last step leads straight into the learning path: 「開始第一課」 loads
 * the first lesson's starting circuit with the coach on step 1 (contract K9),
 * 「先看範例：Blue Pill 閃爍 LED」 opens the blink example (K10). Springy
 * (transform/opacity only, house spring via the --lg-dur/--lg-spring tokens,
 * which collapse under reduced motion), skippable, 3 dots. The caller
 * persists the 'bb.onboarded' flag in onDone.
 *
 * Classic chrome (useLegacyChrome — English without the workspace): the
 * pre-wave tour, unchanged in pixels and behaviour (UX fix SH-10): rotate /
 * zoom → parts → AI (LEGACY_STEPS) ending in 「Get started」.
 *
 * Both are modal dialogs for the keyboard too (release QA SH-F2 — focus
 * only, no pixel changes): the primary button (「下一步」, on the last card
 * 「開始第一課」) takes the focus on mount and on every card change, Tab /
 * Shift+Tab stay inside the card, Esc = 「略過」, no key reaches the app
 * behind it, and closing gives the focus back (the element that had it,
 * else the 3D view). The programmatic focus shows no ring until the
 * keyboard is used (FocusOptions.focusVisible), so the classic onboarding
 * baselines stay identical.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { BookIcon, ChipIcon, PressableButton, ResetIcon, SparklesIcon, pressProps, tick, useMediaQuery } from '../kit'
import { t, useLang } from '../../i18n'
import { LESSONS } from '../../lessons'
import { startFirstLesson } from '../lessons/actions'
import { openExampleById } from '../workspace/examples'
import { useLegacyChrome } from './legacy'

export const ONBOARDED_KEY = 'bb.onboarded'

/** The example the last step offers (src/ui/workspace/examples.ts key). */
export const ONBOARDING_EXAMPLE_ID = 'blink'

/** True when this browser has not completed/skipped onboarding yet. */
export function needsOnboarding(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) == null
  } catch {
    return false
  }
}

/** Persist the flag (callers also flip their own React state). */
export function markOnboarded(): void {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, '1')
  } catch {
    /* private mode — show it again next launch, no harm */
  }
}

/** English sources; translated with t() at render time. `body` is the touch / universal text. */
interface Step {
  icon: ReactNode
  title: string
  body: string
  /** wording for a mouse / trackpad (pointer: fine) when it differs */
  mouseBody?: string
}

const STEPS: readonly Step[] = [
  {
    icon: <ChipIcon size={40} />,
    title: 'This is an STM32 electronics lab',
    body: 'Wire circuits on a 3D breadboard, flash real STM32 firmware, then watch the signals with a logic analyzer, an oscilloscope and a multimeter.',
  },
  {
    icon: <ResetIcon size={40} />,
    title: 'Look around',
    body: 'Drag with one finger to orbit, pinch to zoom, drag with two fingers to pan. Double-tap empty space to re-frame.',
    mouseBody: 'Left-drag to orbit, scroll to zoom, right-drag to pan. Double-click empty space to re-frame.',
  },
  {
    icon: <BookIcon size={40} />,
    title: 'Start with lesson 1',
    body: '{n} guided lessons, from an LED and its resistor to STM32 GPIO, interrupts and I²C. Every step is checked against the live simulation.',
  },
]

/** The pre-wave tour of the classic chrome (git show 6d01968:src/ui/chrome/Onboarding.tsx). */
const LEGACY_STEPS: readonly Step[] = [
  {
    icon: <ResetIcon size={40} />,
    title: 'Look around',
    body: 'Drag to orbit the board, pinch to zoom, two fingers to pan. Double-tap empty space to re-frame.',
  },
  {
    icon: <ChipIcon size={40} />,
    title: 'Place parts',
    body: 'Open Parts in the dock, pick a component, then tap board holes to place it. Wire mode connects them.',
  },
  {
    icon: <SparklesIcon size={40} />,
    title: 'Or just ask',
    body: 'Describe any circuit in the AI tab — it appears on the board, ready to run.',
  },
]

export interface OnboardingProps {
  /** close the tour (persist the flag) — every exit goes through it */
  onDone: () => void
}

export function Onboarding(props: OnboardingProps) {
  useLang()
  return useLegacyChrome() ? <LegacyOnboarding {...props} /> : <PathOnboarding {...props} />
}

/** Focus without a ring unless the keyboard brought it (focusVisible: Chromium ≥ 120, Firefox ≥ 104). */
function focusQuietly(el: HTMLElement | null, visible: boolean): void {
  el?.focus({ preventScroll: true, focusVisible: visible } as FocusOptions)
}

/** The tab stops of the card: its enabled buttons in DOM order (the dots are tabIndex −1). */
function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter(
    (el) => el.tabIndex >= 0 && el.closest('[aria-hidden="true"]') == null,
  )
}

/**
 * The tour's modal focus (release QA SH-F2): the primary button on mount and
 * on each card change, Tab / Shift+Tab trapped in `rootRef`, Esc → `onSkip`,
 * every other key kept from the app behind it (ShortcutsSheet's recipe), the
 * focus given back on close.
 */
function useTourFocus(rootRef: RefObject<HTMLElement>, primaryRef: RefObject<HTMLElement>, step: number, onSkip: () => void): void {
  const skipRef = useRef(onSkip)
  skipRef.current = onSkip
  // did the keyboard drive the tour (then a moved focus shows its ring)
  const keyboardRef = useRef(false)
  useEffect(() => {
    const active = document.activeElement
    const prev = active instanceof HTMLElement && active !== document.body ? active : null
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') keyboardRef.current = true
      const root = rootRef.current
      if (!root) return
      e.stopImmediatePropagation() // modal: nothing behind the tour acts on a key
      if (e.key === 'Tab') {
        const stops = tabStops(root)
        if (stops.length === 0) return
        e.preventDefault()
        const at = stops.indexOf(document.activeElement as HTMLElement)
        const next = at < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length
        focusQuietly(stops[next], true)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        skipRef.current()
      }
    }
    const onPointer = () => {
      keyboardRef.current = false
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
      // give the focus back: where it was, else the 3D view (F6's region)
      const back = prev?.isConnected ? prev : document.querySelector<HTMLElement>('.app-canvas')
      if (!back) return
      if (back.tabIndex < 0 && !back.hasAttribute('tabindex')) back.setAttribute('tabindex', '-1')
      focusQuietly(back, keyboardRef.current)
    }
  }, [rootRef])
  // each card: its primary button
  useEffect(() => {
    focusQuietly(primaryRef.current, keyboardRef.current)
  }, [step, primaryRef])
}

/** The classic chrome's tour, exactly as before the UX wave. */
function LegacyOnboarding({ onDone }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const last = step === LEGACY_STEPS.length - 1
  const rootRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  useTourFocus(rootRef, primaryRef, step, onDone)

  const next = () => {
    tick()
    if (last) onDone()
    else setStep((s) => Math.min(s + 1, LEGACY_STEPS.length - 1))
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div ref={rootRef} className="app-onboard" role="dialog" aria-modal="true" aria-label={t('Welcome tour')}>
      <div className="app-onboard-scrim" />
      <div className="lg-surface app-onboard-card">
        <div className="app-onboard-track-clip">
          <div
            className="app-onboard-track"
            style={{ transform: `translate3d(${-step * (100 / LEGACY_STEPS.length)}%, 0, 0)` }}
          >
            {LEGACY_STEPS.map((s, i) => (
              <div className="app-onboard-step" key={i} aria-hidden={i !== step}>
                <div className="app-onboard-icon">{s.icon}</div>
                <div className="lg-title">{t(s.title)}</div>
                <div className="lg-subhead app-onboard-body">{t(s.body)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="app-onboard-dots" aria-hidden="true">
          {LEGACY_STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              className={`app-onboard-dot lg-hit ${i === step ? 'is-active' : ''}`}
              onClick={() => setStep(i)}
            />
          ))}
        </div>

        <div className="app-onboard-actions">
          <button type="button" className="app-onboard-skip lg-pressable" {...pressProps} onClick={onDone}>
            {t('Skip')}
          </button>
          <PressableButton ref={primaryRef} variant="filled" size="md" onClick={next}>
            {last ? t('Get started') : t('Next')}
          </PressableButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The new chrome's tour: the lab → looking around → the learning path. */
function PathOnboarding({ onDone }: OnboardingProps) {
  const fine = useMediaQuery('(pointer: fine)')
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1
  const rootRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  useTourFocus(rootRef, primaryRef, step, onDone)

  const next = () => {
    tick()
    if (last) onDone()
    else setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  const startLesson = () => {
    tick()
    markOnboarded()
    onDone()
    void startFirstLesson()
  }
  const openExample = () => {
    tick()
    markOnboarded()
    onDone()
    void openExampleById(ONBOARDING_EXAMPLE_ID)
  }

  if (typeof document === 'undefined') return null

  // Portaled to <body>: the dock/capsule/toasts live there now (they must
  // z-stack above sheets), and the coach overlay must cover ALL of them.
  return createPortal(
    <div ref={rootRef} className="app-onboard" role="dialog" aria-modal="true" aria-label={t('Welcome tour')}>
      <div className="app-onboard-scrim" />
      <div className="lg-surface app-onboard-card is-path">
        <div className="app-onboard-track-clip">
          <div
            className="app-onboard-track"
            style={{ transform: `translate3d(${-step * (100 / STEPS.length)}%, 0, 0)` }}
          >
            {STEPS.map((s, i) => (
              <div className="app-onboard-step" key={i} aria-hidden={i !== step}>
                <div className="app-onboard-icon">{s.icon}</div>
                <div className="lg-title app-onboard-title">{t(s.title)}</div>
                <div className="lg-subhead app-onboard-body">
                  {t(fine && s.mouseBody ? s.mouseBody : s.body, { n: LESSONS.length })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="app-onboard-dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              className={`app-onboard-dot lg-hit ${i === step ? 'is-active' : ''}`}
              onClick={() => setStep(i)}
            />
          ))}
        </div>

        {last ? (
          <div className="app-onboard-finish">
            <PressableButton ref={primaryRef} variant="filled" size="lg" icon={<BookIcon size={20} />} onClick={startLesson}>
              {t('Start lesson 1')}
            </PressableButton>
            <button type="button" className="app-onboard-link lg-pressable" {...pressProps} onClick={openExample}>
              {t('See an example first: Blue Pill blinking LED')}
            </button>
            <button type="button" className="app-onboard-skip lg-pressable" {...pressProps} onClick={onDone}>
              {t('Skip')}
            </button>
          </div>
        ) : (
          <div className="app-onboard-actions">
            <button type="button" className="app-onboard-skip lg-pressable" {...pressProps} onClick={onDone}>
              {t('Skip')}
            </button>
            <PressableButton ref={primaryRef} variant="filled" size="md" onClick={next}>
              {t('Next')}
            </PressableButton>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

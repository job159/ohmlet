/**
 * EmptyState — the friendly glass card shown when the layout has no
 * components and no sheet is open (DESIGN.md §2).
 *
 * Classic chrome (isLegacyChrome): "Build your first circuit" with two big
 * buttons to the Parts sheet and the AI sheet — exactly as before the UX
 * wave. Everywhere else (UX wave SH-3) it leads into the learning path:
 * 「從哪裡開始？」 → 「從第一課開始（推薦）」 (the first lesson's starting
 * circuit with the coach on step 1), 「開啟範例」 (the examples list),
 * 「自己放元件」 (the parts library) and — only with an API key set —
 * 「問 AI 幫你接」.
 *
 * The card is a card-tier Liquid Glass lens (it floats directly over the
 * bright board — the showcase surface for the edge refraction) with the
 * tracked specular sheen, and a tone-adaptive platter: over the key-lit
 * empty board it flips to light glass with dark ink (glass/adapt.ts).
 */
import { useCallback, useEffect, useRef } from 'react'
import { attachToneAdapt, BookIcon, ChipIcon, FolderIcon, PressableButton, SparklesIcon, pressProps, useSpecular } from '../kit'
import { t, useLang } from '../../i18n'
import { useStore } from '../../state/store'
import { useLegacyChrome } from './legacy'
import { subscribeEmptyPulse } from './run-feedback'

export interface EmptyStateProps {
  onBrowseParts: () => void
  onAskAi: () => void
  /** new chrome: 「從第一課開始」 */
  onStartLesson?: () => void
  /** new chrome: 「開啟範例」 */
  onOpenExamples?: () => void
}

export function EmptyState({ onBrowseParts, onAskAi, onStartLesson, onOpenExamples }: EmptyStateProps) {
  useLang()
  const legacy = useLegacyChrome()
  const hasApiKey = useStore((s) => s.llm.apiKey.trim() !== '')
  const specRef = useSpecular<HTMLDivElement>()
  const cardRef = useRef<HTMLDivElement | null>(null)
  const setCard = useCallback(
    (node: HTMLDivElement | null) => {
      cardRef.current = node
      specRef(node)
    },
    [specRef],
  )
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    return attachToneAdapt(el)
  }, [legacy])

  // a run was asked for on this empty board (SH-13): 「開啟範例」 pulses once
  const examplesRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (legacy) return
    let timer = 0
    const off = subscribeEmptyPulse(() => {
      const el = examplesRef.current
      if (!el) return
      el.classList.remove('is-pulse')
      void el.offsetWidth // restart the animation
      el.classList.add('is-pulse')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => el.classList.remove('is-pulse'), 1400)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [legacy])

  if (!legacy) {
    return (
      <div className="app-empty" aria-label={t('Getting started')}>
        <div ref={setCard} className="lg-surface lg-lens lg-lens-card app-empty-card is-path">
          <div className="lg-tone" aria-hidden="true" />
          <div className="app-empty-art" aria-hidden="true">
            <BookIcon size={40} />
          </div>
          <div className="lg-title app-empty-title">{t('Where to start?')}</div>
          <div className="lg-subhead app-empty-body">
            {/* auto-run (round 5): what is opened starts simulating by itself — nothing to press */}
            {t('Follow a lesson step by step, or open a ready-made example — it starts simulating by itself.|autosim')}
          </div>
          <div className="app-empty-actions">
            <PressableButton variant="filled" size="lg" haptic icon={<BookIcon size={20} />} onClick={onStartLesson}>
              {t('Start lesson 1 (recommended)')}
            </PressableButton>
            <PressableButton
              ref={examplesRef}
              variant="tinted"
              size="lg"
              haptic
              // over-scene contrast: this card floats over the key-lit board
              className="lg-btn-over-scene app-empty-examples"
              icon={<FolderIcon size={20} />}
              onClick={onOpenExamples}
            >
              {t('Open an example')}
            </PressableButton>
          </div>
          <div className="app-empty-links">
            <button type="button" className="app-empty-link lg-pressable" {...pressProps} onClick={onBrowseParts}>
              <ChipIcon size={16} />
              {t('Place parts yourself')}
            </button>
            {hasApiKey && (
              <button type="button" className="app-empty-link lg-pressable" {...pressProps} onClick={onAskAi}>
                <SparklesIcon size={16} />
                {t('Ask AI to wire it')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-empty" aria-label={t('Getting started')}>
      <div ref={setCard} className="lg-surface lg-lens lg-lens-card app-empty-card">
        <div className="lg-tone" aria-hidden="true" />
        <div className="app-empty-art" aria-hidden="true">
          <ChipIcon size={40} />
        </div>
        <div className="lg-title app-empty-title">{t('Build your first circuit')}</div>
        <div className="lg-subhead app-empty-body">
          {t(
            'Place parts on the breadboard, wire them up, then tap the clock to run the simulation — or let AI build something for you.',
          )}
        </div>
        <div className="app-empty-actions">
          <PressableButton variant="filled" size="lg" haptic icon={<ChipIcon size={20} />} onClick={onBrowseParts}>
            {t('Browse parts')}
          </PressableButton>
          <PressableButton
            variant="tinted"
            size="lg"
            haptic
            // over-scene contrast: this card floats over the key-lit board
            className="lg-btn-over-scene"
            icon={<SparklesIcon size={20} />}
            onClick={onAskAi}
          >
            {t('Ask AI')}
          </PressableButton>
        </div>
      </div>
    </div>
  )
}

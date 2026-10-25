/**
 * AiSheet — the marquee "describe a circuit → it appears" sheet.
 *
 * Glass prompt card (textarea + 3 tappable example chips), a big filled
 * Generate button (Cmd/Ctrl+Enter too), an inline "Add your API key" flow
 * when no key is set, a shimmering status row + Cancel while generating,
 * a result card (counts + pre-wrap explanation, Apply/Discard) when a
 * layout is pending, and a red tinted Retry card on error.
 *
 * All behavior ported from the old LlmPanel; chrome state (prompt text,
 * key editor) is React state — the store stays the source of truth for
 * llm.{busy,status,pending,explanation,error,apiKey}.
 */
import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { verifiedSummaryFor } from '../../llm/generate'
import { PressableButton, Sheet, SparklesIcon, pressProps, showToast, useSpecular } from '../kit'
import { ApiKeyRow } from './ApiKeyRow'
import { t, useLang } from '../../i18n'
import { aiErrorText, aiExpectationText, aiStatusText } from './ai-text'
import './asm-sheets.css'

const SNAP_POINTS = [0.55, 0.92] as const

/** English sources; chips and prompts are translated at render (the model
 *  reads either language). */
const EXAMPLE_PROMPTS: readonly { chip: string; prompt: string }[] = [
  { chip: 'date display', prompt: 'make me a circuit that displays a date' },
  { chip: 'blinking LED', prompt: 'a 555 timer blinking a red LED about twice a second' },
  { chip: 'digit counter', prompt: 'a 0–9 digit counter on a 7-segment display' },
]

export interface AiSheetProps {
  open: boolean
  onDismiss: () => void
  desktop?: boolean
  /** Prefill the prompt on present (applied only while the prompt is empty —
   *  e.g. the empty-state "Ask AI" button, DESIGN.md §2). */
  initialPrompt?: string
}

export function AiSheet({ open, onDismiss, desktop = false, initialPrompt }: AiSheetProps) {
  const llm = useStore((s) => s.llm)
  const generateFromPrompt = useStore((s) => s.generateFromPrompt)
  const applyPending = useStore((s) => s.applyPending)
  const discardPending = useStore((s) => s.discardPending)
  const cancelGeneration = useStore((s) => s.cancelGeneration)
  useLang()

  const [prompt, setPrompt] = useState('')

  // the result card is a tracked Tier-R surface: the shared specular sheen
  // travels over it (rim + slab come from the lg-card class)
  const resultSpecRef = useSpecular<HTMLDivElement>()

  // present at the half (0.55) detent every time; user can drag to full
  const [snap, setSnap] = useState(0)
  useEffect(() => {
    if (open) {
      setSnap(0)
      if (initialPrompt) setPrompt((p) => (p.trim() ? p : initialPrompt))
    }
  }, [open, initialPrompt])

  const hasKey = llm.apiKey.trim().length > 0
  const canGenerate = hasKey && !llm.busy && prompt.trim().length > 0
  // non-null only when llm.pending is the layout the simulator just verified
  const verifiedSummary = verifiedSummaryFor(llm.pending)

  const generate = () => {
    if (!canGenerate) return
    void generateFromPrompt(prompt.trim())
  }

  const apply = () => {
    applyPending()
    // applyPending validates; only dismiss when it actually landed
    const after = useStore.getState().llm
    if (!after.error) {
      showToast(t('Circuit placed on the board'), { icon: <SparklesIcon size={16} /> })
      onDismiss()
    }
  }

  return (
    <Sheet
      open={open}
      onDismiss={onDismiss}
      snapPoints={SNAP_POINTS}
      activeSnap={snap}
      onSnapChange={setSnap}
      desktop={desktop}
      anchor="right"
      ariaLabel={t('AI Circuit Builder')}
      className="asm-sheet"
    >
      <div className="asm-content">
        <div className="asm-sheet-head">
          <SparklesIcon size={24} />
          <span className="lg-title">{t('AI Circuit Builder')}</span>
        </div>

        {/* prompt card — nested glass (rim + slab via lg-card) */}
        <div className="asm-prompt-card lg-card">
          <textarea
            className="asm-textarea"
            rows={3}
            placeholder={t('make me a circuit that displays a date')}
            value={prompt}
            disabled={llm.busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                generate()
              }
            }}
          />
          <div className="asm-chips">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.chip}
                type="button"
                className="asm-chip lg-pressable lg-hit lg-gel"
                disabled={llm.busy}
                {...pressProps}
                onClick={() => setPrompt(t(ex.prompt))}
              >
                {t(ex.chip)}
              </button>
            ))}
          </div>
        </div>

        <PressableButton
          variant="filled"
          size="lg"
          className="asm-block"
          icon={<SparklesIcon size={20} />}
          haptic
          disabled={!canGenerate}
          onClick={generate}
          title={
            !hasKey
              ? t('Add your Anthropic API key below first')
              : prompt.trim().length === 0
                ? t('Describe a circuit first')
                : t('Generate a circuit (Cmd/Ctrl+Enter)')
          }
        >
          {llm.busy ? t('Generating…') : t('Generate')}
        </PressableButton>

        {/* no key → inline key flow (shared with the More sheet) */}
        {!hasKey && (
          <div className="lg-surface lg-list" role="list">
            <ApiKeyRow title={t('Add your API key')} />
          </div>
        )}

        {/* busy → shimmering status + Cancel */}
        {llm.busy && (
          <div className="asm-status lg-card" role="status">
            <span className="asm-status-icon">
              <SparklesIcon size={18} />
            </span>
            <span className="asm-status-text">{llm.status ? aiStatusText(llm.status) : t('working…')}</span>
            <PressableButton
              size="sm"
              variant="plain"
              disabled={llm.status === 'cancelling…'}
              onClick={cancelGeneration}
              title={t('Stop the current generation')}
            >
              {t('Cancel')}
            </PressableButton>
          </div>
        )}

        {/* error → red tinted card + Retry */}
        {llm.error && !llm.busy && (
          <div className="asm-error lg-card" role="alert">
            <div className="asm-error-title">{t('Couldn’t generate that circuit')}</div>
            <div className="asm-error-msg">{aiErrorText(llm.error)}</div>
            <PressableButton
              variant="destructive"
              disabled={!hasKey || prompt.trim().length === 0}
              onClick={generate}
              title={t('Try the same prompt again')}
            >
              {t('Retry')}
            </PressableButton>
          </div>
        )}

        {/* pending → result card with Apply / Discard */}
        {llm.pending && (
          // Tier-R result card: rim + slab (lg-card) + the tracked specular
          <div ref={resultSpecRef} className="asm-result lg-card">
            <div className="asm-result-title">
              {llm.pending.name ? t('Generated: {name}', { name: llm.pending.name }) : t('Generated circuit')}
            </div>
            <div className="lg-caption lg-tabular">
              {t('{components} components · {wires} wires', {
                components: llm.pending.components.length,
                wires: llm.pending.wires.length,
              })}
            </div>
            {/* verified badge: the layout was machine-tested in the simulator
                (kit-styled chip; transform/opacity-free static styles) */}
            {verifiedSummary && (
              <div role="status" aria-label={t('Tested in simulation')}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(48, 209, 88, 0.16)',
                    color: 'var(--ios-green)',
                    font: '600 12px/16px var(--lg-font)',
                  }}
                >
                  {t('✓ Tested in simulation')}
                </span>
                {verifiedSummary.length > 0 && (
                  <ul
                    className="lg-caption"
                    style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 3 }}
                  >
                    {verifiedSummary.map((line, i) => (
                      <li key={i}>{aiExpectationText(line)}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {llm.explanation && <pre className="asm-explain">{llm.explanation}</pre>}
            <div className="asm-result-actions">
              <PressableButton
                variant="filled"
                haptic
                onClick={apply}
                title={t('Place this circuit on the board')}
              >
                {t('Apply')}
              </PressableButton>
              <PressableButton onClick={discardPending} title={t('Throw the generated circuit away')}>
                {t('Discard')}
              </PressableButton>
            </div>
          </div>
        )}

        <div className="asm-foot lg-caption2">
          {t('Runs Claude in your browser with your own API key.')}
        </div>
      </div>
    </Sheet>
  )
}

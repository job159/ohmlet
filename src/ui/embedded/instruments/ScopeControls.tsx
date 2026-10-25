/**
 * Oscilloscope front panel (ScopeView): timebase (s/div, 10 divisions),
 * V/div (auto = the legacy autoscale, or fixed with a position in
 * divisions), trigger (source, slope, level, mode Auto / Normal / Single,
 * holdoff), cursors (time / voltage) and CSV export. Settings live in the
 * shared useScopeSettings store (persisted per browser).
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, MinusIcon, PlusIcon } from '../../kit'
import { fmtSi, fmtVoltage } from '../../../instruments/format'
import { useLegacyChrome } from '../../chrome/legacy'
import { Popover } from './Popover'
import { InstrumentTerm } from './InstrumentTerm'
import { ChipButton, IconButton, SelectField, ToggleChip } from '../controls'
import { HOLDOFFS, TDIVS, VDIVS, fmtDiv, parseVolts, useScopeSettings, type ScopeSettings } from './scope-settings'
import { runScopeAutoSetup } from './scope-autoset'
import { t, useLang } from '../../../i18n'
import { tc } from '../text'
import './instruments.css'

/** "2 ms/div" → "2 ms/格" in Chinese (the unit stays, the division word is localized). */
function divText(s: string): string {
  return s.endsWith('/div') ? `${s.slice(0, -4)}${t('/div')}` : s
}

function LevelInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(`${value} V`)
  useEffect(() => setText(`${Number(value.toFixed(4))} V`), [value])
  const commit = () => {
    const v = parseVolts(text)
    if (v === null) setText(`${Number(value.toFixed(4))} V`)
    else onCommit(v)
  }
  return (
    <input
      className="sco-level"
      aria-label={t('Trigger level (volts)')}
      title={t('Trigger level')}
      value={text}
      inputMode="decimal"
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          setText(`${Number(value.toFixed(4))} V`)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/**
 * Acquisition settings, under the screen (where the legacy window picker
 * sat): timebase, V/div (+ position), trigger source / slope / level /
 * mode / holdoff, Single (re)arm.
 */
export function ScopeControls({
  armed,
  onSingle,
  attached,
}: {
  armed: boolean
  onSingle: () => void
  attached: readonly boolean[]
}) {
  const s = useScopeSettings()
  const set = s.set
  const [busy, setBusy] = useState(false)
  useLang()
  const stepT = (dir: 1 | -1) => {
    const i = TDIVS.indexOf(s.tdiv)
    const ni = Math.max(0, Math.min(TDIVS.length - 1, (i < 0 ? TDIVS.indexOf(0.5) : i) + dir))
    set({ tdiv: TDIVS[ni] })
  }
  const vValue = s.vdiv === 'auto' ? 'auto' : String(s.vdiv)
  // product chrome (QA clarity SCOPE-READOUT-TRIGGER): the trigger is ONE chip that says what it
  // is set to, its fields labelled in a popover; the classic chrome keeps its four selects
  const classic = useLegacyChrome()
  const trigRef = useRef<HTMLSpanElement>(null)
  const [trigOpen, setTrigOpen] = useState(false)
  const holdText = (h: number) => (h === 0 ? t('Hold off') : t('Hold {time}', { time: fmtSi(h, 's', 1).replace('.0 ', ' ') }))

  return (
    <div className="sco-bar" role="toolbar" aria-label={t('Oscilloscope controls')}>
      <span className="sco-group" role="group" aria-label={t('Timebase')}>
        <IconButton
          aria-label={t('Zoom out (slower timebase)')}
          onClick={() => stepT(1)}
          disabled={s.tdiv >= TDIVS[TDIVS.length - 1]}
        >
          <MinusIcon size={14} />
        </IconButton>
        <span className="sco-val" aria-live="polite">
          {divText(fmtDiv(s.tdiv, 's'))}
        </span>
        <IconButton aria-label={t('Zoom in (faster timebase)')} onClick={() => stepT(-1)} disabled={s.tdiv <= TDIVS[0]}>
          <PlusIcon size={14} />
        </IconButton>
      </span>
      <span className="sco-autoset">
        <ChipButton
          onClick={() => {
            if (busy) return
            setBusy(true)
            void runScopeAutoSetup().finally(() => setBusy(false))
          }}
          disabled={busy}
          title={t('Auto setup: 2–3 periods on screen, automatic V/div, trigger on the rising edge at 50 %')}
        >
          {t('Auto setup')}
        </ChipButton>
      </span>
      {classic ? (
        <SelectField
          aria-label={t('Volts per division')}
          value={vValue}
          onChange={(v) => set({ vdiv: v === 'auto' ? 'auto' : Number(v) })}
          options={[
            { value: 'auto', label: t('Auto V/div') },
            ...VDIVS.map((v) => ({ value: String(v), label: divText(fmtDiv(v, 'V')) })),
          ]}
        />
      ) : (
        // the label and its select stay together (a phone row never separates them)
        <span className="sco-field">
          <span className="sco-field-k">
            <InstrumentTerm id="vdiv">{t('V/div|label')}</InstrumentTerm>
          </span>
          <SelectField
            aria-label={t('Volts per division')}
            value={vValue}
            onChange={(v) => set({ vdiv: v === 'auto' ? 'auto' : Number(v) })}
            options={[
              { value: 'auto', label: tc('Auto', 'vdiv') },
              ...VDIVS.map((v) => ({ value: String(v), label: divText(fmtDiv(v, 'V')) })),
            ]}
          />
        </span>
      )}
      {s.vdiv !== 'auto' && (
        <span className="sco-group" role="group" aria-label={t('Vertical position')}>
          <IconButton aria-label={t('Move traces up one division')} onClick={() => set({ vpos: Math.min(16, s.vpos + 1) })}>
            <ChevronUpIcon size={14} />
          </IconButton>
          <IconButton
            aria-label={t('Move traces down one division')}
            onClick={() => set({ vpos: Math.max(-16, s.vpos - 1) })}
          >
            <ChevronDownIcon size={14} />
          </IconButton>
        </span>
      )}
      {!classic && (
        <>
          <span ref={trigRef} className="lai-chip-wrap sco-trig-chip">
            <ChipButton onClick={() => setTrigOpen((o) => !o)} title={t('Trigger settings')}>
              <span className="lai-chip-text">{scopeTriggerSummary(s)}</span>
              <span className="lai-caret" aria-hidden="true">▾</span>
            </ChipButton>
          </span>
          <Popover anchor={trigRef.current} open={trigOpen} onClose={() => setTrigOpen(false)} label={t('Trigger settings')} width={320}>
            <div className="sco-trig-pop" role="group" aria-label={t('Trigger settings')}>
              <div className="sco-trig-head">
                <InstrumentTerm id="trigger">{t('Trigger')}</InstrumentTerm>
              </div>
              <label className="sco-trig-row">
                <span className="sco-trig-k">{tc('Source', 'trigger')}</span>
                <SelectField
                  aria-label={t('Trigger source')}
                  value={s.trigSource === null ? 'off' : String(s.trigSource)}
                  onChange={(v) => set({ trigSource: v === 'off' ? null : Number(v) })}
                  options={[
                    { value: 'off', label: tc('Off', 'trigger') },
                    ...[0, 1, 2, 3].map((c) => ({ value: String(c), label: `CH${c + 1}`, disabled: !attached[c] && s.trigSource !== c })),
                  ]}
                />
              </label>
              {s.trigSource !== null && (
                <>
                  <label className="sco-trig-row">
                    <span className="sco-trig-k">{tc('Edge', 'trigger')}</span>
                    <SelectField
                      aria-label={t('Trigger slope')}
                      value={s.trigSlope}
                      onChange={(v) => set({ trigSlope: v === 'falling' ? 'falling' : 'rising' })}
                      options={[
                        { value: 'rising', label: t('↑ rising edge') },
                        { value: 'falling', label: t('↓ falling edge') },
                      ]}
                    />
                  </label>
                  <label className="sco-trig-row">
                    <span className="sco-trig-k">{tc('Level', 'trigger')}</span>
                    <LevelInput value={s.trigLevel} onCommit={(v) => set({ trigLevel: v })} />
                  </label>
                  <label className="sco-trig-row">
                    <span className="sco-trig-k">{tc('Mode', 'trigger')}</span>
                    <SelectField
                      aria-label={t('Trigger mode')}
                      value={s.trigMode}
                      onChange={(v) => set({ trigMode: v as ScopeSettings['trigMode'] })}
                      options={[
                        { value: 'auto', label: tc('Auto', 'trig-short') },
                        { value: 'normal', label: tc('Normal', 'trig-short') },
                        { value: 'single', label: tc('Single', 'trig-short') },
                      ]}
                    />
                  </label>
                  <label className="sco-trig-row">
                    <span className="sco-trig-k">
                      <InstrumentTerm id="holdoff">{tc('Holdoff', 'trigger')}</InstrumentTerm>
                    </span>
                    <SelectField
                      aria-label={t('Trigger holdoff')}
                      value={String(s.holdoff)}
                      onChange={(v) => set({ holdoff: Number(v) })}
                      options={HOLDOFFS.map((h) => ({ value: String(h), label: h === 0 ? tc('Off', 'trigger') : fmtSi(h, 's', 1).replace('.0 ', ' ') }))}
                    />
                  </label>
                  <p className="sco-trig-note">{t('The moment the signal crosses the level on that edge is time 0 on the axis.')}</p>
                </>
              )}
            </div>
          </Popover>
          {s.trigSource !== null && s.trigMode === 'single' && (
            <ChipButton onClick={onSingle} title={t('Capture the next trigger, then stop')}>
              {armed ? t('Armed…') : tc('Single', 'trig-mode')}
            </ChipButton>
          )}
        </>
      )}
      {classic && (
      <SelectField
        aria-label={t('Trigger source')}
        value={s.trigSource === null ? 'off' : String(s.trigSource)}
        onChange={(v) => set({ trigSource: v === 'off' ? null : Number(v) })}
        options={[
          { value: 'off', label: t('Trig off') },
          ...[0, 1, 2, 3].map((c) => ({
            value: String(c),
            label: t('Trig CH{n}', { n: c + 1 }),
            disabled: !attached[c] && s.trigSource !== c,
          })),
        ]}
      />
      )}
      {classic && s.trigSource !== null && (
        <>
          <SelectField
            aria-label={t('Trigger slope')}
            value={s.trigSlope}
            onChange={(v) => set({ trigSlope: v === 'falling' ? 'falling' : 'rising' })}
            options={[
              { value: 'rising', label: '↑' },
              { value: 'falling', label: '↓' },
            ]}
          />
          <LevelInput value={s.trigLevel} onCommit={(v) => set({ trigLevel: v })} />
          <SelectField
            aria-label={t('Trigger mode')}
            value={s.trigMode}
            onChange={(v) => set({ trigMode: v as ScopeSettings['trigMode'] })}
            options={[
              { value: 'auto', label: tc('Auto', 'trig-mode') },
              { value: 'normal', label: tc('Normal', 'trig-mode') },
              { value: 'single', label: tc('Single', 'trig-mode') },
            ]}
          />
          <SelectField
            aria-label={t('Trigger holdoff')}
            value={String(s.holdoff)}
            onChange={(v) => set({ holdoff: Number(v) })}
            options={HOLDOFFS.map((h) => ({ value: String(h), label: holdText(h) }))}
          />
          {s.trigMode === 'single' && (
            <ChipButton onClick={onSingle} title={t('Capture the next trigger, then stop')}>
              {armed ? t('Armed…') : tc('Single', 'trig-mode')}
            </ChipButton>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The trigger chip's text (QA clarity SCOPE-READOUT-TRIGGER): what the
 * trigger is set to, every field named — 「觸發：CH1 ↑ 上升緣 · 準位 1.55 V ·
 * 自動」 (+ 「· 抑制 1 ms」 when set), 「觸發：關」 when off.
 */
export function scopeTriggerSummary(s: Pick<ScopeSettings, 'trigSource' | 'trigSlope' | 'trigLevel' | 'trigMode' | 'holdoff'>): string {
  if (s.trigSource === null) return t('Trigger: off')
  const parts = [
    `CH${s.trigSource + 1} ${s.trigSlope === 'falling' ? t('↓ falling edge') : t('↑ rising edge')}`,
    t('level {v}', { v: fmtVoltage(s.trigLevel) }),
    tc(s.trigMode === 'single' ? 'Single' : s.trigMode === 'normal' ? 'Normal' : 'Auto', 'trig-short'),
  ]
  if (s.holdoff > 0) parts.push(t('holdoff {time}', { time: fmtSi(s.holdoff, 's', 1).replace('.0 ', ' ') }))
  return t('Trigger: {what}', { what: parts.join(' · ') })
}

/** Screen tools for the legend row: cursor mode + CSV export. */
export function ScopeTools({
  onExport,
  exporting,
  attached,
}: {
  onExport: () => void
  exporting: boolean
  attached: readonly boolean[]
}) {
  const cursors = useScopeSettings((x) => x.cursors)
  const absTime = useScopeSettings((x) => x.absTime)
  const set = useScopeSettings((x) => x.set)
  useLang()
  return (
    <span className="sco-tools" role="group" aria-label={t('Scope tools')}>
      <ToggleChip
        pressed={absTime}
        onChange={(on) => set({ absTime: on })}
        title={t('Label the time axis with the simulation clock (the logic analyzer’s time)')}
      >
        {t('Absolute time')}
      </ToggleChip>
      <SelectField
        aria-label={t('Cursors')}
        value={cursors}
        onChange={(v) => set({ cursors: v === 'time' || v === 'volt' ? v : 'off' })}
        options={[
          { value: 'off', label: t('Cursors') },
          { value: 'time', label: t('Cursors: time') },
          { value: 'volt', label: t('Cursors: V') },
        ]}
      />
      <ChipButton
        onClick={onExport}
        disabled={!attached.some(Boolean) || exporting}
        title={t('Export the displayed samples as CSV')}
      >
        {exporting ? t('Exporting…') : 'CSV'}
      </ChipButton>
    </span>
  )
}

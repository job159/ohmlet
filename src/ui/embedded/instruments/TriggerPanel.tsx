/**
 * Logic-analyzer trigger strip: edge (channel + slope) or pattern (per
 * channel X / 0 / 1), the pre-trigger share of the window, Arm / Cancel
 * and the trigger status. The analyzer owns the search (pure
 * findLogicTrigger over captures pulled from the recorder) and moves the
 * view so the trigger instant sits at the pre-trigger fraction.
 */
import type { LogicChannelConfig } from '../../../sim/coordinator/api'
import { tick } from '../../kit'
import { ChipButton, SelectField } from '../controls'
import { fmtSimTime } from '../format'
import { CHANNEL_COLORS } from './colors'
import { PRE_TRIGGER, type LogicTriggerPrefs } from './la-config'
import { t, useLang } from '../../../i18n'
import './instruments.css'

export type TriggerStatus = { status: 'off' } | { status: 'armed'; armedAt: number } | { status: 'triggered'; at: number }

/** English sources (shown through t()); the first token is the slope arrow. */
const SLOPE_LABEL = { rising: '↑ rising', falling: '↓ falling', any: '↕ any edge' } as const

export function triggerSummary(prefs: LogicTriggerPrefs, channels: readonly LogicChannelConfig[]): string {
  const name = (i: number) => channels.find((c) => c.index === i)?.label ?? `D${i}`
  if (prefs.kind === 'edge') return `${SLOPE_LABEL[prefs.slope].split(' ')[0]} ${name(prefs.channel)}`
  const parts = Object.entries(prefs.pattern).map(([k, v]) => `${name(Number(k))}=${v}`)
  return parts.length ? parts.join(' ') : t('empty pattern')
}

export function TriggerPanel({
  prefs,
  channels,
  state,
  onPrefs,
  onArm,
  onCancel,
}: {
  prefs: LogicTriggerPrefs
  channels: readonly LogicChannelConfig[]
  state: TriggerStatus
  onPrefs: (p: LogicTriggerPrefs) => void
  onArm: () => void
  onCancel: () => void
}) {
  useLang()
  const set = (p: Partial<LogicTriggerPrefs>) => onPrefs({ ...prefs, ...p })
  const hasChannel = channels.some((c) => c.index === prefs.channel)
  const patternEmpty = Object.keys(prefs.pattern).filter((k) => channels.some((c) => c.index === Number(k))).length === 0
  const canArm = channels.length > 0 && (prefs.kind === 'edge' ? hasChannel : !patternEmpty)

  return (
    <div className="lai-panel" role="group" aria-label={t('Trigger')}>
      <div className="lai-row">
        <SelectField
          aria-label={t('Trigger type')}
          value={prefs.kind}
          onChange={(v) => set({ kind: v === 'pattern' ? 'pattern' : 'edge' })}
          options={[
            { value: 'edge', label: t('Edge') },
            { value: 'pattern', label: t('Pattern') },
          ]}
        />
        {prefs.kind === 'edge' ? (
          <>
            <SelectField
              aria-label={t('Trigger channel')}
              value={hasChannel ? String(prefs.channel) : ''}
              onChange={(v) => v !== '' && set({ channel: Number(v) })}
              options={[
                ...(hasChannel ? [] : [{ value: '', label: t('Channel…') }]),
                ...channels.map((c) => ({ value: String(c.index), label: c.label })),
              ]}
            />
            <SelectField
              aria-label={t('Trigger slope')}
              value={prefs.slope}
              onChange={(v) => set({ slope: v === 'rising' || v === 'any' ? v : 'falling' })}
              options={(['rising', 'falling', 'any'] as const).map((s) => ({ value: s, label: t(SLOPE_LABEL[s]) }))}
            />
          </>
        ) : (
          channels.map((c) => {
            const v = prefs.pattern[c.index]
            const label = v === undefined ? 'X' : String(v)
            return (
              <button
                key={c.index}
                type="button"
                className={`lai-pat ${v === undefined ? '' : `is-${v}`}`}
                title={t("{label}: X (don't care) → 0 → 1", { label: c.label })}
                aria-label={t('Pattern level of {label}: {level}', {
                  label: c.label,
                  level: v === undefined ? t("don't care") : v,
                })}
                onClick={() => {
                  tick()
                  const next = { ...prefs.pattern }
                  if (v === undefined) next[c.index] = 0
                  else if (v === 0) next[c.index] = 1
                  else delete next[c.index]
                  set({ pattern: next })
                }}
              >
                <span
                  className="lai-tag-dot"
                  style={{ background: CHANNEL_COLORS[c.index % CHANNEL_COLORS.length] }}
                  aria-hidden="true"
                />
                {c.label}
                <b>{label}</b>
              </button>
            )
          })
        )}
        <SelectField
          aria-label={t('Pre-trigger share of the window')}
          value={String(prefs.pre)}
          onChange={(v) => set({ pre: Number(v) })}
          options={PRE_TRIGGER.map((p) => ({ value: String(p), label: t('Pre: {pct} %', { pct: Math.round(p * 100) }) }))}
        />
        <span className="lai-row-end lai-row">
          {state.status === 'armed' && (
            <span className="lai-note is-warn">{t('waiting for {what}…', { what: triggerSummary(prefs, channels) })}</span>
          )}
          {state.status === 'triggered' && (
            <span className="lai-note is-ok">{t('triggered at {time}', { time: fmtSimTime(state.at) })}</span>
          )}
          {state.status === 'armed' ? (
            <ChipButton onClick={onCancel}>{t('Cancel')}</ChipButton>
          ) : (
            <ChipButton onClick={onArm} disabled={!canArm} title={t('Wait for the trigger condition from now on')}>
              {state.status === 'triggered' ? t('Re-arm') : t('Arm')}
            </ChipButton>
          )}
        </span>
      </div>
    </div>
  )
}

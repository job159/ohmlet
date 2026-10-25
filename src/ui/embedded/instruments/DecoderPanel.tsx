/**
 * Editor of ONE logic-analyzer decoder instance, shown in the popover of its
 * toolbar summary chip (UX IS-5 — the editors no longer push the waveform
 * out of the tray): role → channel mapping, parameters as "Name: value"
 * select wells, the decoder's notes (auto-detected baud, unmapped roles) and
 * 「移除解碼器」. Pure view: the analyzer owns the configs and the decode runs.
 */
import { TrashIcon } from '../../kit'
import type { LogicChannelConfig } from '../../../sim/coordinator/api'
import { ChipButton, SelectField } from '../controls'
import { getDecoder, type DecoderRun, type LogicDecoderConfig } from '../logic-decoders'
import { CHANNEL_COLORS } from './colors'
import { t, useLang } from '../../../i18n'
import { decoderInfoText, tc } from '../text'
import './instruments.css'

/** Decoder role / parameter / option names (src/instruments/decoders, English) in the UI language. */
const dt = (s: string) => tc(s, 'decoder')

export function DecoderEditor({
  cfg,
  channels,
  run,
  onChange,
  onRemove,
}: {
  cfg: LogicDecoderConfig
  channels: readonly LogicChannelConfig[]
  run: DecoderRun | undefined
  onChange: (next: LogicDecoderConfig) => void
  onRemove: () => void
}) {
  useLang()
  const d = getDecoder(cfg.decoder)
  const spec = d?.spec
  if (!d || !spec) return null
  const first = Object.values(cfg.channels)[0]
  return (
    <div className="lai-editor" role="group" aria-label={t('{decoder} decoder settings', { decoder: d.label })}>
      <div className="lai-editor-head">
        <span className="lai-tag" title={t(spec.description)}>
          <span
            className="lai-tag-dot"
            style={{ background: typeof first === 'number' ? CHANNEL_COLORS[first % CHANNEL_COLORS.length] : 'var(--label-3)' }}
            aria-hidden="true"
          />
          {d.label}
        </span>
        <span className="lai-editor-desc">{t(spec.description)}</span>
      </div>
      <div className="lai-editor-grid">
        {spec.roles.map((role) => (
          <SelectField
            key={role.id}
            aria-label={t('{decoder} {role} channel', { decoder: d.label, role: dt(role.label) })}
            value={cfg.channels[role.id] !== undefined ? String(cfg.channels[role.id]) : ''}
            onChange={(v) => {
              const next = { ...cfg.channels }
              if (v === '') delete next[role.id]
              else next[role.id] = Number(v)
              onChange({ ...cfg, channels: next })
            }}
            options={[
              { value: '', label: t('{name}: {value}', { name: dt(role.label), value: role.optional ? '—' : t('pick…') }) },
              ...channels.map((ch) => ({
                value: String(ch.index),
                label: t('{name}: {value}', { name: dt(role.label), value: ch.label }),
              })),
            ]}
          />
        ))}
        {spec.params.map((p) => {
          const value = String(cfg.options?.[p.key] ?? p.default)
          const known = p.options.some((o) => o.value === value)
          return (
            <SelectField
              key={p.key}
              aria-label={`${d.label} ${dt(p.label)}`}
              value={value}
              onChange={(v) => onChange({ ...cfg, options: { ...(cfg.options ?? {}), [p.key]: v } })}
              options={[
                // a programmed rate that is not a standard one (bus helper) stays selectable
                ...(known ? [] : [{ value, label: t('{name}: {value}', { name: dt(p.label), value }) }]),
                ...p.options.map((o) => ({
                  value: o.value,
                  label: t('{name}: {value}', { name: dt(p.label), value: dt(o.label) }),
                })),
              ]}
            />
          )
        })}
      </div>
      {run && run.missing.length > 0 && (
        <p className="lai-editor-note is-warn">
          {t('Pick a channel for {roles} to start decoding.', {
            roles: run.missing.map((r) => dt(spec.roles.find((x) => x.id === r)?.label ?? r)).join(t(', ')),
          })}
        </p>
      )}
      {run && run.missing.length === 0 && run.info.length > 0 && (
        <p className={`lai-editor-note ${run.info[0].startsWith('auto:') ? 'is-ok' : ''}`}>
          {run.info.map(decoderInfoText).join(' · ')}
        </p>
      )}
      <div className="lai-editor-foot">
        <ChipButton destructive onClick={onRemove} aria-label={t('Remove {decoder} decoder', { decoder: d.label })}>
          <TrashIcon size={14} />
          {t('Remove decoder')}
        </ChipButton>
      </div>
    </div>
  )
}

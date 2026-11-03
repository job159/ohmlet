/**
 * 「量測」 — the instrument tray's readings tab (UX IS-19): every multimeter
 * and bench supply of the circuit with its big reading, always in view (the
 * reading used to show only while its part was selected), plus what each
 * net the logic analyzer records is doing right now (H4 — 「PWM 1.000 kHz ·
 * 34.0 %」, 「3.30 V」). A row leads back to its part on the board (frame +
 * mark + select). Telemetry-rate updates (≤ 10 Hz) and the H4 hook's ≤ 4 Hz
 * — no per-frame work.
 *
 * QA clarity MEASURE-COHERENCE (3): the circuit's signal sources and probes
 * are listed too — a function generator with what it is SET to (「FG1 函數產生器
 * · 方波 100 Hz · 0–5.00 V」, the same words as its pin rows and the hover
 * chip), a scope probe with the peak-to-peak of its channel over the scope's
 * window (「PRB1 · CH1 峰對峰值 3.10 V」, read from the scope recorder ≤ 2 Hz
 * while this tab is shown).
 */
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../../state/store'
import { getEntry } from '../../../model/catalog'
import type { ComponentInstance } from '../../../model/types'
import type { LogicChannelConfig } from '../../../sim/coordinator/api'
import { buildNetlist } from '../../../sim/netlist'
import { measureWave } from '../../../instruments/measure'
import { fmtSpan, fmtVoltage } from '../../../instruments/format'
import { t, useLang } from '../../../i18n'
import { partLabel } from '../../../i18n/parts'
import { tick } from '../../kit'
import { useLab } from '../lab'
import { EmptyNote } from '../controls'
import { focusInScene, problemLevelSupported } from '../../workspace/scene-bridge'
import { channelDisplayName } from './channel-name'
import { isMeterPart, isWaveformSourcePart, meterReading } from './meter-readout'
import { logicSourceEndpoint } from '../probe-actions'
import { netLiveText, netLiveTitle, sourceSetting, useNetLive } from './net-activity'
import { CHANNEL_COLORS } from './colors'
import { TRACE_COLORS, shortestPulse } from './scope-engine'
import { useScopeSettings } from './scope-settings'
import { usartLineOnNet } from './signal-readout'
import { useAutoRunWaiting } from '../../chrome/auto-run'
import './instruments.css'

/** Frame and mark a part, and select it (the inspector shows it). */
function showPart(id: string, hole?: string | null): void {
  const spec = { components: [id], holes: hole ? [hole] : [] }
  focusInScene(spec, problemLevelSupported('info') ? { kind: 'problem', level: 'info' } : { kind: 'guide' })
  useStore.getState().select(id)
}

/** The scope's channel of a probe (0-based; the probe's 'channel' parameter 1…4). */
function probeChannel(c: ComponentInstance): number {
  const ch = Math.round(Number(c.params?.channel ?? 1)) - 1
  return ch >= 0 && ch <= 3 ? ch : 0
}

export function MeasureView({ active = true }: { active?: boolean }) {
  useLang()
  const layout = useStore((s) => s.layout)
  const telemetry = useStore((s) => (active ? s.telemetry : null))
  const running = useStore((s) => s.running)
  // auto-run is about to start the board (the boot's firmware restore, a load): a reading is coming
  const startComing = useAutoRunWaiting()
  const channels = useLab((s) => s.logicChannels)
  const meters = useMemo(() => layout.components.filter((c) => isMeterPart(getEntry(c.type))), [layout])
  const sources = useMemo(() => layout.components.filter((c) => isWaveformSourcePart(getEntry(c.type))), [layout])
  const probes = useMemo(() => layout.components.filter((c) => c.type === 'scope_probe' && c.holes?.[0]), [layout])

  if (meters.length === 0 && channels.length === 0 && sources.length === 0 && probes.length === 0) {
    return (
      <div className="emb-view meas-view">
        <EmptyNote title={t('No readings yet')}>
          {t('Place a multimeter or a bench supply (Library → Instruments): their readings stay here, without selecting them.')}
        </EmptyNote>
      </div>
    )
  }
  return (
    <div className="emb-view meas-view" role="list" aria-label={t('Readings')}>
      {meters.map((c) => {
        const entry = getEntry(c.type)!
        const r = meterReading(c, entry, telemetry?.components[c.id], layout, false)
        return (
          <button
            key={c.id}
            type="button"
            role="listitem"
            className="meas-row"
            title={t('Show {id} on the board', { id: c.id })}
            onClick={() => {
              tick()
              showPart(c.id)
            }}
          >
            <span className="meas-name">
              <span className="meas-id" translate="no">
                {c.id}
              </span>
              <span className="meas-kind">{partLabel(entry)}</span>
            </span>
            <span className={`meas-value ${r.value ? '' : 'is-empty'}`} translate="no">
              {r.value ?? '—'}
            </span>
            <span className={`meas-sub ${r.unwired ? 'is-open' : ''}`}>
              {r.unwired
                ? // nothing to wait for: say what is missing (UX QA IS-F11)
                  r.sub
                : r.value
                  ? running
                    ? r.sub
                    : t('{what} · paused (last reading)', { what: r.sub })
                  : running || startComing
                    ? t('Waiting for the first reading…')
                    : t('Shown once you press “▶ Run simulation” above')}
            </span>
          </button>
        )
      })}
      {sources.map((c) => (
        <SourceRow key={c.id} comp={c} />
      ))}
      {probes.length > 0 && <ProbeRows probes={probes} active={active} />}
      {channels.length > 0 && <div className="meas-section">{t('Nets on the logic analyzer')}</div>}
      {channels.map((ch) => (
        <NetRow key={ch.index} ch={ch} />
      ))}
    </div>
  )
}

/** A function generator: what it is set to (a setting, never a measurement — QA clarity FG-RAIL). */
function SourceRow({ comp }: { comp: ComponentInstance }) {
  const layout = useStore((s) => s.layout)
  const entry = getEntry(comp.type)!
  const setting = sourceSetting(comp.id, layout)
  const mid = setting ? (setting.lo + setting.hi) / 2 : null
  const amp = setting ? (setting.hi - setting.lo) / 2 : null
  return (
    <button
      type="button"
      role="listitem"
      className="meas-row"
      title={`${t('Show {id} on the board', { id: comp.id })} · ${netLiveTitle(setting)}`}
      onClick={() => {
        tick()
        showPart(comp.id)
      }}
    >
      <span className="meas-name">
        <span className="meas-id" translate="no">
          {comp.id}
        </span>
        <span className="meas-kind">{partLabel(entry)}</span>
      </span>
      <span className="meas-value is-net" translate="no">
        {setting ? netLiveText(setting, { form: 'compact' }) : '—'}
      </span>
      <span className="meas-sub">
        {mid !== null && amp !== null ? t('Setting: centre {mid} ± amplitude {amp}', { mid: fmtVoltage(mid), amp: fmtVoltage(amp) }) : ''}
      </span>
    </button>
  )
}

/** One probe's reading: its channel's peak-to-peak over the scope's window (null = no samples yet). */
interface ProbeReading {
  vpp: number | null
  /** the line is faster than the analog samples: no level to trust (UX QA IS-F6) */
  undersampled: boolean
  span: number
}

/** The scope probes: their channel's peak-to-peak over the scope's window (≤ 2 Hz while shown). */
function ProbeRows({ probes, active }: { probes: ComponentInstance[]; active: boolean }) {
  const running = useStore((s) => s.running)
  const started = useStore((s) => s.simTime > 0)
  const startComing = useAutoRunWaiting()
  const queryScope = useLab((s) => s.queryScope)
  const tdiv = useScopeSettings((s) => s.tdiv)
  const [readings, setReadings] = useState<ReadonlyMap<number, ProbeReading>>(() => new Map())
  const key = probes.map((p) => `${p.id}:${probeChannel(p)}:${p.holes?.[0] ?? ''}`).join(',')
  useEffect(() => {
    if (!active) return
    let alive = true
    let inflight = false
    let readAt = -1
    const span = 10 * tdiv
    const read = () => {
      const st = useStore.getState()
      const now = st.simTime
      if (inflight || !(now > 0) || (!st.running && readAt >= now)) return
      inflight = true
      readAt = now
      const t0 = Math.max(0, now - span)
      queryScope(t0, now, 4096)
        .then((cap) => {
          if (!alive) return
          const lay = useStore.getState().layout
          const lab = useLab.getState()
          let netlist: ReturnType<typeof buildNetlist> | null = null
          try {
            netlist = buildNetlist(lay)
          } catch {
            netlist = null
          }
          const next = new Map<number, ProbeReading>()
          for (const p of probes) {
            const ch = probeChannel(p)
            if (next.has(ch)) continue
            const tr = cap.traces.find((x) => x.index === ch)
            if (!tr || tr.t.length < 2) continue
            // a serial line faster than the analog samples has no level to trust (the scope's own guard)
            const net = netlist && p.holes?.[0] ? netlist.netOf(p.holes[0]) : null
            const line = net && netlist ? usartLineOnNet(net, netlist, { layout: lay, telemetry: useStore.getState().telemetry, mcus: lab.mcus }) : null
            const m = measureWave(tr.t, tr.v, t0, now, { decimated: !!tr.decimated, minPulse: shortestPulse(line, null) })
            next.set(ch, { vpp: m.vpp, undersampled: m.amplitude === 'undersampled', span: now - t0 })
          }
          setReadings(next)
        })
        .catch(() => {})
        .finally(() => {
          inflight = false
        })
    }
    read()
    const id = window.setInterval(read, 500)
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, tdiv, queryScope])
  return (
    <>
      {probes.map((p) => {
        const ch = probeChannel(p)
        const r = readings.get(ch)
        const value = !r ? null : r.undersampled ? t('— (undersampled)') : r.vpp === null ? null : fmtVoltage(r.vpp, { precision: 'reading' })
        return (
          <button
            key={p.id}
            type="button"
            role="listitem"
            className="meas-row"
            title={t('Show {id} on the board', { id: p.id })}
            onClick={() => {
              tick()
              showPart(p.id, p.holes?.[0] ?? null)
            }}
          >
            <span className="meas-name">
              <span className="meas-dot" style={{ background: TRACE_COLORS[ch] }} aria-hidden="true" />
              <span className="meas-id" translate="no">
                {p.id}
              </span>
              <span className="meas-kind">{t('Scope CH{n}', { n: ch + 1 })}</span>
            </span>
            <span className={`meas-value ${value ? '' : 'is-empty'}`} translate="no">
              {value ? (
                <>
                  {/* the row is a button: a plain label (the scope's own readout explains 峰對峰值) */}
                  <span className="meas-q">{t('Peak-to-peak|reading')}</span>
                  {value}
                </>
              ) : (
                '—'
              )}
            </span>
            <span className="meas-sub">
              {value && r
                ? running
                  ? t('Over the scope’s window (last {span})', { span: fmtSpan(r.span) })
                  : t('{what} · paused (last reading)', { what: t('Over the scope’s window (last {span})', { span: fmtSpan(r.span) }) })
                : started || startComing
                  ? t('Waiting for the first reading…')
                  : t('Shown once you press “▶ Run simulation” above')}
            </span>
          </button>
        )
      })}
    </>
  )
}

/** One recorded net: its name and what it is doing (H4), leading back to its pin. */
function NetRow({ ch }: { ch: LogicChannelConfig }) {
  const layout = useStore((s) => s.layout)
  const name = channelDisplayName(layout, ch)
  const ref = logicSourceEndpoint(ch.source, layout)
  const live = useNetLive(ref)
  return (
    <button
      type="button"
      role="listitem"
      className="meas-row is-net"
      title={`${name.title} · ${netLiveTitle(live)}`}
      onClick={() => {
        tick()
        if (name.componentId) showPart(name.componentId, name.hole)
        else if (name.hole) focusInScene({ holes: [name.hole], components: [] }, { kind: 'guide' })
      }}
    >
      <span className="meas-name">
        <span className="meas-dot" style={{ background: CHANNEL_COLORS[ch.index % CHANNEL_COLORS.length] }} aria-hidden="true" />
        <span className="meas-id">{name.name}</span>
        <span className="meas-kind">{name.sub}</span>
      </span>
      <span className={`meas-value is-net ${live ? '' : 'is-empty'}`} translate="no">
        {netLiveText(live)}
      </span>
    </button>
  )
}

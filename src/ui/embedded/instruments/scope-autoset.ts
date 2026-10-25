/**
 * Oscilloscope 「自動設定」 (UX IS-2) and the digital-exact link.
 *
 * Auto setup picks a timebase that shows 2–3 periods across the 10
 * divisions, automatic V/div, a rising trigger at 50 % of the swing on the
 * first channel with a periodic signal, trigger mode Auto. The period comes
 * from MEASURED data only:
 *   - exact: the probe sits on a net the logic analyzer records (an
 *     MCU-driven net — the edges are cycle-exact), median rising-edge interval;
 *   - else the recorder's analog samples, queried in windows that shrink
 *     while the data comes back decimated and grow while no complete period
 *     is seen — never from decimated or under-sampled data.
 * Nothing found → the timebase stays, V/div goes to auto, and the toast
 * says so.
 *
 * scopeLogicLinks: scope channel → the logic channel recording the same
 * electrical net (the scope's measurement strip then reads frequency / duty
 * from exact edges: 「頻率 1.000 kHz（數位精確）」).
 */
import type { CircuitLayout } from '../../../model/types'
import type { LogicChannelConfig } from '../../../sim/coordinator/api'
import { buildNetlist } from '../../../sim/netlist'
import { AMPLITUDE_MIN_SAMPLES, measureWave, medianSampleInterval } from '../../../instruments/measure'
import { typicalPeriod } from '../../../instruments/autofit'
import { fmtBaud } from '../../../instruments/format'
import { decoderLineOf, usartLineOnNet, type SerialLine } from './signal-readout'
import { sanitizeDecoderConfigs } from './la-config'
import { useStore } from '../../../state/store'
import { showToast } from '../../kit'
import { t } from '../../../i18n'
import { useLab } from '../lab'
import { logicSourceEndpoint } from '../probe-actions'
import { MAX_POINTS } from './scope-engine'
import { TDIVS, fmtDiv, useScopeSettings } from './scope-settings'

/** scope channel (0..3) → logic channel index recording the same net */
export function scopeLogicLinks(layout: CircuitLayout, channels: readonly LogicChannelConfig[]): Map<number, number> {
  const out = new Map<number, number>()
  const probes = layout.components.filter((c) => c.type === 'scope_probe' && c.holes?.[0])
  if (probes.length === 0 || channels.length === 0) return out
  const netlist = buildNetlist(layout)
  const logicNets = new Map<string, number>()
  for (const ch of channels) {
    const ref = logicSourceEndpoint(ch.source, layout)
    const net = ref ? netlist.netOf(ref) : null
    if (net && !logicNets.has(net)) logicNets.set(net, ch.index)
  }
  for (const p of probes) {
    const ch = Math.round(Number(p.params?.channel ?? 1)) - 1
    if (ch < 0 || ch > 3 || out.has(ch)) continue
    const net = netlist.netOf(p.holes![0])
    const li = net ? logicNets.get(net) : undefined
    if (li !== undefined) out.set(ch, li)
  }
  return out
}

/** Attached scope channels (0..3) of the layout, CH1 first. */
export function attachedScopeChannels(layout: CircuitLayout): number[] {
  const out = new Set<number>()
  for (const c of layout.components) {
    if (c.type !== 'scope_probe') continue
    const ch = Math.round(Number(c.params?.channel ?? 1)) - 1
    if (ch >= 0 && ch <= 3) out.add(ch)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * The s/div showing about 2.5 periods across 10 divisions (never fewer than
 * ~2): 1 kHz → 200 µs/div, 0.998 Hz → 200 ms/div… (1-2-5 ladder).
 */
export function tdivForPeriod(period: number): number {
  let best = TDIVS[TDIVS.length - 1]
  let bestScore = Infinity
  for (const d of TDIVS) {
    const periods = (10 * d) / period
    if (periods < 1.9) continue
    const score = Math.abs(Math.log(periods / 2.5))
    if (score < bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

/**
 * The fastest timebase the recording can fill (UX QA IS-F6): two analog
 * sample intervals per division — 50 µs samples → 100 µs/div — so 自動設定
 * never lands on 「時基比取樣間隔還快」. The smallest ladder value ≥ 2 × dt;
 * dt unknown → no limit.
 */
export function minTdivFor(sampleInterval: number | null | undefined): number {
  if (typeof sampleInterval !== 'number' || !(sampleInterval > 0)) return TDIVS[0]
  const need = 2 * sampleInterval
  return TDIVS.find((d) => d >= need * (1 - 1e-9)) ?? TDIVS[TDIVS.length - 1]
}

/** 自動設定's timebase: ~2.5 periods across the screen, never faster than the samples allow. */
export function autosetTdiv(period: number, sampleInterval: number | null | undefined): number {
  return Math.max(tdivForPeriod(period), minTdivFor(sampleInterval))
}

/**
 * The trigger level at 50 % of the analog min / max — never a rail: a window
 * that saw one level only (a UART line idling high, 3.3 V) triggers at half
 * of it (1.65 V). `fallback` when nothing is known.
 */
export function autosetTrigLevel(vmin: number | null, vmax: number | null, fallback: number): number {
  if (vmin === null || vmax === null || !Number.isFinite(vmin) || !Number.isFinite(vmax)) return fallback
  const mid = vmax - vmin >= 0.1 ? (vmin + vmax) / 2 : vmax / 2
  return Number(mid.toPrecision(3))
}

interface Found {
  channel: number
  period: number
  exact: boolean
  vmin: number | null
  vmax: number | null
}

/** The analog sample interval of `channel` near the end of the recording (non-decimated; null = unknown). */
async function sampleIntervalOf(channel: number, now: number): Promise<number | null> {
  const query = useLab.getState().queryScope
  let w = Math.min(now, 0.02)
  for (let i = 0; i < 6 && w > 0; i++) {
    const cap = await query(Math.max(0, now - w), now, MAX_POINTS)
    const tr = cap.traces.find((x) => x.index === channel)
    if (!tr || tr.t.length < 2) return null
    const decimated = tr.decimated ?? tr.t.length >= MAX_POINTS / 2
    if (!decimated) return medianSampleInterval(tr.t, tr.v)
    w /= 10
  }
  return null
}

/** The serial line on scope channel `channel`'s net (the firmware's USART, or the linked channel's UART decoder). */
function serialLineOfProbe(layout: CircuitLayout, channel: number, linked: number | undefined): SerialLine | null {
  const probe = layout.components.find((c) => c.type === 'scope_probe' && Math.round(Number(c.params?.channel ?? 1)) - 1 === channel)
  const hole = probe?.holes?.[0]
  if (!hole) return null
  try {
    const netlist = buildNetlist(layout)
    const net = netlist.netOf(hole)
    const lab = useLab.getState()
    const ctx = { layout, telemetry: useStore.getState().telemetry, mcus: lab.mcus }
    return (net ? usartLineOnNet(net, netlist, ctx) : null) ?? (linked !== undefined ? decoderLineOf(linked, sanitizeDecoderConfigs(lab.logicView.decoders)) : null)
  } catch {
    return null
  }
}

async function analogPeriod(channel: number, now: number): Promise<{ period: number | null; vmin: number | null; vmax: number | null }> {
  const query = useLab.getState().queryScope
  let w = Math.min(now, 0.02)
  let vmin: number | null = null
  let vmax: number | null = null
  for (let i = 0; i < 8 && w > 0; i++) {
    const cap = await query(Math.max(0, now - w), now, MAX_POINTS)
    const tr = cap.traces.find((x) => x.index === channel)
    if (!tr || tr.t.length < 2) return { period: null, vmin, vmax }
    const decimated = tr.decimated ?? tr.t.length >= MAX_POINTS / 2
    if (decimated) {
      if (w <= 2e-5) break
      w /= 10 // too dense for one query: look at a shorter stretch
      continue
    }
    const m = measureWave(tr.t, tr.v, -Infinity, Infinity, { decimated: false })
    vmin = m.vmin
    vmax = m.vmax
    if (m.period !== null) return { period: m.period, vmin, vmax }
    if (w >= now || w >= 20) break
    w = Math.min(now, w * 10) // no complete period yet: a longer stretch
  }
  return { period: null, vmin, vmax }
}

async function levelsOf(channel: number, now: number, span: number): Promise<{ vmin: number | null; vmax: number | null }> {
  const cap = await useLab.getState().queryScope(Math.max(0, now - span), now, MAX_POINTS)
  const tr = cap.traces.find((x) => x.index === channel)
  if (!tr || tr.t.length === 0) return { vmin: null, vmax: null }
  const m = measureWave(tr.t, tr.v)
  return { vmin: m.vmin, vmax: m.vmax }
}

export interface AutoSetupResult {
  ok: boolean
  tdiv?: number
  channel?: number
  period?: number
  exact?: boolean
  reason?: string
}

/** Run 自動設定 on the current recording; applies the settings and toasts the outcome. */
export async function runScopeAutoSetup(): Promise<AutoSetupResult> {
  const st = useStore.getState()
  const layout = st.layout
  const now = st.simTime
  const chans = attachedScopeChannels(layout)
  const fail = (reason: string): AutoSetupResult => {
    showToast(reason, { duration: 3600 })
    return { ok: false, reason }
  }
  if (chans.length === 0) return fail(t('No scope probe in the circuit — place one on the net you want to see.'))
  if (!(now > 0)) return fail(t('No samples yet — press ▶ Run simulation first, then Auto setup.'))
  const links = scopeLogicLinks(layout, useLab.getState().logicChannels)
  let found: Found | null = null
  for (const ch of chans) {
    const li = links.get(ch)
    if (li !== undefined) {
      const cap = await useLab.getState().queryLogic(Math.max(0, now - 2), now)
      const tr = cap.traces.find((x) => x.index === li)
      // a whole period when there is one; a lone edge-to-edge interval still picks a usable timebase
      const p = tr ? typicalPeriod(tr, -Infinity, Infinity, { risingOnly: true }) ?? typicalPeriod(tr) : null
      if (p !== null) {
        const lv = await levelsOf(ch, now, Math.min(now, 3 * p))
        found = { channel: ch, period: p, exact: true, ...lv }
        break
      }
    }
    const a = await analogPeriod(ch, now)
    if (a.period !== null) {
      found = { channel: ch, period: a.period, exact: false, vmin: a.vmin, vmax: a.vmax }
      break
    }
  }
  const set = useScopeSettings.getState().set
  if (!found) {
    set({ vdiv: 'auto', autoPending: false })
    showToast(t('No repeating signal found on the probes — V/div set to auto, timebase unchanged.'), { duration: 3600 })
    return { ok: false, reason: 'no-period' }
  }
  // never faster than the recording's samples (2 per division), the trigger at
  // 50 % of the analog levels over a stretch that saw both (UX QA IS-F6)
  const dt = await sampleIntervalOf(found.channel, now)
  const wanted = tdivForPeriod(found.period)
  const tdiv = autosetTdiv(found.period, dt)
  let { vmin, vmax } = found
  if (vmin === null || vmax === null || vmax - vmin < 0.1) {
    const lv = await levelsOf(found.channel, now, Math.min(now, Math.max(3 * found.period, 20 * (dt ?? 0), 5e-3)))
    if (lv.vmin !== null && lv.vmax !== null) ({ vmin, vmax } = lv)
  }
  const level = autosetTrigLevel(vmin, vmax, useScopeSettings.getState().trigLevel)
  set({ tdiv, vdiv: 'auto', trigSource: found.channel, trigSlope: 'rising', trigLevel: level, trigMode: 'auto', autoPending: false })
  const div = fmtDiv(tdiv, 's')
  const divText = div.endsWith('/div') ? `${div.slice(0, -4)}${t('/div')}` : div
  const line = serialLineOfProbe(layout, found.channel, links.get(found.channel))
  if (line && (tdiv > wanted || (dt !== null && 1 / line.baud < AMPLITUDE_MIN_SAMPLES * dt))) {
    // a serial line is faster than the analog samples: say so, and where to look instead
    showToast(t('This is a {baud} serial signal: the scope’s samples are too coarse, so it is set to {tdiv} — use the logic analyzer to see each bit', { baud: fmtBaud(line.baud), tdiv: divText }), {
      duration: 5200,
    })
  } else {
    showToast(t('Auto setup: {tdiv}, trigger CH{n} ↑', { tdiv: divText, n: found.channel + 1 }), { duration: 3200 })
  }
  return { ok: true, tdiv, channel: found.channel, period: found.period, exact: found.exact }
}

/**
 * The reading of a bench meter or supply (UX IS-19): the multimeter's own
 * display text, a supply's output current — or its output voltage when
 * nothing draws current (never 「5 nA」). The ONE source of that text: the
 * inspector's 「讀數」 card (PropertiesSheet ReadoutGroup) and the 量測 tab
 * both call meterReading (H3 formats via ui/embedded/format.ts), so they
 * never disagree.
 *
 * UX QA IS-F11: a multimeter whose IN or COM terminal has no wire measures
 * nothing — no 「0.000 V」 from an open 10 MΩ input: value null and
 * 「— 探棒未接（DMM1 IN 端還沒接線）」 (`unwired`). The layout defaults to the
 * store's current one, so both callers get it without passing it.
 * UX QA IS-F17: a secondary voltage uses the reading precision of the big
 * value next to it (「輸出電壓 5.000 V」).
 * The classic chrome (isLegacyChrome) keeps the pre-QA readings exactly —
 * the meter's own display text and the compact secondary voltage.
 */
import type { CatalogEntry } from '../../../model/catalog'
import { paramOf } from '../../../model/catalog'
import type { CircuitLayout, ComponentInstance, ComponentTelemetry } from '../../../model/types'
import { t } from '../../../i18n'
import { useStore } from '../../../state/store'
import { isLegacyChrome } from '../../chrome/legacy'
import { fmtReadingCurrent, fmtReadingVoltage, isNoLoad } from '../format'

/**
 * A source whose output follows a waveform (a function generator — QA
 * clarity FG-RAIL): its terminal current and power jump with the wave, so a
 * live row never shows one instant of them as if it were steady.
 */
export function isWaveformSourcePart(entry: CatalogEntry | undefined): boolean {
  return !!entry && (entry.type === 'function_generator' || !!entry.params?.some((p) => p.key === 'waveform'))
}

/** The 即時讀數 text of a waveform source's current / power: 「交流（瞬時值會跳動）——請用示波器看」. */
export function waveformLiveText(): string {
  return t('AC (the instantaneous value jumps) — use the scope')
}

/** A part whose reading the 量測 tab lists. */
export function isMeterPart(entry: CatalogEntry | undefined): boolean {
  const model = entry?.sim.kind === 'device' ? entry.sim.model : ''
  return model === 'multimeter' || model === 'power_supply'
}

/** The multimeter's mode label (telemetry.text[1]) as what it measures, between which probes. */
export function meterModeText(mode: string | undefined): string {
  switch (mode) {
    case 'DC V':
    case 'V':
      return t('DC voltage (IN − COM)')
    case 'DC A':
    case 'A':
      return t('DC current (IN → COM)')
    case 'Ω':
    case 'Ω':
      return t('Resistance (IN − COM)')
    default:
      return mode ?? ''
  }
}

/** How to wire a multimeter's probes for `mode` (the next step after 「探棒未接」). */
export function probeWiringHint(mode: string): string {
  switch (mode) {
    case 'A':
      return t('put the meter in the current’s path: current flows in at IN and out at COM')
    case 'Ω':
    case 'Ω':
      return t('wire IN and COM across the part to measure (circuit unpowered)')
    default:
      return t('wire COM to GND and IN to the point to measure')
  }
}

/** The meter's probe terminals without a wire (in catalog order), or null when `comp` is not in `layout`. */
export function unwiredProbes(comp: ComponentInstance, entry: CatalogEntry, layout: CircuitLayout): string[] | null {
  if (!layout.components.some((c) => c.id === comp.id)) return null
  const wired = new Set<string>()
  for (const w of layout.wires) {
    wired.add(w.from)
    wired.add(w.to)
  }
  return entry.pins.filter((pin) => !wired.has(`${comp.id}:${pin}`))
}

/** The meter reading: the big value (null = none yet / nothing to read) and what it is. */
export interface MeterReading {
  value: string | null
  sub: string
  /** a probe terminal has no wire: `sub` says which, and there is nothing to wait for */
  unwired?: boolean
}

/** The big value (null = no reading yet) and what it is. */
export function meterReading(
  comp: ComponentInstance,
  entry: CatalogEntry,
  tele: ComponentTelemetry | undefined,
  layout: CircuitLayout = useStore.getState().layout,
  /** the classic chrome: the pre-QA readings, unchanged */
  classic: boolean = isLegacyChrome(),
): MeterReading {
  const model = entry.sim.kind === 'device' ? entry.sim.model : ''
  if (model === 'multimeter') {
    const open = classic ? null : unwiredProbes(comp, entry, layout)
    if (open && open.length > 0) {
      const what =
        open.length >= 2
          ? t('Probes not connected ({id}: neither probe is wired yet)', { id: comp.id })
          : t('Probe not connected ({id} {pin} terminal is not wired yet)', { id: comp.id, pin: open[0] })
      // what is missing AND the next step, in the meter's own mode (the owner's empty-state rule)
      return { value: null, sub: t('{what} — {next}', { what, next: probeWiringHint(String(paramOf(comp.params, entry, 'mode') ?? 'V')) }), unwired: true }
    }
    const raw = tele?.text?.[0]
    return {
      value: raw === undefined ? null : raw === 'OL' ? t('OL (over range)') : raw,
      sub: meterModeText(tele?.text?.[1] ?? String(paramOf(comp.params, entry, 'mode') ?? 'V')),
    }
  }
  if (model === 'power_supply') {
    const vp = tele?.pinVoltages?.['+']
    const vm = tele?.pinVoltages?.['-']
    const vOut = vp !== undefined && vm !== undefined ? vp - vm : undefined
    if (isNoLoad(tele?.current) && vOut !== undefined) return { value: fmtReadingVoltage(vOut), sub: t('Output voltage · no load') }
    return {
      value: tele?.current !== undefined && Number.isFinite(tele.current) ? fmtReadingCurrent(tele.current, { precision: 'reading' }) : null,
      sub: vOut !== undefined ? t('Output current · output {v}', { v: classic ? fmtReadingVoltage(vOut) : fmtReadingVoltage(vOut, { precision: 'reading' }) }) : t('Output current'),
    }
  }
  return { value: null, sub: '' }
}

/**
 * Finding construction shared by the ERC rule modules.
 */
import type { ErcFinding, ErcLevel, ErcRuleId } from './api'

export interface FindingDraft {
  rule: ErcRuleId
  level: ErcLevel
  /** subject key, unique within the rule (component / pin / net ids) */
  key: string
  message: string
  componentIds: (string | null | undefined)[]
  nets: (string | null | undefined)[]
  holes: (string | null | undefined)[]
  wireIds?: string[]
  /** short English headline (ErcFinding.short) */
  short?: string
  /** datasheet / model reference (ErcFinding.ref) */
  ref?: string
  /** common-cause group key (ErcFinding.group) */
  group?: string
  /** the fact it states (ErcFinding.fact) */
  fact?: string
  /** raw catalog pin names the message mentions (ErcFinding.pins) */
  pins?: { id: string; pin: string | null | undefined }[]
  /** where the fix goes (ErcFinding.fixHoles) */
  fixHoles?: (string | null | undefined)[]
}

function uniq(list: (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const x of list) if (typeof x === 'string' && x.length > 0 && !out.includes(x)) out.push(x)
  return out
}

export function makeFinding(d: FindingDraft): ErcFinding {
  const f: ErcFinding = {
    id: `${d.rule}:${d.key}`,
    rule: d.rule,
    level: d.level,
    message: d.message,
    componentIds: uniq(d.componentIds),
    // private '@' sub-circuit nodes are not netlist nets
    nets: uniq(d.nets).filter((n) => !n.startsWith('@')),
    holes: uniq(d.holes),
  }
  if (d.wireIds && d.wireIds.length > 0) f.wireIds = uniq(d.wireIds)
  if (d.short) f.short = d.short
  if (d.ref) f.ref = d.ref
  if (d.group) f.group = d.group
  if (d.fact) f.fact = d.fact
  if (d.pins) {
    const pins: { id: string; pin: string }[] = []
    for (const p of d.pins) {
      if (p.pin && !pins.some((q) => q.id === p.id && q.pin === p.pin)) pins.push({ id: p.id, pin: p.pin })
    }
    if (pins.length > 0) f.pins = pins
  }
  if (d.fixHoles) {
    const fix = uniq(d.fixHoles).filter((h) => !f.holes.includes(h))
    if (fix.length > 0) f.fixHoles = fix
  }
  return f
}

/** "A", "A and B", "A, B and C" */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** E12 preferred values (IEC 60063), one decade. */
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]

/** Smallest E12 value ≥ r (Ω). */
export function e12AtLeast(r: number): number {
  if (!(r > 0) || !Number.isFinite(r)) return 0
  let decade = Math.pow(10, Math.floor(Math.log10(r)))
  for (;;) {
    for (const m of E12) {
      const v = Math.round(m * decade * 1000) / 1000
      if (v >= r * (1 - 1e-9)) return v
    }
    decade *= 10
  }
}

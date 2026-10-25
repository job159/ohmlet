/**
 * The instruments' jargon as glossary terms (QA clarity
 * GLOSSARY-IN-INSTRUMENTS): 峰對峰值, 平均值, 均方根, 週期, 上升時間, 觸發,
 * 抑制時間, V/格, 鮑率 (115 200 Bd · 8N1), Δt, 1/Δt, 邊緣數, 突發, ACK and the
 * I²C lane letters get the inspector's dotted underline + ⓘ (<Term id> in
 * controls.tsx — one Term component, one Tier-S popover) with a one- or
 * two-sentence explanation from the shared glossary (src/ui/embedded/
 * glossary.ts, QA clarity GLOSSARY-ENTRIES).
 *
 * Two labels the shared glossary does not define yet — the scope's 上升時間
 * and the I²C lane letters — are registered into it here, additively: an id
 * the glossary defines keeps the glossary's own text. A label whose id the
 * glossary does not hold renders plain (never a broken popover). English
 * sources; zh-TW of the two additions in src/i18n/zh-TW/qa-instruments.ts.
 * The classic chrome keeps its plain labels.
 */
import type { ReactNode } from 'react'
import { Term } from '../controls'
import { GLOSSARY, type GlossaryEntry, type GlossaryId } from '../glossary'
import { useLegacyChrome } from '../../chrome/legacy'

/** The glossary ids the instruments label (the shared glossary's, plus 'rise' and 'i2c-lane'). */
export type InstrumentTermId =
  | 'period'
  | 'edges'
  | 'dt'
  | 'burst'
  | 'baud'
  | '8n1'
  | 'vpp'
  | 'avg'
  | 'rms'
  | 'rise'
  | 'trigger'
  | 'holdoff'
  | 'vdiv'
  | 'tdiv'
  | 'ack'
  | 'i2c-lane'

/** Entries the shared glossary lacks (English sources, translated at display by glossaryText → t()). */
export const INSTRUMENT_TERMS: Readonly<Partial<Record<InstrumentTermId, GlossaryEntry>>> = {
  rise: {
    title: 'Rise time (10–90 %)',
    body: 'How long the signal takes to climb from 10 % to 90 % of its swing. For an RC circuit it is about 2.2 × R × C.',
  },
  'i2c-lane': {
    title: 'I²C lane letters',
    body: 'S = start, Sr = repeated start, P = stop, A = ACK (answered), N = NACK (no answer).',
  },
}

// register once, additively: the glossary's own entry wins
for (const [id, e] of Object.entries(INSTRUMENT_TERMS)) {
  const g = GLOSSARY as Record<string, GlossaryEntry>
  if (e && !(id in g)) g[id] = e
}

/** The glossary explains `id` (so a Term can open). */
export function hasInstrumentTerm(id: InstrumentTermId): boolean {
  return id in GLOSSARY
}

/** An instrument label as a glossary term (classic chrome, or an id the glossary lacks: the plain label). */
export function InstrumentTerm({ id, children, className }: { id: InstrumentTermId; children: ReactNode; className?: string }) {
  const classic = useLegacyChrome()
  if (classic || !hasInstrumentTerm(id)) return <>{children}</>
  return (
    <Term id={id as GlossaryId} className={`ins-term ${className ?? ''}`}>
      {children}
    </Term>
  )
}

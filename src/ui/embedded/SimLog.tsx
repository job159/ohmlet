/**
 * Simulation log — the coordinator's event stream (MCU core/peripheral
 * notices, unsupported-register accesses, loader findings, device events),
 * read from the lab's capped ring buffer whenever `logVersion` bumps.
 * Filter by level and by source ('sim', 'U1/core', 'U1/USART1' …); every
 * line carries its SIMULATION timestamp in seconds to the microsecond
 * ("2.586 123 s", "0.000 050 s" — H3 fmtSimTimeAt, the logic analyzer's
 * clock; UX IS-8 / IS-17; classic chrome keeps "50.00 µs"), and hovering a line offers 「在邏輯分析儀中檢視」 (the analyzer
 * centres on that instant with marker A) when the analyzer has channels.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Segmented } from '../kit'
import type { SimLogEntry } from '../../sim/coordinator/api'
import { labBuffers, useLab } from './lab'
import { EmptyNote, SelectField, ToggleChip } from './controls'
import { fmtSimTime, upperAddresses } from './format'
import { fmtSimTimeAt } from '../../instruments/format'
import { useLegacyChrome } from '../chrome/legacy'
import { revealInLogic } from './probe-actions'
import { t, useLang } from '../../i18n'
import { logSourceText, tMessageCached, tc } from './text'
import './embedded.css'

type LevelFilter = 'all' | 'warning' | 'error'
const MAX_ROWS = 1500

export function SimLog({ active = true }: { active?: boolean }) {
  const logVersion = useLab((s) => (active ? s.logVersion : 0))
  const hasChannels = useLab((s) => s.logicChannels.length > 0)
  const [level, setLevel] = useState<LevelFilter>('all')
  const [source, setSource] = useState('')
  const [follow, setFollow] = useState(true)
  useLang()
  const classic = useLegacyChrome()
  const stamp = (time: number) => (classic ? fmtSimTime(time) : fmtSimTimeAt(time, 1e-6))

  const entries = useMemo<readonly SimLogEntry[]>(
    () => (active ? labBuffers.log() : []),
    // the buffer is module-level; logVersion is the change signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, logVersion],
  )

  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) set.add(e.source)
    return [...set].sort()
  }, [entries])

  const shown = useMemo(() => {
    const out = entries.filter(
      (e) =>
        (level === 'all' || (level === 'warning' ? e.level !== 'info' : e.level === 'error')) &&
        (source === '' || e.source === source || e.source.startsWith(`${source}/`)),
    )
    return out.length > MAX_ROWS ? out.slice(out.length - MAX_ROWS) : out
  }, [entries, level, source])

  const outRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = outRef.current
    if (el && follow) el.scrollTop = el.scrollHeight
  })

  const counts = useMemo(() => {
    let w = 0
    let e = 0
    for (const x of entries) {
      if (x.level === 'warning') w++
      else if (x.level === 'error') e++
    }
    return { w, e }
  }, [entries])

  return (
    <div className="emb-view emb-log">
      <div className="emb-toolbar" role="toolbar" aria-label={t('Log filters')}>
        <Segmented<LevelFilter>
          className="emb-seg-sm"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: t('All') },
            { value: 'warning', label: `${t('Warnings')}${counts.w + counts.e > 0 ? ` ${counts.w + counts.e}` : ''}` },
            { value: 'error', label: `${t('Errors')}${counts.e > 0 ? ` ${counts.e}` : ''}` },
          ]}
          aria-label={tc('Level', 'log')}
        />
        <SelectField
          aria-label={tc('Source', 'log')}
          value={source}
          onChange={setSource}
          options={[{ value: '', label: t('All sources') }, ...sources.map((s) => ({ value: s, label: logSourceText(s) }))]}
        />
        <span className="emb-toolbar-spacer" />
        <ToggleChip pressed={follow} onChange={setFollow} title={t('Follow new entries')}>
          {t('Follow')}
        </ToggleChip>
      </div>
      {entries.length === 0 ? (
        <EmptyNote title={t('No log entries yet')}>
          {t(
            'Firmware notices, unsupported peripheral accesses and simulator events appear here once the simulation runs.',
          )}
        </EmptyNote>
      ) : (
        <div
          ref={outRef}
          className="emb-log-out"
          role="log"
          aria-label={t('Simulation log')}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 8
            if (atEnd !== follow) setFollow(atEnd)
          }}
        >
          {shown.length === 0 ? (
            <span className="emb-term-dim">{t('No entries match the filter.')}</span>
          ) : (
            shown.map((e, i) => (
              <div key={i} className={`emb-log-row is-${e.level}`} tabIndex={-1}>
                <span className="emb-log-ts emb-mono lg-tabular">{stamp(e.time)}</span>
                <span className="emb-log-lvl" aria-label={t(e.level)} />
                <span className="emb-log-src emb-mono">{logSourceText(e.source)}</span>
                <span className="emb-log-msg">{classic ? tMessageCached(e.message) : upperAddresses(tMessageCached(e.message))}</span>
                {hasChannels && (
                  <button
                    type="button"
                    className="emb-term-reveal"
                    title={t('Centre the logic analyzer on this moment, marker A on it')}
                    onClick={() => revealInLogic(e.time, 0.01, e.time)}
                  >
                    {t('Show in logic analyzer')}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

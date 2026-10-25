/**
 * Small shared lesson UI pieces: level / runnable names (t() sources with
 * zh-TW entries in src/i18n/zh-TW/lessons-ui.ts), the runnable badge, the
 * pass / fail / pending check glyph and the run progress bar.
 */
import type { Lesson, LessonLevel, LessonRunnable } from '../../lessons/types'
import { t, useLang } from '../../i18n'
import { tc } from '../format'
import type { EvalProgress } from '../../lessons/engine'

export const LEVEL_ORDER: readonly LessonLevel[] = ['beginner', 'intermediate', 'advanced']

/** English sources (context 'lesson level': 初級 / 中級 / 進階). */
const LEVEL_NAMES: Record<LessonLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

export function levelName(level: LessonLevel): string {
  return tc(LEVEL_NAMES[level], 'lesson level')
}

/** The lesson's course code for teachers and handouts: 「初級 1」, 「中級 3」 (LS-7). */
export function lessonCode(lesson: Pick<Lesson, 'level' | 'order'>): string {
  return `${levelName(lesson.level)} ${lesson.order}`
}

const RUNNABLE_NAMES: Record<LessonRunnable, string> = {
  ready: 'Runnable',
  partial: 'Partly simulated',
  'not-yet': 'Not runnable yet',
}

const RUNNABLE_HINTS: Record<LessonRunnable, string> = {
  ready: 'Everything in this lesson runs in the simulator.',
  partial: 'This lesson runs, but some aspects are not simulated (see the note).',
  'not-yet': 'The simulator cannot run this lesson yet (see the note); you can still read it.',
}

export function runnableName(r: LessonRunnable): string {
  return t(RUNNABLE_NAMES[r])
}

export function RunnableBadge({ runnable }: { runnable: LessonRunnable }) {
  useLang()
  return (
    <span className={`lsn-badge is-${runnable}`} title={t(RUNNABLE_HINTS[runnable])}>
      {runnableName(runnable)}
    </span>
  )
}

/** "約 N 分鐘" */
export function durationText(min: number | undefined): string | null {
  return typeof min === 'number' && Number.isFinite(min) && min > 0 ? t('About {n} min', { n: Math.round(min) }) : null
}

/** 'todo' = evaluated and failing, but the learner has not attempted the step yet (neutral) */
export type CheckState = 'pass' | 'fail' | 'pending' | 'running' | 'error' | 'todo'

/** Status glyph of one check (decorative: rows carry the spoken state). */
export function CheckGlyph({ state }: { state: CheckState }) {
  return (
    <span className={`lsn-glyph is-${state}`} aria-hidden="true">
      {state === 'pass' ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.3 5 8.7l4.6-5.2" />
        </svg>
      ) : state === 'fail' || state === 'error' ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3.2 3.2l5.6 5.6M8.8 3.2 3.2 8.8" />
        </svg>
      ) : null}
    </span>
  )
}

export function stateText(state: CheckState): string {
  switch (state) {
    case 'pass':
      return t('passed')
    case 'fail':
      return t('failed')
    case 'error':
      return t('could not be evaluated')
    case 'running':
      return t('checking')
    case 'pending':
      return t('not checked yet')
    case 'todo':
      return t('not done yet')
  }
}

/** Determinate progress of a running check (fraction 0..1 + the check being evaluated). */
export function RunProgress({ progress, onCancel }: { progress: EvalProgress | null; onCancel?: () => void }) {
  useLang()
  const f = progress ? Math.max(0, Math.min(1, progress.fraction)) : 0
  const label = progress
    ? t('Checking {i} of {n}: {label}', { i: Math.min(progress.index + 1, progress.total), n: progress.total, label: progress.label })
    : t('Preparing the simulation…')
  return (
    <div className="lsn-progress" role="status" aria-live="polite">
      <div className="lsn-progress-line">
        <span className="lsn-progress-label">{label}</span>
        {onCancel && (
          <button type="button" className="lsn-link" onClick={onCancel}>
            {t('Cancel')}
          </button>
        )}
      </div>
      <div
        className="lsn-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(f * 100)}
        aria-label={t('Check progress')}
      >
        <div className="lsn-progress-fill" style={{ transform: `scaleX(${f})` }} />
      </div>
    </div>
  )
}

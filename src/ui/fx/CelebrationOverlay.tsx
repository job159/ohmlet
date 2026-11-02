/**
 * <CelebrationOverlay/> (owner: vivid) — mounted ONCE by App.tsx.
 *
 *  - installs the success watchers (success-watch.ts: lesson pass, circuit
 *    ok) for the page's lifetime, and routes the 3D layer's damage cue
 *    (a part burns / vents) to the 'burn' sound;
 *  - shows the big 「完成！」 badge of a passed lesson (useCelebration.badge —
 *    only the learner's own pass, never the loaded answer): a glowing check,
 *    the word and what passed, centred just under the run capsule (clear of
 *    the circuit; the 3D confetti is aimed around its measured box —
 *    celebrate.ts measuredBadgeRect) for
 *    BADGE_MS; a tap / click or Esc closes it early. Rim tier, no
 *    backdrop-filter (the ≤ 4 concurrent-filter budget); pointer-transparent
 *    except for the badge itself; aria-live so a screen reader hears it.
 *    prefers-reduced-motion: no pop / burst animation, it simply appears.
 *  - The classic chrome never gets a badge (celebrate() skips it there).
 *
 * The circuit-ok cue is a toast (showToast) — the overlay draws nothing for it.
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useCelebration } from './celebrate'
import { startSuccessWatch } from './success-watch'
import { playCue } from './sound'
import { setFxCueSink } from '../../three/internal/fx/scene-fx'
import { isLegacyChrome } from '../chrome/legacy'
import { t } from '../../i18n'
import './fx.css'

export function CelebrationOverlay() {
  useEffect(() => startSuccessWatch(), [])
  // the 3D layer's damage pop (a part burns / vents): the classic chrome stays silent
  useEffect(() => {
    setFxCueSink((cue) => {
      if (!isLegacyChrome()) playCue(cue)
    })
    return () => setFxCueSink(null)
  }, [])
  const badge = useCelebration((s) => s.badge)
  const dismiss = useCelebration((s) => s.dismiss)

  useEffect(() => {
    if (!badge) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [badge, dismiss])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fx-cele-host" aria-live="polite">
      {badge && (
        <button
          key={badge.id}
          type="button"
          className="fx-cele-badge lg-rim"
          onClick={dismiss}
          aria-label={badge.message ? `${badge.title} ${badge.message}` : badge.title}
          title={t('Close|celebration')}
        >
          <span className="fx-cele-burst" aria-hidden="true" />
          <span className="fx-cele-check" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="56" height="56">
              <circle cx="24" cy="24" r="22" />
              <path d="M14 25 l7 7 l14 -16" />
            </svg>
          </span>
          <span className="fx-cele-title">{badge.title}</span>
          {badge.message && <span className="fx-cele-msg">{badge.message}</span>}
        </button>
      )}
    </div>,
    document.body,
  )
}

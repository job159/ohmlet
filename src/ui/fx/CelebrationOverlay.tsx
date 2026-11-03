/**
 * <CelebrationOverlay/> (owner: vivid) — mounted ONCE by App.tsx.
 *
 *  - installs the success watchers (success-watch.ts: lesson pass, circuit
 *    ok) and the mechanical sound watcher (mech-watch.ts: parts, wires,
 *    buttons, switches, relays — from the store) for the page's lifetime,
 *    and routes the 3D layer's cues: the damage cue (a part burns / vents)
 *    to the 'burn' sound, the hands-on scene moments to voiceSceneCue —
 *    only where the page may sound (mech-watch soundsHere: the product
 *    chrome, not ?shotrig), which it also hands to sound.ts (setSoundGate:
 *    elsewhere not even an AudioContext is made), and tells the watcher
 *    whether a 3D scene shows the board (its touchdown clack is the scene's);
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
import { setSceneShowing, soundsHere, startMechSoundWatch, voiceSceneCue } from './mech-watch'
import { playCue, setSoundGate } from './sound'
import { setFxCueSink } from '../../three/internal/fx/scene-fx'
import { sceneRegistered } from '../workspace/scene-bridge'
import { t } from '../../i18n'
import './fx.css'

export function CelebrationOverlay() {
  // where the page may sound (the classic chrome and ?shotrig: never — not
  // even an AudioContext at the first gesture)
  useEffect(() => {
    setSoundGate(soundsHere)
    setSceneShowing(sceneRegistered)
    return () => {
      setSoundGate(null)
      setSceneShowing(null)
    }
  }, [])
  useEffect(() => startSuccessWatch(), [])
  useEffect(() => startMechSoundWatch(), [])
  // the 3D layer's damage pop (a part burns / vents) and hands-on scene
  // moments (lift, snap, settle, wire tip, a refused drop, a board's touchdown)
  useEffect(() => {
    setFxCueSink((cue) => {
      if (!soundsHere()) return
      if (cue === 'burn') playCue(cue)
      else voiceSceneCue(cue) // a new board's touchdown: the only clack while the scene shows it
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

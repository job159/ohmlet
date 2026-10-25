/**
 * Classic-chrome switch (UX wave contract K1 — docs/ux/UX_REVIEW.md §6.4/6.5).
 *
 * The UX wave reworks the chrome for the product language (zh-TW) and the
 * desktop workspace. English WITHOUT the workspace is the compatibility
 * mode the legacy visual-regression scenes pin (bb.lang = 'en', workspace
 * off): there every surface must render exactly as before the wave. Every
 * new chrome behaviour (run capsule, status pill, onboarding, dock items…)
 * is therefore gated on:
 *
 *   isLegacyChrome() = lang() === 'en' && !(workspace enabled && wide fine-pointer viewport)
 *
 * English WITH the workspace (extra-*-workspace scenes) is NOT legacy: it
 * gets the new chrome (those baselines are re-shot deliberately).
 *
 * `isLegacyChrome()` reads the current state (event handlers, module code);
 * `useLegacyChrome()` is the reactive form — it re-renders on a language
 * switch, on the workspace toggle and when the viewport crosses the
 * workspace media query. Both are cheap; neither touches the DOM at import.
 */
import { lang, useLang } from '../../i18n'
import { WORKSPACE_MEDIA_QUERY, useLab } from '../embedded/lab'
import { useWorkspaceActive } from '../workspace/state'

/**
 * The desktop workspace is showing right now: enabled in the lab prefs AND
 * the viewport matches WORKSPACE_MEDIA_QUERY (≥ 1100 px, fine pointer).
 * Non-React twin of useWorkspaceActive(); false outside a browser.
 */
export function isWorkspaceShowing(): boolean {
  try {
    if (!useLab.getState().workspace.enabled) return false
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(WORKSPACE_MEDIA_QUERY).matches
  } catch {
    return false
  }
}

/** True when the classic (pre-UX-wave) chrome must render unchanged. */
export function isLegacyChrome(): boolean {
  return lang() === 'en' && !isWorkspaceShowing()
}

/** Reactive isLegacyChrome(): language + workspace toggle + viewport. */
export function useLegacyChrome(): boolean {
  const l = useLang()
  const workspaceOn = useWorkspaceActive()
  return l === 'en' && !workspaceOn
}

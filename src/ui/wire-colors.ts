import { tc } from './format'

/** The six wire colors offered in the toolbar swatch picker (classic chrome). */
export const WIRE_COLORS: { name: string; hex: string }[] = [
  { name: 'red', hex: '#e5484d' },
  { name: 'black', hex: '#1f232a' },
  { name: 'yellow', hex: '#e8c11c' },
  { name: 'green', hex: '#46a758' },
  { name: 'blue', hex: '#3e7bfa' },
  { name: 'white', hex: '#e8eaed' },
]

/**
 * UI tones of the other colour names a wire can take — the role colours of
 * src/ui/wire-roles.ts (orange PWM, the signal palette) and the names the
 * scene maps to PVC tones (three/internal/wires.ts PVC_NAMES), so a swatch in
 * the inspector, a lesson table or a handout matches the wire on the board.
 */
const MORE_COLORS: Record<string, string> = {
  orange: '#e07b2f',
  purple: '#8e44ad',
  violet: '#8e44ad',
  teal: '#1fb1a9',
  cyan: '#1fb1a9',
  pink: '#d44f9e',
  brown: '#8a5a33',
  gray: '#9aa0a8',
  grey: '#9aa0a8',
}

/** Display hex for a wire color name (falls back to the raw css value). */
export function wireColorHex(name: string | undefined): string {
  if (!name) return '#888c94'
  const found = WIRE_COLORS.find((c) => c.name === name)
  if (found) return found.hex
  return MORE_COLORS[name.trim().toLowerCase()] ?? name
}

/**
 * Display name of a wire color: the English name itself ("red") in English,
 * 紅色 / 黑色 / … in zh-TW (dictionary keys "red|wire color" …). Unknown
 * CSS values are shown raw.
 */
export function wireColorLabel(name: string): string {
  return tc(name, 'wire color')
}

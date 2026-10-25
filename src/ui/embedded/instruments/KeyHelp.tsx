/**
 * Keyboard help line of the instrument plots (UX IS-9): shown while a plot
 * has KEYBOARD focus, keycaps as <kbd class="lg-kbd"> (the kit's keycap,
 * as in toasts and the shortcuts list), each followed by what it does —
 * "← → 平移 · + − 縮放 · …". Keycap names are printed on the keyboard, so
 * they stay as they are; the words around them go through t().
 */
export interface KeyHelpItem {
  keys: readonly string[]
  /** what the keys do (already translated) */
  text: string
}

export function KeyHelp({ items }: { items: readonly KeyHelpItem[] }) {
  return (
    <span className="lai-keys" role="note">
      {items.map((it) => (
        <span key={it.keys.join('')} className="lai-keys-item">
          {it.keys.map((k) => (
            <kbd key={k} className="lg-kbd">
              {k}
            </kbd>
          ))}
          <span className="lai-keys-text">{it.text}</span>
        </span>
      ))}
    </span>
  )
}

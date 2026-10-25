/**
 * UX requests round (IS-18 (3) / §5.4 「一律寫成 W1」): lesson circuits name
 * their wires W1, W2 … like the editor does. The store renames a lower-case
 * 'w<n>' on load, but the printed handout reads the lesson source directly —
 * so the source itself must use the in-app ids, or the handout says 「w3」
 * where the app says 「導線 W3」.
 *  - every wire id of every start / solution circuit is W<n>, unique (case-insensitively);
 *  - loading it renames nothing (handout ids = app ids);
 *  - a wire the start circuit already has keeps its id in the solution.
 */
import { describe, expect, it } from 'vitest'
import { LESSONS } from '../src/lessons'
import { migrateComponentIds } from '../src/state/project'

const sameEnds = (a: { from: string; to: string }, b: { from: string; to: string }) =>
  (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from)

describe('lesson wire ids are the app’s W ids', () => {
  for (const lesson of LESSONS) {
    it(lesson.id, () => {
      for (const which of ['start', 'solution'] as const) {
        const layout = lesson[which].layout
        const ids = layout.wires.map((w) => w.id)
        for (const id of ids) expect(id, `${lesson.id} ${which}`).toMatch(/^W\d+$/)
        expect(new Set(ids.map((id) => id.toLowerCase())).size, `${lesson.id} ${which}: unique ids`).toBe(ids.length)
        expect(migrateComponentIds(layout).renames, `${lesson.id} ${which}: nothing renamed on load`).toEqual({})
      }
      for (const w of lesson.start.layout.wires) {
        const twin = lesson.solution.layout.wires.find((s) => sameEnds(s, w))
        if (twin) expect(twin.id, `${lesson.id}: ${w.from} → ${w.to}`).toBe(w.id)
      }
    })
  }
})

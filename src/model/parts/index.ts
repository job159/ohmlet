/**
 * Per-family catalog part files. Every `src/model/parts/<family>.parts.ts`
 * exports `PARTS: CatalogEntry[]`; they are collected here at build time
 * (Vite import.meta.glob — works in the app, the workers and vitest) and
 * appended to CATALOG in path order, so new part families never edit
 * catalog.ts. Part files may only `import type` from '../catalog' (it
 * imports this module).
 */
import type { CatalogEntry } from '../catalog'

const modules = import.meta.glob<{ PARTS: CatalogEntry[] }>('./*.parts.ts', { eager: true })

function collect(): CatalogEntry[] {
  const seen = new Set<string>()
  const out: CatalogEntry[] = []
  for (const path of Object.keys(modules).sort()) {
    for (const entry of modules[path].PARTS ?? []) {
      if (seen.has(entry.type)) throw new Error(`duplicate catalog type "${entry.type}" in ${path}`)
      seen.add(entry.type)
      out.push(entry)
    }
  }
  return out
}

export const EXTRA_PARTS: CatalogEntry[] = collect()

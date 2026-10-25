/**
 * Firmware assets the evaluator may need beyond the learner's own circuit:
 * the bundled firmware/dist images (a 'firmware-loaded' check with a
 * `project` compares against the real image; 'firmware-checks' runs it) and
 * the projects' machine-checkable contracts (firmware/dist/manifest.json).
 *
 * `defaultAssets` loads them on demand: in a page they are fetched static
 * assets (their URLs come from an eager Vite `?url` glob — the bundle holds
 * only the URL strings), in node (tests, scripts) they are read from disk.
 * The lesson-check worker gets exactly what a run needs pre-loaded by the
 * calling thread (`assetNeeds` → `collectAssets` → `prefetchedAssets`).
 *
 * This module (part of the worker's graph) contains NO dynamic import():
 * the worker bundle must stay a single chunk (Vite builds workers as IIFE,
 * which cannot code-split). Node built-ins are reached through
 * process.getBuiltinModule instead.
 */
import type { ManifestEntry } from '../../sim/coordinator/checks'
import type { LessonCheck } from '../types'

export interface FirmwareFile {
  name: string
  bytes: Uint8Array
  /** raw .bin images: the flash address they were loaded at (absent = loader default) */
  binBase?: number
}

export interface EvalAssets {
  /** the firmware/dist image of a project (null: no such bundled firmware) */
  bundled(project: string): Promise<FirmwareFile | null>
  /** the manifest entry (description, expect, checks) of a project (null: unknown) */
  manifest(project: string): Promise<ManifestEntry | null>
}

/*
 * Asset URLs of the bundled ELFs and the manifest. Same files as
 * src/firmware-assets.ts, resolved here without its node fallback's
 * `new URL(`…${file}`, import.meta.url)`: Vite expands that template into
 * an eager URL import of EVERY file in firmware/dist, including the local
 * (gitignored) linker .map files, which the dev server answers as JSON — the
 * page would fail to load.
 */
const ELF_URLS = import.meta.glob<string>('/firmware/dist/*.elf', { query: '?url', import: 'default', eager: true })
const MANIFEST_URLS = import.meta.glob<string>('/firmware/dist/manifest.json', { query: '?url', import: 'default', eager: true })

function elfKey(project: string): string {
  return `/firmware/dist/${project}.elf`
}

/** A firmware/dist project has a bundled ELF. */
export function hasBundled(project: string): boolean {
  return elfKey(project) in ELF_URLS
}

type NodeFs = { readFileSync(path: string): Uint8Array }
type NodeUrl = { fileURLToPath(url: string): string }

/** node built-ins without an import() (null in a browser / worker) */
function builtin<T>(id: string): T | null {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  return typeof proc?.getBuiltinModule === 'function' ? ((proc.getBuiltinModule(id) as T | undefined) ?? null) : null
}

/** In node: the bytes of firmware/dist/<file> read from disk; null in a browser. */
function readDist(file: string): Uint8Array | null {
  if (typeof window !== 'undefined') return null
  const fs = builtin<NodeFs>('node:fs')
  const url = builtin<NodeUrl>('node:url')
  if (!fs || !url) return null
  // …/src/lessons/engine/assets.ts → …/firmware/dist/<file>
  const dir = import.meta.url.replace(/src\/lessons\/engine\/assets\.[a-z]+(\?.*)?$/, 'firmware/dist/')
  return new Uint8Array(fs.readFileSync(url.fileURLToPath(dir + file)))
}

async function fetchBytes(url: string, file: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not fetch ${file}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** The bundled ELF of a project: read from disk in node, fetched in a page. */
async function loadBundled(project: string): Promise<FirmwareFile> {
  const url = ELF_URLS[elfKey(project)]
  const name = `${project}.elf`
  if (!url) throw new Error(`unknown bundled firmware "${project}"`)
  const local = readDist(name)
  return { name, bytes: local ?? (await fetchBytes(url, name)) }
}

let manifestPromise: Promise<Record<string, ManifestEntry>> | null = null

function loadManifest(): Promise<Record<string, ManifestEntry>> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const local = readDist('manifest.json')
      const url = MANIFEST_URLS['/firmware/dist/manifest.json']
      const bytes = local ?? (url ? await fetchBytes(url, 'manifest.json') : null)
      if (!bytes) throw new Error('firmware/dist/manifest.json is not bundled')
      return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, ManifestEntry>
    })().catch((err: unknown) => {
      manifestPromise = null
      throw err
    })
  }
  return manifestPromise
}

const bundledCache = new Map<string, Promise<FirmwareFile | null>>()

export const defaultAssets: EvalAssets = {
  bundled(project) {
    let p = bundledCache.get(project)
    if (!p) {
      p = hasBundled(project)
        ? loadBundled(project).catch((err: unknown) => {
            bundledCache.delete(project)
            throw err
          })
        : Promise.resolve(null)
      bundledCache.set(project, p)
    }
    return p
  },
  async manifest(project) {
    const m = await loadManifest()
    return Object.prototype.hasOwnProperty.call(m, project) ? m[project] : null
  },
}

/** Pre-loaded assets (structured-clone friendly) — what the worker receives. */
export interface AssetBundle {
  bundled: Record<string, FirmwareFile | null>
  manifest: Record<string, ManifestEntry | null>
}

export function prefetchedAssets(bundle: AssetBundle): EvalAssets {
  return {
    bundled: async (project) => bundle.bundled[project] ?? null,
    manifest: async (project) => bundle.manifest[project] ?? null,
  }
}

/** Which bundled images / manifest entries a list of checks needs. */
export function assetNeeds(checks: readonly LessonCheck[]): { bundled: string[]; manifest: string[] } {
  const bundled = new Set<string>()
  const manifest = new Set<string>()
  const walk = (c: LessonCheck): void => {
    if (c.kind === 'firmware-loaded' && c.project) bundled.add(c.project)
    else if (c.kind === 'firmware-checks') {
      bundled.add(c.project)
      manifest.add(c.project)
    } else if (c.kind === 'all') c.checks.forEach(walk)
  }
  checks.forEach(walk)
  return { bundled: [...bundled], manifest: [...manifest] }
}

/** Load the assets `checks` need through `from` (default: defaultAssets). Missing ones are null. */
export async function collectAssets(checks: readonly LessonCheck[], from: EvalAssets = defaultAssets): Promise<AssetBundle> {
  const need = assetNeeds(checks)
  const bundle: AssetBundle = { bundled: {}, manifest: {} }
  for (const p of need.bundled) {
    try {
      bundle.bundled[p] = await from.bundled(p)
    } catch {
      bundle.bundled[p] = null
    }
  }
  for (const p of need.manifest) {
    try {
      bundle.manifest[p] = await from.manifest(p)
    } catch {
      bundle.manifest[p] = null
    }
  }
  return bundle
}

/**
 * Bundled firmware images (firmware/dist/*.elf) for lessons and examples.
 * The ELFs are emitted as static assets (Vite ?url) and fetched on demand,
 * so the main bundle never embeds them. In node (vitest) the files are read
 * from disk instead.
 */
const urls = import.meta.glob<string>('/firmware/dist/*.elf', { query: '?url', import: 'default' })

function keyOf(name: string): string {
  return `/firmware/dist/${name}.elf`
}

/** firmware/dist project names that have an ELF */
export function bundledFirmwareNames(): string[] {
  return Object.keys(urls)
    .map((k) => k.slice('/firmware/dist/'.length, -'.elf'.length))
    .sort()
}

export function hasBundledFirmware(name: string): boolean {
  return keyOf(name) in urls
}

/** The ELF bytes of a bundled firmware project (throws if unknown). */
export async function loadBundledFirmware(name: string): Promise<{ name: string; bytes: Uint8Array }> {
  const load = urls[keyOf(name)]
  if (!load) throw new Error(`unknown bundled firmware "${name}"`)
  const file = `${name}.elf`
  // node (vitest): read from disk. process.getBuiltinModule keeps node:fs out
  // of the browser graph, and the path is NOT built with new URL(template,
  // import.meta.url) — Vite would turn that into an eager glob of every file
  // in firmware/dist (incl. gitignored *.map) and break the dev server.
  const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown; cwd?: () => string } }).process
  if (typeof window === 'undefined' && proc?.getBuiltinModule && proc.cwd) {
    const fs = proc.getBuiltinModule('node:fs') as { readFileSync(p: string): Uint8Array }
    const bytes = fs.readFileSync(`${proc.cwd()}/firmware/dist/${file}`)
    return { name: file, bytes: new Uint8Array(bytes) }
  }
  const url = await load()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not fetch ${file}: HTTP ${res.status}`)
  return { name: file, bytes: new Uint8Array(await res.arrayBuffer()) }
}

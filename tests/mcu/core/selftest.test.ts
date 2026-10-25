/**
 * cpu-selftest differential test: firmware/projects/cpu-selftest/selftest.c
 * (CRC32, sorting, 64-bit multiply/divide helpers, bit manipulation, TBB/TBH
 * jump tables, struct copies, recursion, varargs formatting) compiled for
 * the Cortex-M3 at -O2, -O0 and -Os (firmware/dist, built by
 * firmware/build.mjs) must leave in RAM exactly the report text and checksum
 * that the same source prints when compiled for and run on the HOST CPU.
 *
 * The host result is committed (tests/fixtures/cpu/selftest-host.txt) so the
 * test runs without a toolchain; when a host C compiler is available the
 * reference is rebuilt from source and checked against the committed copy,
 * so neither side can drift silently. After changing selftest.c, rebuild the
 * firmware (node firmware/build.mjs cpu-selftest cpu-bench) and regenerate
 * the reference:
 *
 *   clang -O2 -std=c11 -I firmware/common/lib -I firmware/projects/cpu-selftest \
 *     firmware/projects/cpu-selftest/host_main.c firmware/projects/cpu-selftest/selftest.c \
 *     firmware/common/lib/mini_printf.c -o selftest && ./selftest > tests/fixtures/cpu/selftest-host.txt
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES, FW_DIST, hex, loadElfFile, makeMachine } from './harness'

const ROOT = path.resolve(FW_DIST, '..', '..')
const HOST_FIXTURE = path.join(FIXTURES, 'selftest-host.txt')

/** "checksum xxxxxxxx\n<report>" → { checksum, text } */
function parseHost(out: string): { checksum: number; text: string } {
  const s = out.replace(/\r\n/g, '\n')
  const nl = s.indexOf('\n')
  const m = /^checksum ([0-9a-f]{8})$/.exec(s.slice(0, nl))
  if (!m) throw new Error(`unexpected host output: ${s.slice(0, 80)}`)
  return { checksum: parseInt(m[1], 16), text: s.slice(nl + 1) }
}

/** build and run the host reference with the C compiler on PATH ($CC or clang), or null */
function hostBuild(): string | null {
  const cc = process.env.CC || 'clang'
  if (spawnSync(cc, ['--version']).status !== 0) return null
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ohmlet-selftest-'))
  try {
    const exe = path.join(dir, process.platform === 'win32' ? 'selftest.exe' : 'selftest')
    const p = path.join(ROOT, 'firmware', 'projects', 'cpu-selftest')
    const lib = path.join(ROOT, 'firmware', 'common', 'lib')
    const c = spawnSync(cc, ['-O2', '-std=c11', '-I', lib, '-I', p, path.join(p, 'host_main.c'), path.join(p, 'selftest.c'), path.join(lib, 'mini_printf.c'), '-o', exe], {
      encoding: 'utf8',
    })
    if (c.status !== 0) {
      // a compiler that cannot build host executables (no C library / linker) is an environment issue
      console.warn(`cpu-selftest: host build with ${cc} failed, using the committed reference:\n${c.stderr}`)
      return null
    }
    const r = spawnSync(exe, [], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`host run failed: ${r.stderr}`)
    return r.stdout
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const host = parseHost(readFileSync(HOST_FIXTURE, 'utf8'))
const hostOut = hostBuild()

describe('cpu-selftest: simulated Cortex-M3 vs host CPU', () => {
  it('the committed host reference is what the host build prints', () => {
    expect(host.text).toMatch(/^crc [0-9a-f]{8} [0-9a-f]{8}\n/)
    expect(host.text).toMatch(/\nsum [0-9a-f]{8}\n$/)
    if (hostOut === null) {
      console.log('cpu-selftest: no host C compiler found (set CC); using the committed host reference')
      return
    }
    expect(parseHost(hostOut)).toEqual(host)
  })

  for (const variant of ['', '-O0', '-Os']) {
    it(`cpu-selftest${variant || ' (-O2)'}: same checksum and report text`, () => {
      const m = makeMachine(loadElfFile(path.join(FW_DIST, `cpu-selftest${variant}.elf`)))
      expect(m.runToStop(500_000_000)).toBe('breakpoint')
      // halted on the program's own BKPT #0x42 with nothing else logged (no fault, no UNPREDICTABLE)
      expect(m.logs.map((l) => l.message)).toEqual([expect.stringMatching(/^BKPT #66 at /)])
      expect(hex(m.r32(m.sym('selftest_done')))).toBe(hex(0x600df00d))
      const textAddr = m.sym('selftest_text')
      let text = ''
      for (let a = textAddr; ; a++) {
        const ch = m.bus.read8(a)
        if (ch === 0) break
        text += String.fromCharCode(ch)
      }
      expect(text).toBe(host.text)
      expect(hex(m.r32(m.sym('selftest_checksum')))).toBe(hex(host.checksum))
      console.log(`cpu-selftest${variant}: ${m.core.instructions} instructions, ${m.clock.cycles} cycles, checksum ${hex(host.checksum)}`)
    })
  }
})

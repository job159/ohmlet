/**
 * Builds the Cortex-M3 instruction-set / exception test programs.
 *
 *   node firmware/tests/isa/build.mjs            # every *.s in this directory
 *   node firmware/tests/isa/build.mjs alu mem    # selected programs
 *
 * Each firmware/tests/isa/<name>.s (which includes common.inc) is assembled
 * with the LLVM integrated assembler and linked with link.ld into
 *
 *   tests/fixtures/cpu/<name>.elf      the program (committed)
 *   tests/fixtures/cpu/<name>.bin      raw flash image
 *   tests/fixtures/cpu/<name>.objdump  `llvm-objdump -d` listing — the
 *                                      reference for the disassembler test
 *
 * so the vitest suites run without a toolchain. Toolchain: LLVM clang +
 * ld.lld + llvm-objcopy + llvm-objdump, found via $OHMLET_CLANG_DIR or PATH.
 *
 * encodings.s is not a program but a generated sample of the Thumb encoding
 * space for the disassembler test: regenerate it with gen-encodings.mjs.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../../../tests/fixtures/cpu')
const EXE = process.platform === 'win32' ? '.exe' : ''
const tool = (name) => (process.env.OHMLET_CLANG_DIR ? path.join(process.env.OHMLET_CLANG_DIR, name + EXE) : name)

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 })
  } catch (e) {
    throw new Error(`${path.basename(cmd)} failed:\n${e.stdout ?? ''}${e.stderr ?? e.message}`)
  }
}

function build(name) {
  const tmp = path.join(os.tmpdir(), `ohmlet-isa-${process.pid}`)
  mkdirSync(tmp, { recursive: true })
  const obj = path.join(tmp, `${name}.o`)
  const elf = path.join(OUT, `${name}.elf`)
  run(tool('clang'), ['--target=thumbv7m-none-eabi', '-mcpu=cortex-m3', '-mthumb', '-c', '-I', HERE, path.join(HERE, `${name}.s`), '-o', obj])
  run(tool('ld.lld'), ['-n', '-T', path.join(HERE, 'link.ld'), '-o', elf, obj])
  run(tool('llvm-objcopy'), ['-O', 'binary', elf, path.join(OUT, `${name}.bin`)])
  // listing of the code sections only (the .cases/.casestr data would disassemble as junk)
  const dis = run(tool('llvm-objdump'), ['-d', '--triple=thumbv7m', '--no-show-raw-insn', '-j', '.text', elf])
  // drop the "<path>: file format" header line so the listing is machine independent
  writeFileSync(path.join(OUT, `${name}.objdump`), dis.replace(/\r\n/g, '\n').replace(/^.*file format.*\n/m, ''))
  rmSync(tmp, { recursive: true, force: true })
}

const want = process.argv.slice(2)
const all = readdirSync(HERE)
  .filter((f) => f.endsWith('.s'))
  .map((f) => f.slice(0, -2))
  .sort()
mkdirSync(OUT, { recursive: true })
let failed = 0
for (const n of want.length ? want : all) {
  try {
    build(n)
    console.log(`ok   ${n}`)
  } catch (e) {
    failed++
    console.error(`FAIL ${n}\n${e.message}`)
  }
}
if (failed) process.exit(1)

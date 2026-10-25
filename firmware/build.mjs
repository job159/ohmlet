/**
 * Firmware build system for the STM32F103 test & example firmware.
 *
 *   node firmware/build.mjs                 # build every project
 *   node firmware/build.mjs hal-blink ...   # build selected projects
 *   node firmware/build.mjs --list
 *
 * Toolchain: LLVM clang (target thumbv7m-none-eabi) + ld.lld + llvm-objcopy.
 * Found via $OHMLET_CLANG_DIR, else PATH. No arm-none-eabi-gcc needed.
 * HAL projects need the vendor sources: node firmware/scripts/fetch-vendor.mjs
 *
 * Each project is firmware/projects/<name>/project.json:
 *   {
 *     "kind": "bare" | "hal",          // bare = CMSIS register headers only
 *     "sources": ["main.c", ...],       // relative to the project dir
 *     "hal": ["gpio", "rcc", ...],      // HAL modules (hal projects; cortex+rcc+gpio always added)
 *     "defines": ["FOO=1"],
 *     "opt": "-O2",                      // optional, default -O2
 *     "variants": ["-O0", "-Os"],       // optional extra builds: <name>-O0.elf …
 *     "description": "…",               // one line, shown by --list and the examples UI
 *     "expect": "…",                    // observable behavior, prose (frozen once tests rely on it)
 *     "checks": { … }                    // machine-checkable contract (schema: firmware/README.md
 *                                       // "The expect contract"); copied into dist/manifest.json
 *     "freertos": { "port": "GCC/ARM_CM3", "heap": 4 }
 *                                       // optional: link the FreeRTOS kernel (vendor/freertos_kernel)
 *   }
 * Compiler warnings are printed even when a build succeeds.
 *
 * Outputs (committed so tests/examples work without a toolchain):
 *   firmware/dist/<name>.elf  .bin  .hex  .map
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FW = path.dirname(fileURLToPath(import.meta.url))
const PROJECTS = path.join(FW, 'projects')
const DIST = path.join(FW, 'dist')
const BUILD = path.join(FW, 'build')
const VENDOR = path.join(FW, 'vendor')
const COMMON = path.join(FW, 'common')
const EXE = process.platform === 'win32' ? '.exe' : ''

function tool(name) {
  const dir = process.env.OHMLET_CLANG_DIR
  if (dir) return path.join(dir, name + EXE)
  return name
}

const TARGET = ['--target=thumbv7m-none-eabi', '-mcpu=cortex-m3', '-mthumb', '-mfloat-abi=soft']
const CFLAGS = [
  ...TARGET,
  '-std=gnu11',
  '-g',
  '-ffunction-sections',
  '-fdata-sections',
  '-ffreestanding',
  '-fno-common',
  '-Wall',
  '-Wno-unused-function',
  '-DSTM32F103xB',
]

/** HAL modules every HAL project links (what CubeMX always generates). */
const HAL_ALWAYS = ['', 'cortex', 'rcc', 'rcc_ex', 'gpio', 'gpio_ex', 'dma', 'exti', 'flash', 'flash_ex', 'pwr']
/** extra sources a HAL module needs */
const HAL_EXTRA = { tim: ['tim_ex'], uart: [], i2c: [], spi: [], adc: ['adc_ex'], iwdg: [], wwdg: [], crc: [], rtc: ['rtc_ex'] }

function run(cmd, args, cwd) {
  try {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
    if (r.error) throw r.error
    if (r.status !== 0) throw Object.assign(new Error(`exit ${r.status}`), { stdout: r.stdout, stderr: r.stderr })
    if (r.stderr && r.stderr.trim()) process.stderr.write(r.stderr)
    return r.stdout
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    throw new Error(`${path.basename(cmd)} failed:\n${out || e.message}`)
  }
}

function listProjects() {
  if (!existsSync(PROJECTS)) return []
  return readdirSync(PROJECTS)
    .filter((d) => existsSync(path.join(PROJECTS, d, 'project.json')))
    .sort()
}

function readProject(name) {
  const dir = path.join(PROJECTS, name)
  const p = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8'))
  if (p.kind !== 'bare' && p.kind !== 'hal') throw new Error(`${name}: kind must be "bare" or "hal"`)
  if (!Array.isArray(p.sources) || p.sources.length === 0) throw new Error(`${name}: sources[] required`)
  return { ...p, name, dir }
}

function halSources(mods) {
  const hal = path.join(VENDOR, 'stm32f1xx_hal_driver', 'Src')
  const want = new Set(HAL_ALWAYS)
  for (const m of mods ?? []) {
    want.add(m)
    for (const x of HAL_EXTRA[m] ?? []) want.add(x)
  }
  return [...want].map((m) => path.join(hal, m ? `stm32f1xx_hal_${m}.c` : 'stm32f1xx_hal.c'))
}

/**
 * project.json "freertos": { "port": "GCC/ARM_CM3", "heap": 4 } — link the
 * FreeRTOS kernel (vendor/freertos_kernel, fetched by fetch-vendor.mjs): the
 * kernel sources, the port and one heap_<n>.c. The project directory supplies
 * FreeRTOSConfig.h (it is first on the include path).
 */
const FREERTOS = path.join(VENDOR, 'freertos_kernel')
const FREERTOS_KERNEL = ['list', 'queue', 'tasks', 'timers', 'event_groups', 'stream_buffer']

function freertosOf(p) {
  if (!p.freertos) return null
  const port = p.freertos.port ?? 'GCC/ARM_CM3'
  const heap = p.freertos.heap ?? 4
  if (!/^[A-Za-z0-9_]+\/[A-Za-z0-9_]+$/.test(port)) throw new Error(`${p.name}: freertos.port must look like "GCC/ARM_CM3"`)
  if (![1, 2, 3, 4, 5].includes(heap)) throw new Error(`${p.name}: freertos.heap must be 1..5`)
  return { portDir: path.join(FREERTOS, 'portable', ...port.split('/')), heap }
}

function freertosSources(p) {
  const f = freertosOf(p)
  if (!f) return []
  if (!existsSync(path.join(FREERTOS, 'tasks.c')))
    throw new Error('FreeRTOS kernel sources missing: run `node firmware/scripts/fetch-vendor.mjs`')
  return [
    ...FREERTOS_KERNEL.map((m) => path.join(FREERTOS, `${m}.c`)),
    path.join(f.portDir, 'port.c'),
    path.join(FREERTOS, 'portable', 'MemMang', `heap_${f.heap}.c`),
  ]
}

function includeDirs(p) {
  const inc = [p.dir, path.join(COMMON, 'lib'), path.join(VENDOR, 'cmsis_device_f1', 'Include'), path.join(VENDOR, 'cmsis_core', 'Include')]
  const rtos = freertosOf(p)
  if (rtos) inc.push(path.join(FREERTOS, 'include'), rtos.portDir)
  if (p.kind === 'hal') inc.push(path.join(COMMON, 'hal'), path.join(VENDOR, 'stm32f1xx_hal_driver', 'Inc'))
  return inc.map((d) => `-I${d}`)
}

function buildOne(p, opt, outName) {
  const work = path.join(BUILD, outName)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  mkdirSync(DIST, { recursive: true })

  const sources = p.sources.map((s) => path.join(p.dir, s))
  sources.push(path.join(COMMON, 'lib', 'runtime.c'), path.join(COMMON, 'lib', 'mini_printf.c'))
  let linkScript
  if (p.kind === 'bare') {
    sources.push(path.join(COMMON, 'bare', 'startup.c'))
    linkScript = path.join(COMMON, 'bare', 'link.ld')
  } else {
    if (!existsSync(path.join(VENDOR, 'stm32f1xx_hal_driver')))
      throw new Error('HAL vendor sources missing: run `node firmware/scripts/fetch-vendor.mjs`')
    sources.push(...halSources(p.hal))
    sources.push(path.join(VENDOR, 'cmsis_device_f1', 'Source', 'Templates', 'system_stm32f1xx.c'))
    sources.push(path.join(VENDOR, 'cmsis_device_f1', 'Source', 'Templates', 'gcc', 'startup_stm32f103xb.s'))
    sources.push(path.join(COMMON, 'hal', 'hal_runtime.c'))
    linkScript = path.join(COMMON, 'hal', 'STM32F103C8TX_FLASH.ld')
  }
  sources.push(...freertosSources(p))

  const defs = (p.defines ?? []).map((d) => `-D${d}`)
  if (p.kind === 'hal') defs.push('-DUSE_HAL_DRIVER')
  const objs = []
  sources.forEach((src, i) => {
    const obj = path.join(work, `${i.toString().padStart(2, '0')}_${path.basename(src).replace(/\.[cs]$/, '')}.o`)
    const isAsm = src.endsWith('.s')
    const args = isAsm
      ? [...TARGET, '-g', '-c', src, '-o', obj]
      : [...CFLAGS, opt, ...defs, ...includeDirs(p), '-c', src, '-o', obj]
    run(tool('clang'), args, p.dir)
    objs.push(obj)
  })

  const elf = path.join(DIST, `${outName}.elf`)
  run(tool('ld.lld'), ['-T', linkScript, '--gc-sections', `-Map=${path.join(DIST, outName + '.map')}`, '-o', elf, ...objs], p.dir)
  run(tool('llvm-objcopy'), ['-O', 'binary', elf, path.join(DIST, `${outName}.bin`)], p.dir)
  run(tool('llvm-objcopy'), ['-O', 'ihex', elf, path.join(DIST, `${outName}.hex`)], p.dir)
  const size = run(tool('llvm-size'), [elf], p.dir).trim().split('\n').pop()
  return { elf, size }
}

function main() {
  const args = process.argv.slice(2)
  const all = listProjects()
  if (args.includes('--list')) {
    for (const n of all) {
      const p = readProject(n)
      console.log(`${n.padEnd(28)} ${p.kind.padEnd(5)} ${p.description ?? ''}`)
    }
    return
  }
  const names = args.length ? args : all
  let failed = 0
  for (const n of names) {
    if (!all.includes(n)) {
      console.error(`unknown project: ${n}`)
      failed++
      continue
    }
    const p = readProject(n)
    const builds = [[p.opt ?? '-O2', n], ...(p.variants ?? []).map((o) => [o, `${n}${o}`])]
    for (const [opt, out] of builds) {
      try {
        const { size } = buildOne(p, opt, out)
        console.log(`ok   ${out.padEnd(32)} ${size}`)
      } catch (e) {
        failed++
        console.error(`FAIL ${out}\n${e.message}`)
      }
    }
  }
  // manifest for the UI / tests: name → description/expect
  const manifest = {}
  for (const n of all) {
    const p = readProject(n)
    manifest[n] = { kind: p.kind, description: p.description ?? '', expect: p.expect ?? '', ...(p.checks ? { checks: p.checks } : {}) }
  }
  mkdirSync(DIST, { recursive: true })
  writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  if (failed) process.exit(1)
}

main()

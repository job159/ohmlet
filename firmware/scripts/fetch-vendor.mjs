/**
 * Fetch the third-party STM32 sources used to build the HAL-based test and
 * example firmware into firmware/vendor/ (gitignored). Pinned tags, shallow
 * clones. Licenses: stm32f1xx_hal_driver = BSD-3-Clause, cmsis_device_f1 =
 * Apache-2.0, cmsis_core = Apache-2.0, freertos_kernel = MIT — all
 * compatible with this MIT project.
 * Nothing here is needed at runtime; prebuilt ELFs are committed under
 * firmware/dist/ so tests and examples work without a toolchain.
 *
 *   node firmware/scripts/fetch-vendor.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VENDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor')

export const VENDOR_REPOS = [
  { dir: 'stm32f1xx_hal_driver', url: 'https://github.com/STMicroelectronics/stm32f1xx_hal_driver.git', tag: 'v1.1.9' },
  { dir: 'cmsis_device_f1', url: 'https://github.com/STMicroelectronics/cmsis_device_f1.git', tag: 'v4.3.5' },
  { dir: 'cmsis_core', url: 'https://github.com/STMicroelectronics/cmsis_core.git', tag: 'v5.9.0_20250520', sparse: ['Include'] },
  // FreeRTOS kernel (MIT) for project.json "freertos" builds (lesson-a4-freertos):
  // kernel sources + include/ + the GCC/ARM_CM3 port + the heap_*.c allocators only
  {
    dir: 'freertos_kernel',
    url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel.git',
    tag: 'V11.1.0',
    sparse: ['/*.c', '/include/', '/portable/GCC/ARM_CM3/', '/portable/MemMang/', '/LICENSE.md'],
    noCone: true,
  },
]

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
}

export function fetchVendor() {
  mkdirSync(VENDOR, { recursive: true })
  for (const r of VENDOR_REPOS) {
    const dest = path.join(VENDOR, r.dir)
    if (existsSync(path.join(dest, '.git'))) {
      console.log(`vendor/${r.dir}: present`)
      continue
    }
    console.log(`vendor/${r.dir}: cloning ${r.url} @ ${r.tag}`)
    if (r.sparse) {
      git(['clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', r.tag, r.url, dest])
      git(['sparse-checkout', 'set', ...(r.noCone ? ['--no-cone'] : []), ...r.sparse], dest)
    } else {
      git(['clone', '-q', '--depth', '1', '--branch', r.tag, r.url, dest])
    }
  }
  return VENDOR
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) fetchVendor()

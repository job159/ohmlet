# ohmlet firmware

> **使用者摘要（繁體中文）**
>
> 這個資料夾收錄模擬器內建的 STM32F103C8「Blue Pill」測試與範例韌體。每個映像檔都是真正的 Cortex-M3 機器碼：模擬器載入 ELF 後，逐條指令在 STM32F103 周邊模型上執行，沒有任何預先錄好的行為。
>
> - **直接使用**：在開發板的「屬性」面板 → 韌體，選擇範例專案或拖入 `dist/` 中的 `.elf`，按「執行」即可。`.elf` / `.hex` 自帶位址；`.bin` 必須燒錄在 **0x08000000**。
> - **使用自己的 STM32CubeIDE 專案**：選擇 STM32F103C8Tx、SYS → Debug 設為 Serial Wire、時脈 72 MHz（HSE 8 MHz × PLL 9），建置後把 `Debug/<專案>.elf` 拖入「載入韌體」即可（詳見下方〈Using your own STM32CubeIDE project〉）。
> - **範例分類**：GPIO 與按鍵（`bare-*`、`hal-blink`、`hal-button-exti`、`hal-gpio-modes`、`hal-traffic-light`）、UART（`hal-uart-hello`、`hal-uart-dma`）、計時器與 PWM（`hal-tim-*`、`hal-pwm-fade`、`hal-servo`）、ADC 與 DMA（`hal-adc-*`、`hal-dma-m2m`）、I²C 與 SPI（`hal-i2c-*`、`hal-spi-*`），以及各種感測器、顯示器與模組範例。
> - **行為契約**：每個專案的 `project.json` 以 `expect`（文字）與 `checks`（可自動驗證的規則）描述韌體在模擬中應有的腳位、UART 輸出與時序；測試會在模擬的開發板與真實電路（含 AT24C02、74HC595、跳線等）上逐條驗證。
> - **注意**：`HAL_Delay(n)` 實際等待 n + 1 個 tick；不支援半主機（semihosting）`printf`；USB、CAN 與系統記憶體開機載入程式未模擬，存取時會記錄於模擬日誌。
>
> 以下為開發者文件（英文）。

Test and example firmware for the simulated STM32F103C8 "Blue Pill". Every
image here is real Cortex-M3 machine code: the simulator loads the ELF and
executes it instruction by instruction against its STM32F103 peripheral
models. Nothing in this directory is used at run time except the prebuilt
images in `dist/`, which are committed so tests, examples and lessons work
without a toolchain.

```
firmware/
  build.mjs              build system (node, no dependencies)
  scripts/fetch-vendor.mjs  fetches ST HAL + CMSIS into vendor/ (gitignored)
  common/
    bare/                startup.c (vector table, .data/.bss init) + link.ld
    hal/                 stm32f1xx_hal_conf.h, STM32F103C8TX_FLASH.ld,
                         hal_runtime.c (__libc_init_array for ST's startup)
    lib/                 runtime.c (mem*, 64-bit division), mini_printf.[ch]
  projects/<name>/       one directory per firmware: project.json + sources
  dist/                  <name>.elf .bin .hex (committed), .map (ignored),
                         manifest.json (name → kind / description / expect)
  build/                 object files (ignored)
  vendor/                ST sources (ignored, see below)
```

## Toolchain

The build uses LLVM only — there is no `arm-none-eabi-gcc` dependency:

| tool | used for |
|---|---|
| `clang --target=thumbv7m-none-eabi -mcpu=cortex-m3 -mthumb -mfloat-abi=soft` | C and `.s` (integrated assembler; ST's GCC-syntax startup file assembles unchanged) |
| `ld.lld` | linking with the CubeIDE-style linker script, `--gc-sections` |
| `llvm-objcopy` | `.bin` and `.hex` |
| `llvm-size`, `llvm-nm`, `llvm-objdump -d --triple=thumbv7m`, `llvm-readelf` | inspection |

Any LLVM ≥ 17 with the ARM backend works (development used LLVM-MinGW
clang 21). The tools are taken from `$OHMLET_CLANG_DIR` if set, otherwise
from `PATH`.

Flags (see `build.mjs`): `-std=gnu11 -g -ffunction-sections -fdata-sections
-ffreestanding -fno-common -Wall -DSTM32F103xB`, `-O2` unless the project
says otherwise, plus `-DUSE_HAL_DRIVER` for HAL projects. There is no libc:
`common/lib/runtime.c` provides the `mem*` functions clang may call and the
EABI 64-bit division helpers (32-bit division uses the M3's `UDIV`/`SDIV`),
and `common/hal/hal_runtime.c` provides the `__libc_init_array()` that ST's
startup calls before `main()`. Headers such as `<string.h>`/`<stdio.h>` are
therefore not available; use `mini_printf.h`.

## Vendor sources

HAL projects compile ST's sources, fetched at pinned tags into
`firmware/vendor/` (gitignored):

```
node firmware/scripts/fetch-vendor.mjs
```

| directory | repository | tag | license |
|---|---|---|---|
| `stm32f1xx_hal_driver` | STMicroelectronics/stm32f1xx_hal_driver | v1.1.9 | BSD-3-Clause |
| `cmsis_device_f1` | STMicroelectronics/cmsis_device_f1 | v4.3.5 | Apache-2.0 |
| `cmsis_core` | STMicroelectronics/cmsis_core (Include/ only) | v5.9.0_20250520 | Apache-2.0 |

HAL projects link ST's real `startup_stm32f103xb.s` (GCC version) and
`system_stm32f1xx.c`, exactly as an STM32CubeIDE project does.

## Building

```
node firmware/build.mjs                       # every project
node firmware/build.mjs hal-uart-hello ...    # selected projects
node firmware/build.mjs --list                # name, kind, description
```

Each build writes `dist/<name>.elf|.bin|.hex|.map` (plus `<name>-O0.elf`
etc. for `variants`) and regenerates `dist/manifest.json` from every
project's `project.json`. Commit the `.elf/.bin/.hex` of the projects you
changed.

### project.json

```jsonc
{
  "kind": "hal",                 // "bare" = CMSIS register headers only, "hal" = ST HAL
  "sources": ["main.c", "stm32f1xx_it.c", "stm32f1xx_hal_msp.c"],
  "hal": ["uart"],               // extra HAL modules; cortex, rcc, gpio, exti, dma, flash, pwr are always linked
  "defines": [],                 // optional -D…
  "opt": "-O2",                  // optional
  "variants": ["-O0"],           // optional extra builds <name>-O0.elf …
  "description": "…",            // one line, shown by --list and the examples UI
  "expect": "…",                 // the observable behavior in one precise paragraph
  "checks": { … }                // the same behavior, machine-checkable (below)
}
```

HAL projects are laid out like STM32CubeIDE output for a Blue Pill
(SYS → Debug: Serial Wire, RCC → HSE: crystal, 72 MHz clock tree):
`main.c` (`SystemClock_Config`, `MX_GPIO_Init`, `MX_USARTx_UART_Init`, user
code inside `USER CODE BEGIN/END` blocks), `main.h` (pin labels such as
`LED_Pin`/`LED_GPIO_Port`), `stm32f1xx_it.c/.h` (exception and IRQ handlers),
`stm32f1xx_hal_msp.c` (AFIO/PWR clocks, `NOJTAG` remap, peripheral pins and
NVIC). `stm32f1xx_hal_conf.h`, the linker script and the startup file are
shared from `common/` and `vendor/`.

## Projects

All HAL projects run at 72 MHz (HSE 8 MHz × PLL 9, AHB 72 MHz, APB1 36 MHz,
APB2 72 MHz, FLASH_LATENCY_2) with the HAL time base on SysTick at 1 kHz
(`LOAD` = 71999 after `HAL_RCC_ClockConfig`). USART1 is always PA9 TX
(AF push-pull) / PA10 RX (input with pull-up), 115200 8N1; at PCLK2 = 72 MHz
HAL writes `BRR` = 0x271 (USARTDIV 39.0625), so the rate is exactly 115200 Bd
and one frame lasts 86.806 µs. Text is sent with `mini_printf` →
`mini_putchar` → `HAL_UART_Transmit(&huart1, &c, 1, 10)` (blocking, one byte
per call, ≈ 89 µs per character).

"Flash" is the size of the `.bin` = everything programmed at 0x08000000
(vector table, code, read-only data, `.data` initializers).

| project | description | expect (summary; full text and `checks` in project.json) | flash |
|---|---|---|---|
| `bare-blink` | Register-level blink at 8 MHz HSI: SysTick 1 ms, PA5/PC13 toggle every 250 ms | PA5 and PC13 toggle every 250 ms (2 Hz), PC13 = !PA5 | 596 B |
| `bare-button` | Register-level button mirror at 8 MHz HSI, polled | idle PA0=1, PA5=0, PC13=1; every PA0 change (bounce included) mirrored within 5 µs: PA5 = !PA0, PC13 = PA0 (LED on while pressed) | 604 B |
| `hal-blink` | HAL blinky, `HAL_Delay(500)` toggles PA5 and PC13 | PA5 and PC13 square waves, PC13 = !PA5; edges are 501 ms apart (see HAL notes: `HAL_Delay(500)` waits 501 ticks) | 3100 B |
| `hal-button-exti` | PB12 EXTI falling (pull-up), 20 ms debounce, toggles PA5, `press N` on USART1 | press accepted 19–20 ms after its last falling edge if PB12 is still low → PA5 toggles, then `press N\r\n` (N = 1, 2, …); press bounce counts once, release bounce / pulses < 19 ms never; silent at boot | 7876 B |
| `hal-uart-hello` | banner, `tick N` every second, interrupt-driven line echo | `Hello from STM32F103!\r\n`; `tick N\r\n` every 1000 ms (± 20 µs, no drift); CR or LF ends a line → `echo: <line>\r\n`; empty lines ignored, 63-byte lines, 4-line queue | 9404 B |
| `hal-gpio-modes` | PB6/PB7 open-drain 10 Hz anti-phase; PA1 pull-up, PA2 pull-down, PA3 floating | PB6/PB7 toggle together every 50 ms (one BSRR write), PB7 = !PB6; `PA1=x PA2=y PA3=z\r\n` at boot and every 200 ms; unconnected PA1=1 PA2=0 | 7796 B |
| `hal-traffic-light` | PA3 green 3 s → PA2 yellow 1 s → PA1 red 3 s, PB0 pedestrian button | one-hot LEDs, 7000 ms cycle; `light=<GREEN, YELLOW or RED>\r\n` per change; a press accepted during green ends it at max(start + 1 s, now) → `light=YELLOW (walk)\r\n`; presses in yellow/red ignored | 8112 B |
| `hal-systick-timing` | PB13 toggled in `SysTick_Handler`, PB14 around `HAL_Delay(100)` | PB13 500 Hz (1.000 ms / 1.000 ms, ± 2 µs); PB14 edges 101 ms apart (± 5 µs), each ≤ 10 µs after a PB13 edge | 3092 B |
| `lab-acceptance` | first-release demo: PA5 2 Hz / 5 Hz / on / off by PB12, PC13 heartbeat | `boot ok\r\n` + `mode=0 blink 2 Hz\r\n`; PA5 250/250 ms → 100/100 → high → low per press (30 ms debounce) with `mode=<n> <description>\r\n`; PC13 low 50 ms every 1000 ms; all LED edges on SysTick ticks | 8408 B |
| `hal-tim-irq` | TIM4 update interrupt as a 1 kHz time base: PB12 toggles every 1 ms, PC13 heartbeat 1 Hz | PB12 1.000 / 1.000 ms (no drift, ± 0.2 µs latency jitter); PC13 500 / 500 ms, each edge < 2 µs after a PB12 edge; WFI between interrupts | 4532 B |
| `hal-tim-pwm` | PWM on three timers: TIM2 CH1 PA0, TIM3 CH1 PA6, TIM1 CH1 PA8 | PA0 1 kHz 250 / 750 µs, PA6 20 kHz 25 / 25 µs, PA8 2 kHz 375 / 125 µs (TIM1 only because HAL sets BDTR.MOE); edges on the 13.9 ns timer clock | 5496 B |
| `hal-pwm-fade` | LED on PA6 fades 0 → 100 → 0 % in 2 s (TIM3 CH1 1 kHz, CCR1 stepped in the update interrupt) | a period every 1.000 ms, high time = duty × 10 µs; duty 0 … 100 … 1 % in steps of exactly 10 periods, ramp repeats every 2.000 s | 5472 B |
| `hal-servo` | servo signal: TIM2 CH2 PA1 50 Hz, 1.0 → 2.0 → 1.0 ms in 0.1 ms steps every 200 ms | rising edge every 20.000 ms; width 1.0, 1.1 … 2.0, 1.9 … ms, each width in exactly 10 frames (preloaded CCR2); no UART | 4868 B |
| `hal-tim-capture` | PWM input: TIM3 CH1 PA6 generates 2 kHz / 30 %, 5 kHz / 50 %, 1.25 kHz / 75 % (1 s each), TIM2 CH1 PA0 measures it (jumper PA6 → PA0) | `PWM input: …\r\n`; every 250 ms (first at 125 ms) `f=2000 d=300` ×4, `f=5000 d=500` ×4, `f=1250 d=750` ×4, repeating; without the jumper `f=0 d=0` | 11980 B |
| `hal-tim-encoder` | TIM4 quadrature encoder on PB6 (A) / PB7 (B), pull-ups + input filter | `enc=0\r\n`, then `enc=<n>\r\n` on every change within 1 ms; A↓ B↓ A↑ B↑ → 1 2 3 4, the reverse order → −1 … −4; pulses < 3.6 µs ignored | 8372 B |
| `hal-uart-dma` | USART1 with DMA: TX on DMA1 ch4, RX on ch5 into a circular 32-byte ring with IDLE detection | `uart-dma ready\r\n`; each reception event echoes `<idle\|ht\|tc> <n>: <bytes>\r\n` (`hello` → `idle 5: hello`; 40 bytes → `ht 16`, `tc 16`, `idle 8`) | 10524 B |
| `hal-adc-pot` | ADC1 IN0 (PA0) single conversion every 100 ms after calibration | `adc=<raw> mv=<mV>\r\n`, raw = round(V / VDDA × 4095): 0 V → `adc=0 mv=0`, VDD → `adc=4095 mv=3300`, a potentiometer reads position × 4095 | 10112 B |
| `hal-adc-dma` | ADC1 continuous scan IN0–IN3 + temperature + VREFINT by DMA1 ch1 (circular) | 126 µs per scan; every 200 ms `in0=… in1=… in2=… in3=… ts=… vref=… vdda=<mV> temp=<C.d> seq=<n>\r\n` (25 °C, 3.3 V: ts=1775 vref=1489 vdda=3300 temp=25.0; seq +1587 per line) | 11168 B |
| `hal-dma-m2m` | DMA1 ch1 memory-to-memory copy of 1 KiB, verified and timed with DWT->CYCCNT | right after init and every 500 ms `m2m ok <cycles>\r\n` (256 words × 6 HCLK + HAL overhead, identical every round) | 9456 B |
| `hal-i2c-scan` | I2C1 bus scan (PB6 SCL / PB7 SDA, 100 kHz) on 0x08–0x77 | `I2C1 scan 0x08-0x77\r\n`, `found 0xNN\r\n` per device (AT24C02 → `found 0x50`), `scan done N\r\n`; without pull-ups `bus busy at 0x08 …` | 8760 B |
| `hal-i2c-eeprom` | I2C1 + AT24C02 (0x50): 16 bytes across two page boundaries with ACK polling, read back blocking (N = 16 / 1 / 2) and with interrupts | `AT24C02 test`, `before: <16 bytes>`, three `wrote … ready after P polls` (P ≈ 45: the 5 ms write cycle), `read 16 ok`, `read 1 ok`, `read 2 ok`, `read 16 (IT) ok`, `eeprom ok`; no EEPROM → `eeprom not found at 0x50` | 17392 B |
| `hal-spi-595` | SPI1 (PA5 SCK / PA7 MOSI, mode 0, 4.5 MHz) + PA4 RCLK driving a 74HC595: 8-LED chaser at 10 Hz | `74HC595 chaser 10 Hz\r\n`; every 100 ms RCLK low, one byte `1 << step` (8 SCK pulses, 111 ns half period), RCLK high: QA … QH light one at a time; PA4 low ≈ 5 µs per transfer | 8676 B |
| `hal-spi-loopback` | SPI1 full duplex with PA7 MOSI wired to PA6 MISO: mode 0, mode 3 LSB-first, 16-bit frames, hardware CRC | `SPI1 loopback (PA7 MOSI -> PA6 MISO)`, `mode 0: 64 bytes ok`, `mode 3 lsb: 64 bytes ok`, `16-bit: 32 words ok`, `crc: 64 bytes ok, crc 0x1E`, `spi loopback ok`; without the wire the first pass reports a mismatch | 10960 B |

Pin roles at a glance:

| project | outputs | inputs | UART |
|---|---|---|---|
| bare-blink | PA5, PC13 | — | — |
| bare-button | PA5, PC13 | PA0 (pull-up) | — |
| hal-blink | PA5, PC13 | — | — |
| hal-button-exti | PA5 | PB12 (pull-up, EXTI12 falling) | USART1 TX |
| hal-uart-hello | — | — | USART1 TX + RX interrupt |
| hal-gpio-modes | PB6, PB7 (open-drain) | PA1 (pull-up), PA2 (pull-down), PA3 (floating) | USART1 TX |
| hal-traffic-light | PA1 red, PA2 yellow, PA3 green | PB0 (pull-up, EXTI0 falling) | USART1 TX |
| hal-systick-timing | PB13, PB14 | — | — |
| lab-acceptance | PA5, PC13 | PB12 (pull-up, EXTI12 falling) | USART1 TX |
| hal-tim-irq | PB12, PC13 | — | — |
| hal-tim-pwm | PA0 (TIM2 CH1), PA6 (TIM3 CH1), PA8 (TIM1 CH1) — AF push-pull | — | — |
| hal-pwm-fade | PA6 (TIM3 CH1, AF push-pull) | — | — |
| hal-servo | PA1 (TIM2 CH2, AF push-pull) | — | — |
| hal-tim-capture | PA6 (TIM3 CH1, AF push-pull) | PA0 (TIM2 CH1 capture, floating; jumper from PA6) | USART1 TX |
| hal-tim-encoder | — | PB6 A, PB7 B (TIM4 encoder, pull-ups, filter 3.6 µs) | USART1 TX |
| hal-uart-dma | — | — | USART1 TX (DMA1 ch4) + RX (DMA1 ch5, circular, IDLE) |
| hal-adc-pot | — | PA0 (analog, ADC1 IN0) | USART1 TX |
| hal-adc-dma | — | PA0–PA3 (analog, ADC1 IN0–IN3) | USART1 TX |
| hal-dma-m2m | — | — | USART1 TX |
| hal-i2c-scan | PB6 SCL, PB7 SDA (I2C1, AF open-drain; 4.7 kΩ pull-ups) | SCL, SDA read back (bus) | USART1 TX |
| hal-i2c-eeprom | PB6 SCL, PB7 SDA (I2C1, AF open-drain; 4.7 kΩ pull-ups) | SCL, SDA read back (bus) | USART1 TX |
| hal-spi-595 | PA5 SCK, PA7 MOSI (SPI1, AF push-pull), PA4 RCLK (push-pull) | — | USART1 TX |
| hal-spi-loopback | PA5 SCK, PA7 MOSI (SPI1, AF push-pull) | PA6 MISO (floating; jumper from PA7) | USART1 TX |

The device-family examples (sensors, displays, communication and motor
modules: `hal-bme280`, `hal-oled-ssd1306`, `hal-hc05`, …) document their own
circuit in `project.json`; `node firmware/build.mjs --list` prints every
project with its one-line description.

The remaining images are simulator test fixtures rather than examples (no
`checks`; the unit tests drive them directly): `cpu-selftest` and
`cpu-bench` (core self-test / throughput workload ending in BKPT, used by the
Cortex-M3 verification and the CPU benchmark), and `soc-clock`, `soc-exti`,
`soc-iwdg`, `soc-uart` (HAL clock switching, EXTI, watchdog resets with
BKP_DR1 boot counting, UART echo — exercised by the SoC tests; `soc-common`
holds their shared startup code).

### Timing design rules used by these projects

- Periods are deadlines in HAL ticks (`next += period`), never "delay after
  the work", so printing cannot make a schedule drift.
- When a schedule must be exact in spite of blocking UART output, the
  work runs in the SysTick handler (`lab-acceptance`, `hal-systick-timing`)
  or the main loop is arranged so a line can never overlap a deadline
  (`hal-gpio-modes` toggles before it prints; `hal-traffic-light` prints only
  right after a phase change, and the shortest phase is 1 s).
- Buttons: the EXTI callback only timestamps the falling edge and restarts
  the debounce window; the press is accepted when HAL_GetTick() − edge
  reaches the window AND the pin still reads low. Because the edge can fall
  anywhere inside a 1 ms tick, acceptance happens window − 1 to window ms
  after the last falling edge (exactly window − 1 only when the edge and a
  SysTick interrupt coincide: EXTI has the higher priority and reads the old
  tick). The check runs with PRIMASK set so an edge cannot slip between
  reading the timestamp and clearing the flag.
- Several LEDs that must change together are written with one `BSRR` store
  (RM0008 §9.2.5): `HAL_GPIO_TogglePin(port, a | b)` or a direct `BSRR`
  write, never two `HAL_GPIO_WritePin` calls.

## The expect contract

`expect` is a one-paragraph, human-readable statement (it is what
`dist/manifest.json` and the examples UI show). `checks` states the same
behavior in a form a test runner can evaluate against the simulator's pin
and UART recorders. Times are milliseconds (fractions allowed) unless the
key ends in `Us`.

```jsonc
"checks": {
  "hclkHz": 72000000,          // core clock after init
  "settleMs": 150,             // static checks apply from this time after reset
  "t0": "settle" | "uart:USART1",
                               // scenario time origin: settleMs after reset, or the
                               // instant the port reports its FIRST transmitted byte
                               // (UartTap.onTx, i.e. when that byte's stop bit ends)
  "circuit": ["PB12: push-button to GND …"],   // what the checks assume is wired
  "pins": { "PA5": "output-pp" },
      // resolved PinDriveState after settle: analog | input-floating | input-pullup |
      // input-pulldown | output-pp | output-od | af-pp | af-od
  "uart": { "USART1": { "tx": "PA9", "rx": "PA10", "baud": 115200,
                        "dataBits": 8, "parity": "none", "stopBits": 1 } },
      // UartLineConfig the firmware programs
  "boot": { "USART1": "exact text" | { "match": "regex" } },
      // the first bytes the port transmits after reset ("" = nothing until stimulated)
  "idle": { "PA5": 0 },        // logic level held from settle on while nothing is driven
  "signals": [ … ],            // free-running behavior, below
  "scenarios": [ … ]           // stimulus → response, below
}
```

`circuit` is also what the checks runner WIRES on its bench
(`src/sim/coordinator/checks.ts` `checksLayout`): a Blue Pill (U1) at h10 on a
standard board, a 5 V bench supply into its 5V pin, its GND on the top − rail
and its 3V3 on the top + rail. Each line names header pins before the colon;
the runner understands these phrasings (case-insensitive) and builds the
parts from column 33 on:

| circuit line | what is placed |
|---|---|
| `PA5: LED + 220 ohm to GND` (`red`/`green`/`yellow`/`blue`/`white LED`, `k` suffix allowed) | series resistor + LED to GND per listed pin |
| `PB12: 10k ohm pull-up to 3V3` / `PA2: 10k ohm pull-down to GND` | a resistor per listed pin |
| `PB12: push-button to GND` | nothing: the scenario `drive`s act as the button (50 Ω stimulus) |
| `PB6, PB7: AT24C02 (A2-A0, WP to GND) + 4.7k pull-ups to 3V3` | an AT24C02 (U2 …) with SCL on the FIRST pin and SDA on the second, A2–A0 at GND (address 0x50), WP at GND (`WP to 3V3` / `WP high`: write-protected), VCC from 3V3; the pull-ups (both lines) only when named |
| `PA5, PA7, PA4: 74HC595 (SRCLK, SER, RCLK; SRCLR to 3V3, OE to GND), QA-QH: LED + 220 ohm to GND` | a 74HC595 with SRCLK, SER, RCLK on the three pins in that order, SRCLR at 3V3, OE at GND, VCC from 3V3; with the `QA-QH:` clause one resistor + LED per output (QA … QH = D1 … D8) |
| `PA6 -> PA0: jumper wire` | a wire between the two header strips |
| on-board LED, virtual terminal, unconnected / not connected, logic analyzer, scope, probe | nothing (informative) |
| an explicitly absent part: `CH340 module: not placed on this bench …`, `no BME280 on the bus …`, `no DHT22 on PB12 …`, `PB12: open (…)` | nothing — the line says the bench has no such part (the module itself is exercised by its device test) |

Each header pin has ONE free breadboard hole (the board body covers rows
b–i), so a pin can be wired by one line only. A line the runner does not
understand — or cannot place — is reported as `NOT wired` / `not wired` and
fails the contract's setup: a contract never silently runs on a bench that
differs from its `circuit`.

`signals` hold while no stimulus is applied; those marked `"always": true`
hold in every scenario too.

| signal | meaning |
|---|---|
| `{ "pin", "square": [highMs, lowMs], "tolUs", "firstEdge"?, "firstEdgeAt"? }` | after its first edge the pin alternates, every high phase lasting `highMs` and every low phase `lowMs` (± `tolUs`, edge to edge). `firstEdge` (0/1) and `firstEdgeAt` (window relative to t0) pin the phase where it is deterministic |
| `{ "pin", "invertOf" \| "sameAs": "P", "skewUs" }` | pin = !P (or P) except within `skewUs` after an edge of P |
| `{ "pin", "edgesAfter": "P", "maxLagUs" }` | every edge of pin follows an edge of P by ≤ `maxLagUs` |
| `{ "pins": [a, b, c], "oneHot": true }` | exactly one of the pins is high at every instant; the high one advances a → b → c → a, both edges of a change at the same instant |
| `{ "uart", "lines" \| "match", "nFrom"?, "firstAt", "everyMs", "tolUs", "afterEdgeOf"?, "lagMs"? }` | periodic lines after the boot text: `lines` is a template whose `{n}` counts from `nFrom`, `match` a regex for each whole line; the first such line's first byte is reported within `firstAt` (relative to t0), each next one `everyMs` later (± `tolUs`); with `afterEdgeOf`, each line's first byte comes `lagMs` after an edge of that pin |

Each scenario starts from reset; its `t0` is the project's `t0`.

```jsonc
{
  "name": "two clean presses",
  "durationMs": 400,            // observe [0, durationMs] after t0
  "drive": [                    // host stimulus, times relative to t0
    { "at": 0,   "pin": "PB12", "level": 0 },        // forced low (button closed to GND)
    { "at": 100, "pin": "PB12", "level": "open" },   // released: only the internal pull holds it
    { "at": 10,  "uart": "USART1", "text": "abc\r" } // bytes queued on UartTap.send at t
  ],
  "expect": [                   // each must happen, in its window
    { "id": "p1", "at": [19, 20.02], "pin": "PA5", "edge": 1 },   // PA5 rises inside the window
    { "from": "p1", "at": [0.08, 0.15], "uart": "press 1\r\n" },  // window relative to event p1
    { "at": [0, 900], "pin": "PA5", "level": 1 },                 // PA5 is 1 throughout the window
    { "at": [1, 450], "pin": "PA5", "every": 100 }                // edges inside the window are 100 ms apart (± the signal tolerance, 20 µs if none)
  ],
  "quiet": ["PA5", "USART1"]    // no edges / bytes on these besides the expected ones
                                // (the boot text is not counted)
}
```

A `uart` expectation is satisfied when the port transmits exactly that text
contiguously with the first byte reported inside the window. `from` makes a
window relative to the time of an earlier expectation (`id`): a pin
expectation's time is its edge, a uart expectation's time is its first
byte. Windows already include tick-phase uncertainty (an external event
lands anywhere inside a 1 ms tick) and a few microseconds of interrupt and
software latency; they assume nothing about exact instruction timing or
flash wait states.

## Using your own STM32CubeIDE project

1. In CubeMX (the `.ioc`), pick STM32F103C8Tx, set SYS → Debug to
   **Serial Wire**, RCC → HSE to **Crystal/Ceramic Resonator** and the clock
   tree to 72 MHz (HSE 8 MHz, PLL × 9), like a Blue Pill. HSI-only projects
   work too.
2. Build (Project → Build Project). The image is
   `<workspace>/<project>/Debug/<project>.elf` (or `Release/<project>.elf`).
3. In ohmlet, select the Blue Pill and open the MCU panel → Firmware, and
   drop the `.elf` (or use the file picker). The ELF carries its own load
   addresses and symbols, so prefer it.
4. `.hex` (Intel HEX) also carries addresses. `.bin` does not: it is
   programmed at the base address you enter, which must be **0x08000000**
   (start of main flash, RM0008 §3.3.3) for a normal CubeIDE image. To get a
   `.bin`/`.hex` from CubeIDE: Project Properties → C/C++ Build → Settings →
   MCU Post build outputs → "Convert to binary file (-O binary)" / "Convert
   to Intel Hex file (-O ihex)".

The core boots like silicon with BOOT0 = 0: SP and the reset vector are read
from 0x08000000. An image linked for a bootloader offset (for example the
STM32duino/Maple 0x08002000 layout) will not start, because no bootloader
is emulated. Only bytes whose load address lies in flash are programmed;
RAM is initialised by your startup code, as on hardware. Which peripherals
are modeled, partial or unsupported is listed in the MCU panel ("Verified" =
exercised by one of the firmware images in this directory); an unsupported
peripheral reads 0, ignores writes and logs every access instead of
pretending to work.

## HAL compatibility notes

- **Versions.** These images are built from STM32CubeF1 HAL v1.1.9 / CMSIS
  device F1 v4.3.5. The simulator does not link anything: it runs whatever
  machine code your ELF contains, so any CubeF1 HAL release, LL drivers or
  register-level code work the same way.
- **GCC vs clang.** CubeIDE compiles with arm-none-eabi-gcc and links
  newlib-nano (`syscalls.c`, `sysmem.c`); this directory uses clang and the
  tiny runtime in `common/lib/`. Both produce ordinary Thumb-2 code for the
  same startup file and linker script layout, but GCC picks different
  instruction sequences. No GCC is available in this build environment, so
  every image here is clang-built; an ELF from CubeIDE that misbehaves is
  exactly the kind of input worth reporting.
- **`HAL_Delay(n)` waits n + 1 ticks.** v1.1.9 adds `uwTickFreq` "to
  guarantee minimum wait" and spins while `HAL_GetTick() − start < n + 1`.
  A loop `toggle; HAL_Delay(500);` therefore toggles every **501 ms**
  (`hal-systick-timing` measures exactly this with `HAL_Delay(100)` → 101 ms).
  Use `HAL_GetTick()` deadlines when the period must be exact.
- **`printf`.** Retargeting through `_write()`/`__io_putchar()` to
  `HAL_UART_Transmit` works: the simulator only sees USART register writes.
  Semihosting (`initialise_monitor_handles`, `rdimon.specs`) does not: it
  executes `BKPT 0xAB` and waits for a debugger to service the call. With
  none attached the program never continues (silicon escalates to HardFault;
  the simulator halts the core on the BKPT).
  `printf("%f")` needs newlib's float support (`-u _printf_float`).
- **UART timeouts.** If a USART feature your code relies on is unsupported,
  blocking HAL calls end in `HAL_TIMEOUT`; note that HAL's
  `UART_WaitOnFlagUntilTimeout` also disables the RX interrupts and resets
  `RxState` on timeout, so a TX timeout silently stops an ongoing
  `HAL_UART_Receive_IT`.
- **USART RX pin.** CubeMX defaults USART RX to "no pull". These projects
  select Pull-up (RM0008 Table 24 allows input floating or input pull-up) so
  an unconnected RX idles at mark instead of floating into framing errors.
- **Debug pins.** "Serial Wire" generates `__HAL_AFIO_REMAP_SWJ_NOJTAG()`
  (frees PA15, PB3, PB4). "No Debug" generates `__HAL_AFIO_REMAP_SWJ_DISABLE()`,
  which on a real board locks the debugger out after the first run.
- **Clocks.** HAL waits for HSERDY / PLLRDY with timeouts
  (`HSE_STARTUP_TIMEOUT` 100 ms); a clock that never becomes ready ends in
  `Error_Handler()` exactly as on hardware.
- **Flash size.** CubeIDE's STM32F103C8 linker script declares 64 KiB
  (DS5319). Many C8 chips have 128 KiB of working flash; an image above
  64 KiB is outside the C8 datasheet even if a particular chip runs it, and
  the MCU model loads it with a warning (see `src/mcu/stm32f1/memory.ts`).
- **RTOS projects.** With FreeRTOS, CubeMX moves the HAL time base from
  SysTick to a timer (`TIMx_IRQHandler` calling `HAL_IncTick`); such a
  project runs only if that timer is supported by the MCU model.

## Adding a project

1. Create `projects/<name>/` with `project.json` and the sources (copy the
   closest existing project; HAL projects keep the CubeIDE file layout).
2. `node firmware/build.mjs <name>`; check the code with
   `llvm-objdump -d --triple=thumbv7m dist/<name>.elf` and the symbols /
   vector table with `llvm-nm -n dist/<name>.elf`.
3. Write `expect` and `checks` from the source and HAL behavior (count
   ticks, include HAL's +1 in `HAL_Delay`, include UART frame time
   86.806 µs at 115200 Bd), then commit `dist/<name>.elf/.bin/.hex` and the
   regenerated `dist/manifest.json`.

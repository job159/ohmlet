/**
 * "Fully Chinese" UI audit (zh-TW coverage gate for the live app).
 *
 *   node scripts/i18n-audit.mjs                 # all states
 *   I18N_ONLY=ws/ node scripts/i18n-audit.mjs   # only states whose name matches
 *
 * Drives a headless Chromium-family browser (VR_CHANNEL=msedge|chrome|bundled,
 * same as scripts/visual-regression.mjs) against a running dev / preview
 * server (I18N_URL, else VR_URL, default http://localhost:5173/) with
 * localStorage bb.lang = 'zh-TW', walks the app through many states —
 *
 *   classic chrome (desktop 1440×900; the zh-TW chrome without the
 *     workspace): onboarding, empty board, Blue Pill circuit, every dock
 *     sheet (Parts, Wire mode, Lessons, Instruments + its segments, More +
 *     About + Import + Clear confirm), the AI sheet (More → AI 電路助手), the
 *     shortcuts list ('?'), Properties of several parts,
 *     the long-press action sheet, a running simulation with issues, the
 *     legacy example circuits running, an LED without resistor, a shorted
 *     supply;
 *   desktop workspace (1440×900): library (every card's details expanded,
 *     Examples / Lessons tabs), Blue Pill selected (inspector: firmware,
 *     execution, peripherals, pinout, ERC panel with findings expanded),
 *     real firmware (firmware/dist/hal-uart-hello.elf) loaded through the
 *     inspector's file input and running, every tray tab (UART, Logic
 *     Analyzer with channels, Oscilloscope, Simulation Log), the inspector
 *     for several parts, the More / AI panels, the shortcuts list, a pin
 *     hover label;
 *   phone (390×844): onboarding, empty board, the lessons sheet and the
 *     first lesson's coach, home, Properties sheet, Instruments sheet
 *     segments, More, Parts —
 *
 * and after each step collects every VISIBLE text node plus the
 * aria-label / title / placeholder / alt / aria-valuetext / aria-description
 * attributes of visible elements (and document.title). Any word of 3+ Latin
 * letters that is not on the ALLOWLIST is a leak. Allowed: technical tokens
 * (pin names and part numbers taken live from the catalog, units, protocol /
 * peripheral names, STM32F103 / Cortex-M3 register and bit names (REGISTERS,
 * RM0008 / PM0056), hex, identifiers containing digits or underscores such as
 * USART1 / TIM2_CH1 / AT24C02 / 0x0800_0000, mixed-case identifiers with two
 * or more capitals such as IOPxEN / RxNE / BusFault, file names, firmware
 * project names, hole references like top+5, terminal references like
 * FG1:out) and a short list of proper names (ohmlet, Blue Pill, Cortex …).
 * ALL-CAPS words must be listed (so an English "WARNING" still leaks). The
 * modifier key names Ctrl, Shift, Alt, Esc and the Mac's Option stay as printed on the keycaps
 * (the onboarding's 「按住 Alt／Option 鍵」, round 5 drag-to-wire)
 * — the buttons' titles name their shortcut that way (H6 withKey: 「重置 MCU
 * （Shift+F5）」); words that are also English UI text (Delete…) still leak.
 * Data that is not UI text — UART bytes printed by the
 * firmware, core register names, firmware file names, keycaps — is skipped
 * by selector (SKIP_SELECTORS), and anything marked translate="no".
 *
 * Raw refs (UX helper H9 — SH-17): visible text / attributes that print an
 * internal reference instead of its name — 3V3_1 / GND2, U1.REG / U1.PA5,
 * PS1:+ / PS1:- (RAW_REF, the same pattern as tests/ux-shell-terms.test.ts)
 * — are collected separately (report.rawRefs, summary.rawRefStrings). They
 * do not change the exit code until the consumers have adopted pinLabel /
 * terminalLabel / endpointName: set I18N_RAWREF_STRICT=1 to fail on them.
 *
 * Small CJK text (H9 — SH-16 / N24: Chinese text is never under 12 px):
 * visible text nodes with CJK characters whose computed font size is below
 * 12 px are collected the same way (report.smallCjk, summary.smallCjkStrings,
 * with the size and the owning area); informational until every surface has
 * moved — I18N_SMALLCJK_STRICT=1 fails on them.
 *
 * Output: a JSON report (I18N_OUT, default <tmp>/ohmlet-i18n-audit/report.json)
 * listing each leaking string once with its words, where it was seen
 * (states), the element path and the best-guess owning file (AREAS), plus
 * per-state counts and any state the script could not reach. Exit code 1
 * when there are leaks (2 when the run itself failed).
 *
 * Use a server WITHOUT hot reload when other people are editing the tree: a
 * page reload mid-sequence invalidates the state machine (the script
 * reports it). Same browser approach and store access as scripts/ui-shots.mjs.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.I18N_URL ?? process.env.VR_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.VR_CHANNEL ?? 'msedge'
const OUT = process.env.I18N_OUT
  ? path.resolve(process.env.I18N_OUT)
  : path.join(os.tmpdir(), 'ohmlet-i18n-audit', 'report.json')
const ONLY = process.env.I18N_ONLY ? new RegExp(process.env.I18N_ONLY) : process.argv[2] ? new RegExp(process.argv[2]) : null
const FIRMWARE = path.join(ROOT, 'firmware', 'dist', 'hal-uart-hello.elf')
const VERBOSE = !!process.env.I18N_VERBOSE
/** fail on raw refs too (UX H9; off until the H1 / H2 consumers have landed) */
const RAWREF_STRICT = process.env.I18N_RAWREF_STRICT === '1'
/** fail on CJK text under 12 px too (UX H9 / SH-16) */
const SMALLCJK_STRICT = process.env.I18N_SMALLCJK_STRICT === '1'
/** the smallest font size for CJK text (px) */
const CJK_MIN_PX = 12
/** internal references printed as text (tests/ux-shell-terms.test.ts RAW_REF) */
const RAW_REF = /\b(3V3|GND)_\d\b|\bU\d+\.(REG|P[A-E]\d+)\b|\b[A-Z]+\d+:[+-]/

// ---------------------------------------------------------------------------
// What counts as a leak
// ---------------------------------------------------------------------------

/** Elements whose text is data, not UI copy. */
const SKIP_SELECTORS = [
  '[translate="no"]',
  'script',
  'style',
  'noscript',
  'template',
  'kbd', // keycaps (Space, Esc, Ctrl …)
  'code',
  '.emb-term-line', // UART bytes received from the firmware
  '.emb-reg-name', // core register names (r0 … xpsr, cfsr)
  '.emb-fw-name', // firmware file name
].join(',')

/** Attributes read from visible elements. */
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext', 'aria-description', 'aria-roledescription']

/** Removed before tokenising (technical strings that contain plain words). */
const STRIP = [
  /\bhttps?:\/\/\S+/g, // URLs
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, // e-mail addresses
  /(?:[\w-]+)?\.(?:ohmlet\.)?(?:json|elf|bin|hex|vcd|csv|ioc|ld|txt|md|map|png|svg|c|h|s)\b/gi, // file names / extensions
  /\b(?:\d+:)?(?:top|bot)[+\-−]\d*/g, // rail hole refs / rails (top+5, bot-12, 1:top-3, top−)
  /\b(?:hal|bare|soc|cpu|lab|lesson)(?:-[a-z0-9]+)+\b/g, // firmware project names (hal-uart-hello) in support notes
  /\b1-Wire\b/g, // the Maxim 1-Wire bus
  /\b[A-Za-z]+\d+:[\w+-]+/g, // off-board terminal references (FG1:out, PS1:+)
  /\bBlue Pill\b/g, // board name (the zh-TW label keeps it: 'STM32F103C8T6 Blue Pill 開發板')
  /\bthree\.js\b/gi,
]

/**
 * Technical tokens (case-sensitive). Tokens containing a digit or an
 * underscore are always allowed (pins PA5, part numbers AT24C02, registers
 * TIM2_CNT, peripherals USART1, hex 0x40010800); ALL-CAPS words must be
 * listed here or be a live catalog pin / function name (see dynamic list).
 */
const ALLOW = new Set(
  `
  UART USART SPI PWM ADC DAC DMA GPIO AFIO EXTI NVIC RCC FLASH PWR BKP CRC IWDG WWDG DBGMCU RTC USB CAN TIM
  JTAG SWD SWJ SWO SWDIO SWCLK NRST BOOT HSE HSI LSE LSI PLL MCO SYSCLK HCLK PCLK APB AHB SRAM ROM RAM CPU MCU
  LED LEDs RGB LCD OLED TFT HAL CMSIS ISR IRQ NMI SVC PendSV SysTick MSP PSP xPSR XPSR APSR IPSR EPSR PRIMASK
  BASEPRI FAULTMASK CFSR HFSR MMFAR BFAR SCB VTOR AIRCR ARM ARMv Thumb Cortex START STOP ACK NACK SDA SCL SCK
  MOSI MISO NSS CTS RTS VDD VCC VSS VEE GND VBAT VIN VOUT VIL VIH VOL VOH ESR LDO PCB DIP SOP SMD SPDT SPST LDR
  NTC BJT NPN PNP MOSFET JFET CMOS TTL BCD LSB MSB RMS EMF CdS VCD CSV JSON ELF BIN HEX API SDK IDE PNG SVG ERC
  SMBus SMBA EEPROM SIPO PISO OE STCP SHCP DS MR WP SRCLK RCLK SER SRCLR NPO COG NCV XTAL HSE LPF FIFO CRC DFU
  CubeIDE STM STMicroelectronics LQFP TQFP SOIC SOT DPAK TO MHz kHz GHz Hz mHz KiB MiB GiB kB MB bps kbps Mbps
  dB dBm mAh Wh mW ppm AWG DC AC USB PSU DMM LA GND VREF VREFINT TEMP CH OC IC ETR BKIN NSS SMBALERT ALERT
  MSPS ksps Msps sps ksa Msa RX TX SWJ_CFG JTDI JTDO NJTRST TRACESWO TAMPER WKUP OSC PVD AWU NJTRST LL RGB
  NAND AND NOR XOR XNOR Kbit kbit Mbit TRM NOJTAG POR PDR BOR SoC CPOL CPHA
  NEMA LIN UID ARP CSS EVENTOUT Vin Vout Vth Vcc Vdd
  Ctrl Shift Alt Esc Option
  `
    .split(/\s+/)
    .filter(Boolean),
)

/**
 * STM32F103 register and bit names (RM0008 register maps), Cortex-M3 system
 * registers / fault-status bits (PM0056 §4) and Thumb-2 mnemonics that log
 * messages and support notes keep verbatim (names with a digit, such as
 * CR1 / CCMR2 / APB2ENR, are allowed anyway).
 */
const REGISTERS = new Set(
  `
  CRL CRH IDR ODR BSRR BRR LCKR LCKK CNF MAPR EVCR EXTICR EVOE IMR EMR RTSR FTSR SWIER PR CFGR CIR AHBENR
  AHBRSTR BDCR CSR ACR KEYR OPTKEYR OBR WRPR SMCR DIER EGR CCER CNT PSC ARR RCR CCR CCRx BDTR DCR DMAR GTPR
  OAR TRISE CRCPR RXCRCR TXCRCR SMPR JOFRx JOFRk HTR LTR SQR JSQR JDRx JDRk CNDTR CNDTRx CPAR CPARx CMAR CMARx
  ISR IFCR KR RLR CFR RTCCR IDCODE CPUID ICSR AIRCR SCR SHCSR SHPRn CFSR HFSR DFSR MMFAR BFAR AFSR MMFSR BFSR
  UFSR ACTLR ICTR DHCSR DEMCR CTRL LOAD VAL CALIB ISER ICER ISPR ICPR IABR IPR STIR DWT CYCCNT CYCCNTENA ITM
  TPIU ETM FPB BKPT VECTKEY SYSRESETREQ VECTRESET VECTCLRACTIVE PRIGROUP SLEEPDEEP SLEEPONEXIT SEVONPEND
  STKALIGN BFHFNMIGN DIVBYZERO UNALIGNED NOCP INVPC INVSTATE UNDEFINSTR IACCVIOL DACCVIOL MSTKERR MUNSTKERR
  STKERR UNSTKERR IBUSERR PRECISERR IMPRECISERR FORCED VECTTBL MEMFAULTENA BUSFAULTENA USGFAULTENA SPSEL
  COUNTFLAG CLKSOURCE TICKINT TENMS LOCKUP UNPREDICTABLE RAZ WFI WFE SEV EXC_RETURN
  GPIOA GPIOB GPIOC GPIOD GPIOE MODE PIN SFT LPWR DBA DBL VDDA VSSA CCO ASOE
  HSEON HSERDY HSEBYP HSION HSIRDY HSITRIM CSSON PLLON PLLRDY PLLSRC PLLXTPRE PLLMUL USBPRE SWS HPRE PPRE
  ADCPRE MCO LSION LSIRDY LSEON LSERDY RTCSEL RTCEN BDRST RMVF PINRSTF PORRSTF SFTRSTF IWDGRSTF WWDGRSTF
  LPWRRSTF CSSF IOPAEN AFIOEN BKPEN PWREN SRAMEN FLITFEN DBP EWUP PDDS LPDS CWUF CSBF PVDE PVDO PLS WUF SBF
  LATENCY HLFCYA PRFTBE PRFTBS PER MER OPTPG OPTER OPTWRE STRT LOCK EOP EOPIE ERRIE WRPRTERR PGERR BSY RDPRT
  CEN UDIS URS OPM DIR CMS ARPE CKD CCPC CCUS CCDS MMS TIxS SMS TRGI ETF ETPS ECE ETP UIE TIE BIE COMIE UDE
  TDE COMDE UIF TIF BIF COMIF UG TG BG COMG OCxM OCxPE OCxFE OCxCE CCxS ICxPSC ICxF CCxE CCxP CCxNE CCxNP
  CCxOF MOE AOE BKE BKP OSSR OSSI DTG OISx TRGO TRGI TRC ITR ITRx ETR ETRF OCxREF TIMx TIMXCLK TIMx_CCx
  UE TE RE RWU SBK TXE RXNE TC IDLE ORE NE FE PE LBD CTS TXEIE RXNEIE TCIE IDLEIE PEIE PCE PS WAKE LINEN
  CLKEN CPOL CPHA LBCL STOP HDSEL IREN IRLP SCEN NACK DMAT DMAR CTSE CTSIE RTSE USARTDIV
  SPE MSTR BR SSM SSI LSBFIRST DFF CRCEN CRCNEXT BIDIMODE BIDIOE RXONLY SSOE TXDMAEN RXDMAEN MODF OVR UDR
  CRCERR CHSIDE SWRST ENGC NOSTRETCH SMBUS SMBTYPE ENARP ENPEC ITERREN ITEVTEN ITBUFEN DMAEN LAST FREQ SB
  ADDR BTF ADD10 STOPF BERR ARLO AF PECERR TIMEOUT SMBALERT MSL BUSY TRA GENCALL DUALF ADDMODE DUTY POS PEC
  ADON CONT CAL RSTCAL ALIGN EXTSEL EXTTRIG JEXTSEL JEXTTRIG SWSTART JSWSTART TSVREFE SCAN AWDSGL JAUTO
  DISCEN JDISCEN DISCNUM DUALMOD JAWDEN AWDEN AWDCH EOC JEOC AWD JSTRT EOCIE JEOCIE AWDIE SMPx JSQ ADCCLK
  EN TCIF HTIF TEIF GIF TCIFx HTIFx TEIFx GIFx CGIFx CTCIF CHTIF CTEIF HTIE TEIE CIRC PINC MINC PSIZE MSIZE PL
  MEM2MEM NDT WDGA WDGTB EWI EWIF IWDG_KR PVU RVU TPAL TPE TPIE CTE CTI TEF TCR TDR DBG_TIMx_STOP
  LDM LDMIA LDMDB STM STMIA STMDB LDR LDRB LDRH LDRD STR STRB STRH STRD LDREX STREX CLREX PUSH POP MOV MOVS MOVW
  MOVT ADDS ADDW SUBW CBZ CBNZ TBB TBH IT ITSTATE ICI EPSR MRS MSR CPS CPSID CPSIE DMB DSB ISB NOP BLX BX
  UDF SVC SDIV UDIV MLA MLS UMULL SMULL UMLAL SMLAL SSAT USAT BFI BFC UBFX SBFX RBIT REV REVSH CLZ
  `
    .split(/\s+/)
    .filter(Boolean),
)

/** Proper names allowed in any case. */
const ALLOW_CI = new Set(['ohmlet', 'anthropic', 'claude', 'stmicroelectronics', 'cortex', 'unicorn', 'stm', 'msedge'])

/** Best-guess owning area for a leak, by the nearest matching ancestor (innermost first). */
const AREAS = [
  ['.erc-panel', 'src/ui/embedded/ErcPanel.tsx'],
  ['.emb-term', 'src/ui/embedded/UartTerminal.tsx'],
  ['.lai-panel', 'src/ui/embedded/instruments/(DecoderPanel|TriggerPanel).tsx'],
  ['.emb-la', 'src/ui/embedded/LogicAnalyzer.tsx'],
  ['.sco-bar', 'src/ui/embedded/instruments/ScopeControls.tsx'],
  ['.emb-log', 'src/ui/embedded/SimLog.tsx'],
  ['.emb-support-detail', 'src/ui/embedded/PartInfo.tsx'],
  ['.emb-regs', 'src/ui/embedded/McuPanel.tsx'],
  ['[class*="emb-fw"]', 'src/ui/embedded/McuPanel.tsx'],
  ['[class*="emb-run"]', 'src/ui/embedded/McuPanel.tsx'],
  ['[class*="emb-periph"]', 'src/ui/embedded/McuPanel.tsx'],
  ['[class*="emb-pin"]', 'src/ui/embedded/PartInfo.tsx'],
  ['.prs', 'src/ui/sheets/PropertiesSheet.tsx'],
  ['.psh', 'src/ui/sheets/PartsSheet.tsx'],
  ['.asm-scope-body', 'src/ui/sheets/ScopeSheet.tsx'],
  ['.asm-key-editor', 'src/ui/sheets/ApiKeyRow.tsx'],
  ['.asm-sheet', 'src/ui/sheets/(Ai|More|Scope)Sheet.tsx'],
  ['.ws-left', 'src/ui/workspace/LibraryPanel.tsx'],
  ['.ws-right', 'src/ui/workspace/Inspector.tsx'],
  ['.ws-tray', 'src/ui/workspace/Tray.tsx'],
  ['.ws-handle', 'src/ui/workspace/Workspace.tsx'],
  ['.lg-asheet', 'src/App.tsx (long-press ActionSheet) / src/ui/kit/ActionSheet.tsx'],
  ['.lg-dock', 'src/App.tsx (dock items) / src/ui/kit/Dock.tsx'],
  ['.app-empty', 'src/ui/chrome/EmptyState.tsx'],
  ['.app-onboard', 'src/ui/chrome/Onboarding.tsx'],
  ['.app-wire-strip', 'src/ui/chrome/WireColorStrip.tsx'],
  ['[class*="app-sel"]', 'src/ui/chrome/SelectionPill.tsx'],
  ['.app-undo-btn', 'src/ui/chrome/UndoPill.tsx'],
  ['.app-rotate-btn', 'src/ui/chrome/RotateButton.tsx'],
  ['[class*="lg-capsule"]', 'src/ui/chrome/StatusBar.tsx / src/ui/kit/StatusCapsule.tsx'],
  ['.lg-toast-host', 'toasts (src/App.tsx, src/ui/chrome/hints.ts, callers of showToast)'],
  ['.app-status-pill', 'src/ui/chrome/StatusPill.tsx'],
  ['.app-explain', 'src/ui/chrome/ExplainCard.tsx (lines: src/ui/chrome/explain.ts)'],
  ['.app-keys', 'src/ui/chrome/ShortcutsSheet.tsx'],
  ['.ws-probe-menu', 'src/ui/workspace/ProbeMenu.tsx'],
  ['[class*="lsn-"]', 'src/ui/lessons/* (LessonOverlay, LessonBrowser)'],
  ['.lg-sheet, .lg-panel', 'a sheet / panel (src/ui/sheets/*)'],
]

// ---------------------------------------------------------------------------
// Seed circuits
// ---------------------------------------------------------------------------

const BLUEPILL = {
  version: 1,
  name: '稽核電路',
  board: 'standard',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    // PA5 sits at c20 (pin 30, far header): resistor from its strip to col 34
    { id: 'R1', type: 'resistor', params: { resistance: 330 }, holes: ['a20', 'a34'] },
    { id: 'D1', type: 'led', params: { color: 'green' }, holes: ['b34', 'top-28'] },
    { id: 'EE1', type: 'at24c02', at: 'f40' },
    { id: 'SR1', type: '74hc595', at: 'f46' },
    { id: 'RV1', type: 'potentiometer', holes: ['a57', 'a58', 'a59'] },
    { id: 'SW1', type: 'slide_switch', holes: ['j57', 'j58', 'j59'] },
    { id: 'LA1', type: 'logic_probe', holes: ['j40'] },
    { id: 'SP1', type: 'scope_probe', holes: ['j41'] },
    { id: 'DMM1', type: 'multimeter' },
    { id: 'FG1', type: 'function_generator' },
  ],
  wires: [
    { id: 'w1', from: 'PS1:+', to: 'j27', color: 'red' }, // 5V pin (h27)
    { id: 'w2', from: 'PS1:-', to: 'j28', color: 'black' }, // GND3 (h28)
    { id: 'w3', from: 'a10', to: 'top-6', color: 'black' }, // GND1 (c10) → top− rail
  ],
}
const EMPTY = { version: 1, name: '空白', components: [], wires: [] }
const example = (f) => JSON.parse(readFileSync(path.join(ROOT, 'examples', f), 'utf8'))
/** LED straight across the supply (no series resistor) — burns out; engine issues. */
const LED_NO_RESISTOR = {
  version: 1,
  name: '無限流電阻 LED',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'D1', type: 'led', params: { color: 'red' }, holes: ['a10', 'a11'] },
  ],
  wires: [
    { id: 'w1', from: 'PS1:+', to: 'top+0', color: 'red' },
    { id: 'w2', from: 'PS1:-', to: 'top-0', color: 'black' },
    { id: 'w3', from: 'top+5', to: 'b10', color: 'red' },
    { id: 'w4', from: 'b11', to: 'top-5', color: 'black' },
  ],
}
/** Supply terminals wired straight together through the rails. */
const SHORTED = {
  version: 1,
  name: '短路',
  components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }],
  wires: [
    { id: 'w1', from: 'PS1:+', to: 'top+0', color: 'red' },
    { id: 'w2', from: 'PS1:-', to: 'top-0', color: 'black' },
    { id: 'w3', from: 'top+5', to: 'top-5', color: 'yellow' },
  ],
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

async function boot(browser, { ctx: ctxOpts = DESKTOP, layout = BLUEPILL, workspace = false, onboarded = true } = {}) {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([l, ws, ob]) => {
      if (sessionStorage.getItem('i18n-audit-seeded')) return
      sessionStorage.setItem('i18n-audit-seeded', '1')
      localStorage.clear()
      if (ob) localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.layout', l)
      localStorage.setItem('bb.renderMode', 'performance')
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      localStorage.setItem('bb.lang', 'zh-TW')
    },
    [JSON.stringify(layout), workspace, onboarded],
  )
  await page.goto(`${URL}?shotrig`, { timeout: 180_000 }) // a fresh profile on a busy machine loads slowly
  // a broken module graph (someone mid-edit) shows Vite's error overlay instead of the app
  await page.waitForSelector('canvas, vite-error-overlay', { timeout: 60000 })
  if (await page.locator('vite-error-overlay').count()) {
    const msg = await page.evaluate(() => document.querySelector('vite-error-overlay')?.shadowRoot?.querySelector('.message')?.textContent ?? '')
    await ctx.close()
    throw new Error(`the app failed to build: ${msg.split('\n')[0]}`)
  }
  await page.waitForTimeout(2500)
  page.on('load', () => errors.push('PAGE RELOADED during the run (dev-server HMR) — re-run against a server without hot reload'))
  return { ctx, page, errors }
}

/**
 * Run `src` (function body; gets `m` = the module, `a` = arg) against an app
 * module, imported by the EXACT URL the app loaded (a hot-updated module is
 * served as …?t=…; a bare import would instantiate a second copy).
 */
const withModule = (page, modulePath, src, arg) =>
  page.evaluate(
    async ([p, s, a]) => {
      const url =
        performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .find((n) => new URL(n).pathname === p) ?? p
      const m = await import(url)
      // eslint-disable-next-line no-new-func
      return new Function('m', 'a', s)(m, a)
    },
    [modulePath, src, arg],
  )
const store = (page, src, arg) => withModule(page, '/src/state/store.ts', `const st = m.useStore.getState(); ${src}`, arg)
const lab = (page, src, arg) => withModule(page, '/src/state/lab.ts', `const lab = m.useLab.getState(); ${src}`, arg)

/** In-page collector: visible text nodes + attributes (+ document.title). */
function collectInPage([skipSel, attrs, areas, rawSrc, cjkMinPx]) {
  const rawRe = new RegExp(rawSrc)
  const CJK = /[\u3400-\u9fff]/
  /** a raw ref outside "double quotes" (a quoted ref is a syntax example) */
  const isRaw = (s) => rawRe.test(s.replace(/"[^"\n]*"/g, ''))
  const vis = (el) => {
    if (!el || !el.isConnected) return false
    if (typeof el.checkVisibility === 'function')
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })
    return true
  }
  const area = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      for (const [sel, name] of areas) if (e.matches?.(sel)) return name
    }
    return '?'
  }
  const pathOf = (el) => {
    const parts = []
    for (let e = el; e && e !== document.body && parts.length < 5; e = e.parentElement) {
      const cls = (e.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      parts.unshift(e.tagName.toLowerCase() + (cls ? `.${cls}` : ''))
    }
    return parts.join(' > ')
  }
  /** The element whose rendering decides whether `el`'s text is seen. */
  const host = (el) => {
    const opt = el.closest('option, optgroup')
    if (opt) return opt.closest('select')
    if (el.tagName.toLowerCase() === 'title' && el.closest('svg')) return el.parentElement
    return el
  }
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim()
    const raw = isRaw(text)
    const cjk = CJK.test(text)
    if (!raw && !cjk && !/[A-Za-z]{3}/.test(text)) continue
    const el = n.parentElement
    if (!el || el.closest(skipSel)) continue
    const h = host(el)
    if (!vis(h)) continue
    // CJK under the minimum size (H9): the rendered size, scale transforms ignored
    const px = cjk ? parseFloat(getComputedStyle(el).fontSize) : NaN
    const small = cjk && Number.isFinite(px) && px < cjkMinPx - 0.05 ? Math.round(px * 10) / 10 : undefined
    if (!raw && !small && !/[A-Za-z]{3}/.test(text)) continue
    const ctx = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    out.push({ kind: 'text', text, context: ctx === text ? undefined : ctx, path: pathOf(el), area: area(el), raw, small })
  }
  const sel = attrs.map((a) => `[${a}]`).join(',') + ',optgroup[label]'
  for (const el of document.body.querySelectorAll(sel)) {
    if (el.closest(skipSel)) continue
    if (!vis(host(el))) continue
    for (const a of [...attrs, ...(el.tagName.toLowerCase() === 'optgroup' ? ['label'] : [])]) {
      const v = el.getAttribute(a)
      const raw = !!v && isRaw(v)
      if (!v || (!raw && !/[A-Za-z]{3}/.test(v))) continue
      out.push({ kind: `@${a}`, text: v.replace(/\s+/g, ' ').trim(), path: pathOf(el), area: area(el), raw })
    }
  }
  if (/[A-Za-z]{3}/.test(document.title)) out.push({ kind: 'document.title', text: document.title, path: 'head > title', area: 'index.html / src/App.tsx' })
  return out
}

// ---------------------------------------------------------------------------
// Leak detection + report
// ---------------------------------------------------------------------------

/** pin names / functions / part numbers / labels from the live catalog (ALL-CAPS tokens only). */
let DYNAMIC = new Set()

async function loadDynamicAllowlist(page) {
  const tokens = await withModule(
    page,
    '/src/model/catalog.ts',
    `const out = new Set()
     const add = (s) => { for (const t of String(s ?? '').split(/[^A-Za-z0-9_]+/)) if (t) out.add(t) }
     for (const e of Object.values(m.CATALOG)) {
       for (const p of e.pins ?? []) add(p)
       for (const pi of e.pinInfo ?? []) { add(pi.pin); add(pi.label); for (const f of pi.functions ?? []) add(f) }
       add(e.meta?.partNumber)
       for (const p of e.params ?? []) add(p.unit)
     }
     return [...out]`,
  )
  // only tokens that are not ordinary lower-case words ('anode', 'wiper' must be translated in the UI)
  DYNAMIC = new Set(tokens.filter((t) => !/^[a-z]+$/.test(t)))
}

function leakWords(text) {
  let s = text
  for (const re of STRIP) s = s.replace(re, ' ')
  const words = []
  for (const tok of s.match(/[A-Za-z0-9_]+(?:['’][A-Za-z]+)?/g) ?? []) {
    if (!/[A-Za-z]{3}/.test(tok)) continue
    if (/[0-9_]/.test(tok)) continue
    // mixed-case identifiers with 2+ capitals: register fields / signals (IOPxEN, CCxIE, TxE, RxNE, TIMxCLK, tSTAB), BusFault, IrDA
    if (/[a-z]/.test(tok) && (tok.match(/[A-Z]/g) ?? []).length >= 2) continue
    if (ALLOW.has(tok) || REGISTERS.has(tok) || DYNAMIC.has(tok) || ALLOW_CI.has(tok.toLowerCase())) continue
    words.push(tok)
  }
  return words
}

const leaks = new Map() // key → leak record
const rawRefs = new Map() // key → raw-ref record (UX H9)
const smallCjk = new Map() // key → CJK text under 12 px (UX H9 / SH-16)
const stateLog = []

function recordRaw(state, it) {
  const key = `${it.kind}\u0000${it.text}`
  const rec = rawRefs.get(key)
  if (rec) {
    if (!rec.states.includes(state)) rec.states.push(state)
    return
  }
  rawRefs.set(key, { refs: [...new Set(it.text.match(new RegExp(RAW_REF.source, 'g')) ?? [])], kind: it.kind, text: it.text, area: it.area, path: it.path, states: [state] })
}

function recordSmall(state, it) {
  const key = `${it.small}\u0000${it.path}\u0000${it.text}`
  const rec = smallCjk.get(key)
  if (rec) {
    if (!rec.states.includes(state)) rec.states.push(state)
    return
  }
  smallCjk.set(key, { px: it.small, text: it.text, area: it.area, path: it.path, states: [state] })
}

function record(state, items) {
  let n = 0
  for (const it of items) {
    if (it.raw) recordRaw(state, it)
    if (it.small) recordSmall(state, it)
    const words = leakWords(it.text)
    if (!words.length) continue
    n++
    const key = `${it.kind}\u0000${it.text}`
    const rec = leaks.get(key)
    if (rec) {
      if (!rec.states.includes(state)) rec.states.push(state)
      if (!rec.areas.includes(it.area)) rec.areas.push(it.area)
    } else {
      leaks.set(key, { words, kind: it.kind, text: it.text, context: it.context, area: it.area, areas: [it.area], path: it.path, states: [state] })
    }
  }
  return n
}

let activePrefix = ''
async function audit(page, name, errors) {
  const state = `${activePrefix}${name}`
  if (ONLY && !ONLY.test(state)) return
  const items = await page.evaluate(collectInPage, [SKIP_SELECTORS, ATTRS, AREAS, RAW_REF.source, CJK_MIN_PX])
  const n = record(state, items)
  stateLog.push({ state, strings: items.length, leaking: n, reloaded: errors?.some((e) => e.startsWith('PAGE RELOADED')) || undefined })
  console.log(`${n ? 'LEAK' : ' ok '} ${state}  (${items.length} strings, ${n} leaking)`)
}

const skipped = []
/** Run one step; a missing control or a timeout skips it (reported), never aborts the run. */
async function step(name, fn) {
  try {
    await fn()
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0]
    skipped.push({ state: `${activePrefix}${name}`, reason: msg })
    console.log(`skip ${activePrefix}${name}: ${msg}`)
  }
}

const sleep = (page, ms) => page.waitForTimeout(ms)
/**
 * Dock / rail items in order — the audit runs the zh-TW (new) chrome:
 * 元件 · 導線 · 課程 · 儀器 · 更多 (the AI assistant moved into 更多).
 */
const dock = (page, i) => page.locator('.lg-dock .lg-dock-item').nth(i).click({ timeout: 5000 })
const DOCK = { parts: 0, wire: 1, lessons: 2, scope: 3, more: 4 }

/** The AI assistant: 更多 → 「AI 電路助手」 (closes the More sheet / panel on the way). */
async function openAi(page) {
  await dock(page, DOCK.more)
  await sleep(page, 800)
  await openSheet(page).getByText(/^AI 電路助手$/).first().click({ timeout: 3000 })
  await sleep(page, 900)
}
/** The open sheet / panel content container. */
const openSheet = (page) => page.locator('.lg-panel:visible, .lg-sheet:visible').last()

async function clickAllRadios(page, scope, name, errors) {
  const radios = scope.locator('[role="radio"]')
  const n = await radios.count()
  for (let i = 0; i < n; i++) {
    const r = radios.nth(i)
    if (!(await r.isVisible())) continue
    await r.click({ timeout: 3000 })
    await sleep(page, 500)
    await audit(page, `${name}-${i + 1}`, errors)
  }
}

async function expandAll(page, scopeSel) {
  for (let pass = 0; pass < 3; pass++) {
    const btns = page.locator(`${scopeSel} [aria-expanded="false"]`)
    const n = await btns.count()
    if (!n) break
    for (let i = n - 1; i >= 0; i--) {
      const b = btns.nth(i)
      if (await b.isVisible()) await b.click({ timeout: 3000 }).catch(() => {})
    }
    await sleep(page, 300)
  }
}

async function loadFirmware(page, rootSel) {
  if (!existsSync(FIRMWARE)) throw new Error(`missing ${path.relative(ROOT, FIRMWARE)} (node firmware/build.mjs)`)
  await page.setInputFiles(`${rootSel} .emb-fw input[type=file]`, FIRMWARE, { timeout: 5000 })
  await sleep(page, 700)
}

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

async function classic(browser) {
  activePrefix = 'classic/'
  {
    const { ctx, page, errors } = await boot(browser, { layout: EMPTY, onboarded: false })
    await loadDynamicAllowlist(page)
    await audit(page, 'onboarding', errors)
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await boot(browser, { layout: EMPTY })
    await audit(page, 'empty-board', errors)
    await ctx.close()
  }
  const { ctx, page, errors } = await boot(browser)
  await audit(page, 'home', errors)

  await step('parts-sheet', async () => {
    await dock(page, DOCK.parts)
    await sleep(page, 800)
    await audit(page, 'parts-sheet', errors)
    // arm the Blue Pill card → its placement hint toast (picked by name: the
    // library order puts the everyday parts first, so it is no longer the first card)
    await page.locator('.psh-grid button', { hasText: 'Blue Pill' }).first().click({ timeout: 3000 })
    await sleep(page, 600)
    await audit(page, 'placing', errors)
    await page.keyboard.press('Escape')
    await sleep(page, 400)
  })
  await step('wire-mode', async () => {
    await dock(page, DOCK.wire)
    await sleep(page, 700)
    await audit(page, 'wire-mode', errors)
    await dock(page, DOCK.wire)
    await sleep(page, 300)
  })
  await step('ai-sheet', async () => {
    await openAi(page)
    await audit(page, 'ai-sheet', errors)
    await page.keyboard.press('Escape')
    await sleep(page, 400)
  })
  await step('lessons-sheet', async () => {
    await dock(page, DOCK.lessons)
    await sleep(page, 900)
    await audit(page, 'lessons-sheet', errors)
    await dock(page, DOCK.lessons)
    await sleep(page, 400)
  })
  await step('shortcuts', async () => {
    await page.mouse.click(720, 560) // the 3D view takes the focus
    await page.keyboard.press('Shift+Slash') // '?'
    await sleep(page, 600)
    if (!(await page.locator('.app-keys').isVisible())) throw new Error('the shortcuts list did not open')
    await audit(page, 'shortcuts', errors)
    await page.keyboard.press('Escape')
    await sleep(page, 400)
  })
  await step('scope-sheet', async () => {
    await dock(page, DOCK.scope)
    await sleep(page, 800)
    await audit(page, 'scope-sheet', errors)
    await clickAllRadios(page, openSheet(page).locator('.asm-sheet-head, .emb-sheet-view').first(), 'scope-sheet-seg', errors)
    await dock(page, DOCK.scope)
    await sleep(page, 400)
  })
  await step('more-sheet', async () => {
    await dock(page, DOCK.more)
    await sleep(page, 900)
    await audit(page, 'more-sheet', errors)
    const sheet = openSheet(page)
    await step('more-about', async () => {
      await sheet.getByText(/^(About ohmlet|關於.*)$/).first().click({ timeout: 3000 })
      await sleep(page, 400)
      await audit(page, 'more-about', errors)
    })
    await step('more-clear-confirm', async () => {
      await sheet.getByText(/^(Clear board|清除.*|清空.*)$/).first().click({ timeout: 3000 })
      await sleep(page, 500)
      await audit(page, 'more-clear-confirm', errors)
      // the product chrome clears at once (no confirmation — operation simplification) and
      // offers 〔復原〕 in the toast: take it, so the later states still have the board; the
      // classic chrome's confirmation is dismissed with Escape as before
      const undo = page.locator('.lg-toast').getByRole('button', { name: /^(復原|Undo)$/ })
      if (await undo.count()) await undo.first().click({ timeout: 3000 })
      else await page.keyboard.press('Escape')
      await sleep(page, 400)
      if ((await store(page, 'return st.layout.components.length')) === 0) throw new Error('the board stayed cleared')
    })
    await step('more-import', async () => {
      await sheet.getByText(/^(Import circuit JSON|匯入.*JSON.*)$/).first().click({ timeout: 3000 })
      await sleep(page, 500)
      await audit(page, 'more-import', errors)
    })
    await page.keyboard.press('Escape')
    await sleep(page, 400)
  })

  for (const id of ['U1', 'R1', 'D1', 'PS1', 'EE1', 'SR1', 'RV1', 'SW1', 'LA1', 'SP1', 'DMM1', 'FG1']) {
    await step(`properties-${id}`, async () => {
      await store(page, 'st.select(a)', id)
      await sleep(page, 700)
      await expandAll(page, '.prs')
      await audit(page, `properties-${id}`, errors)
    })
  }
  await store(page, 'st.select(null)')

  await step('action-sheet', async () => {
    // long-press the R1 body (plan x = column 27, z = row a lattice 3)
    const p = await page.evaluate(() => window.__shotRig?.project?.(27, 0.3, 3))
    if (!p) throw new Error('__shotRig.project unavailable')
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await sleep(page, 900)
    await page.mouse.up()
    await sleep(page, 500)
    if (!(await page.locator('.lg-asheet').isVisible())) throw new Error('long-press action sheet did not open')
    await audit(page, 'action-sheet', errors)
    await page.keyboard.press('Escape')
    await sleep(page, 400)
  })

  await step('running-no-firmware', async () => {
    await store(page, 'st.startSim()')
    await sleep(page, 2500)
    await audit(page, 'running-no-firmware', errors)
    await dock(page, DOCK.more)
    await sleep(page, 800)
    await audit(page, 'running-more-issues', errors)
    await dock(page, DOCK.more)
    await store(page, 'st.select(a)', 'U1')
    await sleep(page, 700)
    await audit(page, 'running-properties-U1', errors)
    await store(page, 'st.stopSim(); st.select(null)')
    await sleep(page, 500)
  })
  await step('firmware-running', async () => {
    await store(page, 'st.select(a)', 'U1')
    await sleep(page, 600)
    await loadFirmware(page, '.prs')
    await audit(page, 'firmware-loaded', errors)
    await store(page, 'st.startSim()')
    await sleep(page, 3000)
    await audit(page, 'firmware-running', errors)
    await store(page, 'st.stopSim()')
  })
  if (errors.length) console.log('classic page errors:', errors.slice(0, 6))
  await ctx.close()

  // legacy examples + broken circuits, running, with the More sheet's issue list
  for (const [name, layout] of [
    ['blinky-555', example('blinky-555.json')],
    ['night-light', example('night-light.json')],
    ['counter', example('counter.json')],
    ['date-display', example('date-display.json')],
    ['led-no-resistor', LED_NO_RESISTOR],
    ['shorted-supply', SHORTED],
  ]) {
    if (ONLY && !ONLY.test(`${activePrefix}${name}`)) continue
    await step(name, async () => {
      const b = await boot(browser, { layout })
      await store(b.page, 'st.startSim()')
      await sleep(b.page, 2500)
      await audit(b.page, `${name}-running`, b.errors)
      await dock(b.page, DOCK.more)
      await sleep(b.page, 800)
      await audit(b.page, `${name}-more`, b.errors)
      await b.ctx.close()
    })
  }
}

async function workspace(browser) {
  activePrefix = 'ws/'
  const { ctx, page, errors } = await boot(browser, { workspace: true })
  if (!DYNAMIC.size) await loadDynamicAllowlist(page)
  await audit(page, 'idle', errors)

  await step('library-details', async () => {
    await expandAll(page, '.ws-left')
    await audit(page, 'library-details', errors)
  })
  for (const tab of ['examples', 'lessons', 'parts']) {
    await step(`library-${tab}`, async () => {
      await lab(page, 'lab.setWorkspace({ left: { ...lab.workspace.left, open: true, tab: a } })', tab)
      await sleep(page, 500)
      await audit(page, `library-${tab}`, errors)
    })
  }

  await step('bluepill', async () => {
    await store(page, "st.select('U1')")
    await sleep(page, 800)
    await audit(page, 'bluepill-selected', errors)
    await expandAll(page, '.ws-right')
    await audit(page, 'bluepill-expanded', errors)
  })
  await step('firmware', async () => {
    await loadFirmware(page, '.ws-right')
    await audit(page, 'firmware-loaded', errors)
    await store(page, 'st.startSim()')
    await sleep(page, 3500)
    await audit(page, 'firmware-running', errors)
    await expandAll(page, '.ws-right')
    await audit(page, 'firmware-running-expanded', errors)
  })

  for (const tab of ['uart', 'logic', 'scope', 'log']) {
    await step(`tray-${tab}`, async () => {
      await lab(page, 'lab.setWorkspace({ tray: { ...lab.workspace.tray, open: true, tab: a } })', tab)
      await sleep(page, 700)
      if (tab === 'logic') {
        const add = page.locator('.ws-tray select').first()
        for (const v of ['mcu|U1|PA9', 'mcu|U1|PA10', 'mcu|U1|PA5']) {
          if ((await add.locator(`option[value="${v}"]`).count()) > 0) await add.selectOption(v)
        }
        await sleep(page, 1200)
      }
      await audit(page, `tray-${tab}`, errors)
      await expandAll(page, '.ws-tray')
      await clickAllRadios(page, page.locator('.ws-tray .emb-toolbar, .ws-tray .sco-bar').first(), `tray-${tab}-seg`, errors)
    })
  }
  await store(page, 'st.stopSim()')
  await sleep(page, 500)
  await audit(page, 'stopped', errors)

  for (const id of ['R1', 'D1', 'PS1', 'EE1', 'SR1', 'RV1', 'LA1', 'DMM1', 'FG1']) {
    await step(`inspector-${id}`, async () => {
      await store(page, 'st.select(a)', id)
      await sleep(page, 600)
      await expandAll(page, '.ws-right')
      await audit(page, `inspector-${id}`, errors)
    })
  }
  await store(page, 'st.select(null)')

  await step('more-panel', async () => {
    await dock(page, DOCK.more)
    await sleep(page, 900)
    await audit(page, 'more-panel', errors)
    await dock(page, DOCK.more)
    await sleep(page, 400)
  })
  await step('ai-panel', async () => {
    await openAi(page)
    await audit(page, 'ai-panel', errors)
    await page.keyboard.press('Escape')
    await sleep(page, 400)
  })
  await step('shortcuts', async () => {
    await page.keyboard.press('Shift+Slash') // '?' (the workspace adds Shift+A)
    await sleep(page, 600)
    if (!(await page.locator('.app-keys').isVisible())) throw new Error('the shortcuts list did not open')
    await audit(page, 'shortcuts', errors)
    await page.keyboard.press('Escape')
    await sleep(page, 400)
  })
  await step('hover-pin', async () => {
    const p = await page.evaluate(() => window.__shotRig?.project?.(20, 0, 5)) // c20 = U1 PA5
    if (!p) throw new Error('__shotRig.project unavailable')
    await page.mouse.move(p.x, p.y, { steps: 4 })
    await sleep(page, 600)
    await audit(page, 'hover-pin', errors)
  })
  if (errors.length) console.log('workspace page errors:', errors.slice(0, 6))
  await ctx.close()
}

async function phone(browser) {
  activePrefix = 'phone/'
  for (const [name, opts] of [
    ['onboarding', { layout: EMPTY, onboarded: false }],
    ['empty-board', { layout: EMPTY }],
  ]) {
    if (ONLY && !ONLY.test(`${activePrefix}${name}`)) continue
    await step(name, async () => {
      const b = await boot(browser, { ctx: PHONE, ...opts })
      await audit(b.page, name, b.errors)
      await b.ctx.close()
    })
  }
  if (!ONLY || ONLY.test(`${activePrefix}coach`)) {
    await step('coach', async () => {
      const b = await boot(browser, { ctx: PHONE, layout: EMPTY })
      await b.page.locator('.lg-dock .lg-dock-item').nth(DOCK.lessons).tap({ timeout: 5000 })
      await sleep(b.page, 900)
      await audit(b.page, 'lessons-sheet', b.errors)
      // the first lesson, guided: its coach card, the status line and the step's toast
      await withModule(b.page, '/src/ui/lessons/actions.ts', 'return m.startFirstLesson()')
      await sleep(b.page, 2500)
      await audit(b.page, 'coach', b.errors)
      await b.ctx.close()
    })
  }
  const { ctx, page, errors } = await boot(browser, { ctx: PHONE })
  await audit(page, 'home', errors)
  await step('properties', async () => {
    await store(page, "st.select('U1')")
    await sleep(page, 900)
    await audit(page, 'properties-U1', errors)
    await store(page, 'st.select(null)')
    await sleep(page, 600)
  })
  await step('scope-sheet', async () => {
    await page.locator('.lg-dock .lg-dock-item').nth(DOCK.scope).tap({ timeout: 5000 })
    await sleep(page, 900)
    await audit(page, 'scope-sheet', errors)
    const radios = page.locator('.lg-sheet [role="radio"]')
    const n = await radios.count()
    for (let i = 0; i < n; i++) {
      if (!(await radios.nth(i).isVisible())) continue
      await radios.nth(i).tap({ timeout: 3000 })
      await sleep(page, 600)
      await audit(page, `scope-sheet-seg-${i + 1}`, errors)
    }
  })
  // the open sheet covers the dock on a phone: close it with Escape (a dock tap would time out)
  await closeSheets(page)
  for (const [k, i] of [
    ['more-sheet', DOCK.more],
    ['parts-sheet', DOCK.parts],
  ]) {
    await step(k, async () => {
      await page.locator('.lg-dock .lg-dock-item').nth(i).tap({ timeout: 5000 })
      await sleep(page, 900)
      await audit(page, k, errors)
    })
    await closeSheets(page)
  }
  if (errors.length) console.log('phone page errors:', errors.slice(0, 6))
  await ctx.close()
}

/** Escape until no sheet / panel is open (phone sheets cover the dock). */
async function closeSheets(page) {
  for (let k = 0; k < 3; k++) {
    if (!(await page.locator('.lg-sheet:visible, .lg-panel:visible').count())) return
    await page.keyboard.press('Escape')
    await sleep(page, 500)
  }
}

async function main() {
  const browser = await chromium.launch(CHANNEL === 'bundled' ? {} : { channel: CHANNEL })
  let failed = false
  try {
    for (const run of [classic, workspace, phone]) {
      try {
        await run(browser)
      } catch (e) {
        failed = true
        console.error(`${activePrefix} aborted:`, e)
        skipped.push({ state: `${activePrefix}*`, reason: `aborted: ${String(e?.message ?? e).split('\n')[0]}` })
      }
    }
  } finally {
    await browser.close()
  }
  const list = [...leaks.values()].sort((a, b) => a.area.localeCompare(b.area) || a.text.localeCompare(b.text))
  const byArea = {}
  for (const l of list) byArea[l.area] = (byArea[l.area] ?? 0) + 1
  const words = {}
  for (const l of list) for (const w of l.words) words[w] = (words[w] ?? 0) + 1
  const report = {
    url: URL,
    date: new Date().toISOString(),
    summary: {
      states: stateLog.length,
      leakingStrings: list.length,
      uniqueWords: Object.keys(words).length,
      byArea,
      skippedStates: skipped.length,
      rawRefStrings: rawRefs.size,
      smallCjkStrings: smallCjk.size,
    },
    states: stateLog,
    skipped,
    leaks: list,
    rawRefs: [...rawRefs.values()].sort((a, b) => a.area.localeCompare(b.area) || a.text.localeCompare(b.text)),
    smallCjk: [...smallCjk.values()].sort((a, b) => a.area.localeCompare(b.area) || a.px - b.px || a.text.localeCompare(b.text)),
    words: Object.fromEntries(Object.entries(words).sort((a, b) => b[1] - a[1])),
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`\n${list.length} leaking strings (${Object.keys(words).length} distinct words) across ${stateLog.length} states; ${skipped.length} skipped`)
  for (const [a, n] of Object.entries(byArea).sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${a}`)
  if (VERBOSE) for (const l of list) console.log(`  [${l.area}] ${l.kind} "${l.text.slice(0, 100)}"  {${l.words.join(', ')}}`)
  console.log(`${rawRefs.size} strings with raw refs (3V3_1, U1.REG, PS1:+ …)${RAWREF_STRICT ? '' : ' — informational (I18N_RAWREF_STRICT=1 to fail)'}`)
  if (VERBOSE) for (const r of rawRefs.values()) console.log(`  [${r.area}] raw ${r.refs.join(', ')}: "${r.text.slice(0, 100)}"`)
  const smallAreas = {}
  for (const r of smallCjk.values()) smallAreas[r.area] = (smallAreas[r.area] ?? 0) + 1
  console.log(`${smallCjk.size} CJK strings under ${CJK_MIN_PX} px${SMALLCJK_STRICT ? '' : ' — informational (I18N_SMALLCJK_STRICT=1 to fail)'}`)
  for (const [a, n] of Object.entries(smallAreas).sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${a}`)
  if (VERBOSE) for (const r of smallCjk.values()) console.log(`  [${r.area}] ${r.px} px: "${r.text.slice(0, 60)}"  ${r.path}`)
  console.log(`report: ${OUT}`)
  process.exitCode = failed ? 2 : list.length || (RAWREF_STRICT && rawRefs.size) || (SMALLCJK_STRICT && smallCjk.size) ? 1 : 0
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})

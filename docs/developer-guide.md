# 開發者指南

本指南給想要修改或擴充 ohmlet 的開發者：系統架構、各子系統的契約、如何新增元件／MCU 周邊／裝置模型／課程／範例／介面文字，
共用的 UX 輔助函式與用語表，以及測試策略、CI 與貢獻規則。使用方式請看[使用手冊](user-guide.md)，韌體相關請看[韌體指南](firmware-guide.md)，
英文的架構說明在 [`ARCHITECTURE.md`](../ARCHITECTURE.md)，Phase 0 的設計審查在 [`ARCHITECTURE_REVIEW.md`](../ARCHITECTURE_REVIEW.md)，
兩輪使用者體驗審查在 [`docs/ux/`](ux/UX_VERIFY.md)。

> **第一條規則：不做假模擬。** 任何看起來「在運作」的東西都必須是真的算出來的：LED 的亮度來自求解器的電流，
> UART 終端機的文字來自韌體寫進 USART 暫存器的位元組，終端機送出的文字則以真實的 UART 訊框經 RX 腳的導線進入 MCU，課程的驗收來自真實的模擬量測。
> 沒有模擬的功能一律**誠實標示**（周邊的 `unsupported`、元件的支援等級與「未模擬」清單、課程的 `runnable`、範例的 `simulation`），
> 量不準的讀數顯示「—」並寫出原因，絕不用預先錄好的結果、動畫或特例程式碼去「看起來像」。

## 目錄

1. [開發環境與指令](#1-開發環境與指令)
2. [原始碼地圖](#2-原始碼地圖)
3. [架構總覽](#3-架構總覽)
4. [新增元件](#4-新增元件)
5. [新增 MCU 周邊](#5-新增-mcu-周邊)
6. [新增數位裝置模型](#6-新增數位裝置模型)
7. [新增課程](#7-新增課程)
8. [新增範例](#8-新增範例)
9. [新增韌體專案](#9-新增韌體專案)
10. [新增介面文字（字典條目）](#10-新增介面文字字典條目)
11. [共用 UX 輔助函式與用語表](#11-共用-ux-輔助函式與用語表)
12. [測試策略](#12-測試策略)
13. [持續整合（CI）](#13-持續整合ci)
14. [視覺回歸與經典外觀規則](#14-視覺回歸與經典外觀規則)
15. [i18n 稽核](#15-i18n-稽核)
16. [貢獻規則](#16-貢獻規則)

---

## 1. 開發環境與指令

需求：Node.js 20 以上（開發時使用 Node 24，CI 測 Node 20 與 22）、npm。執行測試**不需要** ARM 工具鏈——建置好的韌體映像檔已提交在 `firmware/dist/`。

```sh
npm install
npm run dev            # http://localhost:5173
```

| 指令 | 用途 |
|---|---|
| `npm run dev` | Vite 開發伺服器（熱重載） |
| `npm run build` / `npm run preview` | 正式版建置到 `dist/`／在本機預覽建置結果 |
| `npm run typecheck` | `tsc --noEmit`（TypeScript strict） |
| `npm test` | `vitest run`：全部單元、整合、真實韌體、UX 契約與文件測試 |
| `npm run test:firmware` | 只跑 `tests/firmware-checks.test.ts`：逐一驗證每個韌體專案的 `checks` 契約 |
| `npm run test:docs` | 只跑 `tests/docs-*.test.ts`：支援矩陣與程式碼一致、文件的連結與錨點、用語、文件中的數字與引用的介面文字與程式碼一致 |
| `npm run test:visual` | 視覺回歸比對（需要伺服器與瀏覽器，見 [§14](#14-視覺回歸與經典外觀規則)） |
| `npm run audit:i18n` | 「介面全中文」稽核（需要伺服器與瀏覽器，見 [§15](#15-i18n-稽核)） |
| `npm run test:e2e` | 端對端驗收（`scripts/acceptance-e2e.mjs`，真實瀏覽器，見 [`docs/acceptance/`](acceptance/README.md)） |
| `npm run docs:support` | 由程式碼重新產生 [`docs/support-matrix.md`](support-matrix.md) |
| `npm run docs:support:check` | 檢查支援矩陣是否過期（過期時結束碼為 1） |
| `npm run examples:build` / `npm run examples:check` | 由描述檔重新產生 `examples/embedded/`／檢查是否過期 |
| `npm run fw:vendor` | 取得 ST HAL、CMSIS、FreeRTOS 核心原始碼（固定版本）到 `firmware/vendor/`（不入庫） |
| `npm run fw:build` | 用 clang 建置全部（或指定的）韌體專案到 `firmware/dist/` |
| `npm run fw:list` | 列出全部韌體專案與一行說明 |

瀏覽器腳本（視覺回歸、i18n 稽核、端對端驗收、`scripts/ux-e2e/` 的逐項重播）使用 Playwright；預設 `VR_CHANNEL=msedge`（Windows 內建的 Edge），
在 Linux／CI 上設 `VR_CHANNEL=bundled` 並先執行 `npx playwright install chromium`。
有其他人同時編輯工作目錄時，請另外啟動一個**關閉熱重載**的 Vite 伺服器（`server.hmr = false`、`server.watch = null`、
`worker.format = 'es'`、自訂連接埠與 `strictPort`）給這些腳本使用，否則頁面中途重新載入會讓腳本的狀態機失效。

---

## 2. 原始碼地圖

| 路徑 | 內容 |
|---|---|
| `src/mcu/core/` | ARMv7-M（Cortex-M3）核心：解碼（`decode.ts`）、執行（`exec.ts`）、例外模型、NVIC／SCB／SysTick／DWT（`scs.ts`）、確定性事件佇列（`scheduler.ts`）、反組譯器（`disasm.ts`）；契約 `cpu-api.ts` |
| `src/mcu/stm32f1/` | STM32F103C8 SoC（`soc.ts`）與周邊外掛（USART、TIM、I2C、SPI、ADC、DMA、IWDG、WWDG、BKP、CRC）；誠實支援表在 `peripherals.ts`；契約 `periph-api.ts` |
| `src/mcu/loader/` | ELF／BIN／Intel HEX 載入器與 SHA-256 |
| `src/mcu/mcu-api.ts`、`registry.ts`、`pins.ts`、`firmware.ts` | MCU 模型與協調器之間的契約（`McuDevice`、`McuDebugState` 含 `pcSymbol`／`lrSymbol`／`clocked`／`afioMapr`）、型號註冊表、GPIO 電氣參數 |
| `src/sim/engine.ts`、`mna.ts`、`devices.ts`、`netlist.ts`、`chips/` | 上游的類比求解器（MNA，含與稠密解逐位元相同的稀疏 LU 快速路徑）、類比元件、網路表、行為式邏輯 IC |
| `src/sim/coordinator/` | 模擬協調器（lockstep）、MCU 開發板電氣轉接（`mcu-board.ts`）、UART 終端機的 USB 轉 TTL 轉接器（`uart-adapter.ts`）、記錄器（`recorders.ts`）、測試激勵源（`stimulus.ts`）、韌體契約執行器（`checks.ts`）、Worker／inline 主機 |
| `src/sim/digital/` | 邏輯網路層（`nets.ts`）與數位裝置契約（`api.ts`、`device-chip.ts`） |
| `src/sim/models/*.model.ts` | 元件家族的模擬模型外掛 |
| `src/sim/erc/` | 電氣規則檢查（規則表 `api.ts`，規則在 `rules-*.ts`） |
| `src/instruments/` | 協定解碼器、量測（`measure.ts`：`netSummary`／`netLiveSummary`）、觸發、自動縮放、VCD／CSV 匯出、**統一的單位格式**（`format.ts`）——純函式 |
| `src/model/catalog.ts`、`src/model/parts/*.parts.ts` | 元件目錄（上游元件＋各家族的外掛檔案） |
| `src/model/breadboard.ts`、`validate.ts`、`occlusion.ts`、`types.ts` | 麵包板幾何、佈局驗證、元件本體遮蔽、共用型別 |
| `src/three/` | three.js 場景（`scene.ts`，契約 `scene-api.ts`）、元件網格（`meshes/`、外掛 `meshes/ext/*.mesh.ts`）、導線路由、算繪模式 |
| `src/state/` | 電路文件與模擬主機的 store（`store.ts`）、嵌入式實驗室 store（`lab.ts`，契約 `lab-types.ts`）、專案檔格式（`project.ts`）、韌體儲存（`firmware-store.ts`）、復原紀錄 |
| `src/ui/kit/` | Liquid Glass 元件組（膠囊、底部面板、清單列、分段控制、toast…） |
| `src/ui/chrome/` | 殼層：狀態膠囊（`StatusBar.tsx`）、狀態提示列（`StatusPill.tsx`）、執行控制與狀態色（`run-control.ts`）、全域按鍵（`keys.ts`）、快速鍵表（`ShortcutsSheet.tsx`）、導覽與空白狀態、提示（`hints.ts`）、經典外觀開關（`legacy.ts`） |
| `src/ui/workspace/` | 桌面工作區：面板框架、元件庫／範例／課程分頁（`LibraryPanel.tsx`）、屬性面板框架、儀器匣（`Tray.tsx`）、懸停晶片與端點名稱（`hole-chip.ts`）、探測選單（`ProbeMenu.tsx`）、韌體拖放（`FirmwareDrop.tsx`）、場景橋接（`scene-bridge.ts`）、範例庫（`examples.ts`） |
| `src/ui/embedded/` | 屬性與問題：MCU 面板與內建韌體選擇器、腳位資訊、問題模型（`problems.ts`）與清單、ERC 面板、UART 終端機、邏輯分析儀、模擬日誌、名詞說明（`glossary.ts`）、探測動作（`probe-actions.ts`） |
| `src/ui/embedded/instruments/` | 儀器的 UI 邏輯：通道選單、網路即時摘要（`net-activity.ts`）、腳位功能（`pin-function.ts`）、示波器自動設定、量測分頁、解碼結果表 |
| `src/ui/sheets/` | 底部面板：元件、屬性（`PropertiesSheet.tsx`，桌面屬性面板共用同一個內容元件）、更多、AI、儀器 |
| `src/ui/lessons/` | 課程瀏覽器、引導卡、驗收結果、講義與收據列印、課程動作（`actions.ts`） |
| `src/ui/perf/` | 效能診斷浮層（預設關閉，「更多 → 設定 → 效能診斷」或 `?perf`） |
| `src/i18n/` | `t()`／`tc()`、元件文字（`parts.ts`：`partLabel`、`pinLabel`、`terminalLabel`）、執行期訊息翻譯（`messages.ts`）；字典在 `src/i18n/zh-TW/*.ts` |
| `src/lessons/` | 課程契約（`types.ts`）、註冊表、各級課程、驗收引擎（`engine/`）、診斷（`diagnose.ts`）、步驟動作推導、學習進度 |
| `src/firmware-assets.ts` | 隨應用程式附帶的 `firmware/dist/*.elf`（內建韌體選擇器、課程與範例用，需要時才下載） |
| `src/dev/e2e-hooks.ts` | 只在網址帶 `?e2e` 時載入的唯讀測試掛鉤（`window.__e2e`） |
| `src/llm/` | AI 電路助手（上游功能） |
| `firmware/` | 韌體建置系統、CubeIDE 風格專案、建置好的映像檔（見[韌體指南 §9](firmware-guide.md#9-用本專案的-clang-工具鏈建置範例韌體)） |
| `examples/`、`examples/embedded/` | 經典範例電路（JSON）與嵌入式範例庫（專案檔＋描述檔 `src/*.example.mjs`） |
| `scripts/` | 視覺回歸、i18n 稽核、端對端驗收、UX 逐項重播（`ux-e2e/`）、範例產生、支援矩陣產生、效能量測等工具 |
| `tests/` | vitest 測試（見 [§12](#12-測試策略)）；`tests/visual/` 為視覺回歸的場景與基準截圖 |
| `tools/cpu-oracle/` | 以 Unicorn 產生 CPU 差分測試向量的 Python 腳本（**只在開發期使用，不隨產品散佈**） |

---

## 3. 架構總覽

```
 介面（React）──────────────► store（zustand，電路文件＋復原）
   │  儀器以「拉取」方式查詢             │ host.load(layout) / start / pause / setRuntimeParam …
   │  （queryLogic / queryScope）       ▼
   │                         SimHost ── WorkerSimHost（瀏覽器，Web Worker）
   │                            │       InlineSimHost（node 測試、Worker 不可用時）
   │                            ▼
   │                  SimulationCoordinator（確定性虛擬時間）
   │        ┌───────────────┬──────────────┬─────────────────┬──────────────┐
   │        ▼               ▼              ▼                 ▼              ▼
   │   SimEngine（MNA）  McuDevice ×N   DigitalNets       DigitalDevice ×N  記錄器
   │   類比求解器        （STM32F103）  （邏輯網路層）    （感測器、顯示器…）  （示波器、邏輯、UART、日誌）
   │        ▲               │
   │        └── mcu-board 轉接器：GPIO 輸出級 → Norton 印記；求解後的電壓 → 輸入門檻
   ▼
 SimFrame（快照：遙測、MCU 狀態、UART 位元組、日誌）→ lab store（≤ 10 Hz 進入 React）
 問題模型（≤ 1 Hz）· 網路即時摘要（≤ 4 Hz，只在有人需要時輪詢）
```

### 3.1 Cortex-M3 核心（`src/mcu/core/`）

- 純 TypeScript 的 ARMv7-M 直譯器（Thumb-2，不含 FP／DSP 擴充）。每個位址的指令只解碼一次並快取在每 4 KiB 一頁的陣列中，
  快閃記憶體燒寫與重新載入映像檔時會使快取失效；執行迴圈每道指令不配置記憶體。
- 例外模型依 ARMv7-M ARM（DDI 0403E §B1.5）：進入、返回、尾鏈、延遲到達（近似）、升級、鎖死；
  WFI／WFE／SLEEPONEXIT 睡眠；NVIC、SCB、SysTick、DWT.CYCCNT、ITM；bit-band 別名區。BKPT 一律停住核心（沒有半主機）。
- 刻意的偏差都寫在 `cpu.ts` 檔頭，最重要的一項：**記憶體為零等待週期**（不模擬快閃記憶體等待週期與匯流排競爭），週期數依 Cortex-M3 TRM 的表格近似。
- 驗證：指令級（`tests/mcu/core/isa-*.test.ts`、`directed`、`exceptions`、`cycles`）；差分（`differential.test.ts` 以 **Unicorn 2.1.4** 產生的參考向量比對，
  向量以資料形式入庫在 `tests/fixtures/cpu/`，產生器在 `tools/cpu-oracle/`；Unicorn 為 GPL，只當開發期的參考答案，**從不打包、不連結**）；
  程式級（`selftest.test.ts` 把同一份 C 自我測試分別編譯成主機程式與韌體比對，主機端沒有 `clang`／`$CC` 時略過）；
  反組譯器（`disasm.test.ts` 與 `llvm-objdump` 逐行比對，沒有該工具時略過）。

### 3.2 STM32F103 SoC 與周邊（`src/mcu/stm32f1/`）

- `soc.ts` 實作 `McuDevice`：核心、記憶體、RCC 時脈樹、FLASH 介面、PWR、GPIO、AFIO、EXTI、DBGMCU。核心計算 HCLK 週期，
  `TimeBase` 在時脈切換時分段精確地換算週期與秒；**MCU 時間 = 模擬時間**。
- 其他周邊都是實作 `Stm32Peripheral`（`periph-api.ts`）的外掛，只透過 `SocContext` 與晶片其他部分溝通：時脈、事件排程、IRQ 線、
  AF 腳位驅動、DMA 請求、觸發訊號（TRGO／CCx → ADC、從屬計時器）。
- 所有計時都由同一個以週期為鍵的 `EventQueue` 排程，與瀏覽器的幀率無關。
- **誠實表**：`peripherals.ts` 為每個區塊產生 `PeripheralSupport`（`verified`／`partial`／`unsupported`、說明、`verifiedBy`）。
  `verified` 必須「記載的功能全部實作」**且**有通過的真實韌體整合測試（`tests/fidelity-support.test.ts` 檢查每個 `verifiedBy` 真的有測試執行）；
  USB、CAN、RTC、USB/CAN SRAM 讀為 0、忽略寫入、每次存取都記錄。這張表就是 MCU 屬性面板的「周邊」分頁，也是[支援矩陣](support-matrix.md)的來源。
- 偵錯狀態（`McuDebugState`）另外回報 LR 所在的函式、已開時脈的周邊（「只看韌體用到的」篩選）與 AFIO_MAPR（通道選單據此判斷重映射後的功能）。

### 3.3 韌體載入（`src/mcu/loader/`、`src/state/firmware-store.ts`）

`loadFirmwareFile()` 先依內容（ELF 魔術數字、Intel HEX 紀錄語法）再依副檔名判斷格式；只把載入位址落在快閃記憶體中的位元組燒進去。
韌體位元組以 SHA-256 為鍵存在 IndexedDB（`ohmlet`／`firmware`），綁定紀錄在 localStorage `bb.firmware`；開機時一律重新解析並驗證雜湊後才綁定。
介面上所有載入路徑（韌體卡片、3D 拖放、內建韌體選擇器、課程動作）都經過 `lab.loadFirmware`。

### 3.4 模擬協調器（`src/sim/coordinator/`）

`SimulationCoordinator` 在**確定性的虛擬時間**中擁有一個完整的模擬世界（演算法見 `api.ts` 與 `coordinator.ts` 檔頭）：

- 每次推進：`tStop = min(目標, 上次類比步 + 最大步長, 待處理的類比時間點, 下一個事件)`；每顆 MCU `runUntil(tStop)`。
- MCU 改變了接到**類比網路**的腳位驅動時，在該邊緣的精確時間記一個類比時間點，並在下一個指令邊界停下 MCU——類比步就剛好結束在邊緣上。
  比最小類比步（0.5 µs）更密的邊緣以工作週期加權平均（`stage.ts`）。接到**邏輯網路**的驅動變化由 `DigitalNets` 立即解析。
- 沒有 MCU 也沒有數位裝置時，退化成固定 50 µs 的類比步——與上游的模擬迴圈**逐位元相同**（`tests/sim/legacy-equivalence.test.ts`）。
- 沒有任何牆鐘時間會進入模擬；同樣的輸入永遠產生同樣的波形（`tests/coordinator/lockstep.test.ts`）。
- **MCU 開發板轉接器**（`mcu-board.ts`）：GPIO 輸出級（推挽 50 Ω、開汲極、40 kΩ 上下拉）、依資料手冊 VIL／VIH 加遲滯判讀輸入、
  上電重置／掉電重置、NRST、BOOT0、過電壓／過電流／浮接輸入警告。`McuDevice` 由協調器擁有，電路重建時不會被丟掉（熱接線）。
- **記錄器**（`recorders.ts`）：示波器的高解析度環形緩衝、邏輯分析儀的邊緣環形緩衝（只記錄邏輯分析儀的通道）、UART 位元組、模擬日誌——全部預先配置。
  介面以 `query` **拉取**需要的時間視窗，大量取樣從不推進 React 狀態。
- **測試與課程用的掛鉤**：`setStimulus`（在網路上加 50 Ω 外部激勵源，從不改 MCU 暫存器）、`scheduleAt`、`addUartListener`；
  **韌體契約執行器**（`checks.ts`）依契約的 `circuit` 描述搭出電路並逐條量測（見[韌體指南 §10](firmware-guide.md#10-checks-行為契約)）。
- **UART 終端機的 USB 轉 TTL 轉接器**（`uart-adapter.ts` 與 `coordinator.ts` 的 TTL 區塊）：`uartSend` 送往 MCU 的 USART 時**從不直接寫進周邊**。
  終端機是一個 3.3 V 的虛擬轉接器（150 Ω 的 CMOS 輸出、由 USB 供電、以開發板的 GND 為參考），TXD 接在 USART 的 RX 腳
  （USART1 → PA10、USART2 → PA3、USART3 → PB11，AFIO_MAPR 重映射時跟著換）：位元組依韌體設定的鮑率、字長、同位與停止位元，
  在虛擬時間中一個位元一個位元地送上導線，USART 經由腳位取樣接收（RXNE、IDLE、FE／PE／NE／ORE、DMA 請求都是真的）。
  邏輯網路上它是一個 `DigitalNets` 槽位（`addSlot` 的 `upOffset`：高電位固定在開發板 GND 之上 3.3 V；`setYield`：遇到其他強驅動就放手），
  類比網路上是 Norton 源（`McuBoardChip.setSource`）。RX 網路已由其他輸出驅動（模組的 TXD、電源軌、電晶體、經電位轉換器的模組…）時它不接上或立刻放開，
  每個 MCU 畫面都以 `McuFrameInfo.uartRx` 回報每個 USART 的 RX 腳、狀態（`free`／`driven`／`rail`／`output`／`absent`）、驅動者與驅動者自己的主機端序列埠，
  終端機據此寫出說明並提供模組的埠。韌體契約的 UART 驅動也走同一條路。

### 3.5 混合訊號的三層模型（`src/sim/digital/`）

1. **電氣層**：MNA 求解器。每個 MCU 腳位與數位裝置腳位的驅動也以 Norton 源印記在這裡，所以直流準位、電流、上拉電阻是否存在、驅動衝突與萬用電表讀數都具有物理意義。
   模組的輸出可以宣告自己的高電位電源軌（`DigitalSpec.outputRail`，例如板載 3.3 V 穩壓器），不是一律接 VCC。
2. **邏輯層**（`nets.ts`）：只由邏輯腳位、接到固定電壓軌的電阻與電源軌組成的網路是「可邏輯解析」的：驅動一改變就在邊緣的精確時間解析
   （開汲極的線及、上拉強度、衝突 → 未定義、沒有上拉 → 浮接）。含有其他元件的網路一律由類比求解器解析，邏輯讀取者以最近一次類比解經輸入門檻判讀。
   外部源（目前是 UART 終端機的轉接器）的高電位可以固定在某條參考電源軌之上（`upOffset`），並且可以「讓路」（`setYield`）：
   同一個網路上一出現其他強驅動，它就在網路解析之前放手，所以不會和模組的 TXD 或 MCU 的輸出互相衝突；`strongDriver` 回報目前誰在強驅動網路。
3. **協定層**：周邊與裝置在腳位邊緣上各自實作匯流排狀態機。MCU 周邊與感測器之間**沒有任何函式直呼**：所有通訊都經過腳位與網路。

### 3.6 元件目錄與外掛

| 層 | 位置 | 機制 |
|---|---|---|
| 目錄資料 | `src/model/parts/<家族>.parts.ts` 匯出 `PARTS: CatalogEntry[]` | `src/model/parts/index.ts` 以 `import.meta.glob` 收集，附加到 `CATALOG`；新家族不必修改 `catalog.ts` |
| 模擬模型 | `src/sim/models/<家族>.model.ts` | 匯入時呼叫 `registerDevice`（類比元件）、`registerChip`（行為式晶片）或 `registerDigitalDevice`（邏輯層裝置） |
| 3D 網格 | `src/three/meshes/ext/<家族>.mesh.ts` | 匯入時呼叫 `registerMeshBuilder(shape, minPins, build)`；內建形狀優先 |
| 中文文字 | `src/i18n/zh-TW/parts-<家族>.ts` 匯出 `PARTS_ZH` | 名稱、說明、規格、已模擬／未模擬、參數與選項的中文 |
| 執行期訊息 | `src/i18n/zh-TW/messages-<家族>.ts` 匯出 `MESSAGES_ZH`（樣式）與 `NOTES_ZH` | 模擬器產生的英文訊息在顯示時才翻譯，模擬程式碼與其測試維持語言中立 |

`CatalogEntry`（`src/model/catalog.ts`）在上游欄位之外新增了選用欄位：`support`（支援等級、已模擬／未模擬）、`pinInfo`（腳位說明、AF 功能、FT 標記）、
`subcircuit`（板上的 LED、上拉電阻、穩壓器等類比元素）、`mcu`（MCU 開發板腳位對應）、`digital`（邏輯層裝置規格）、`meta`（零件編號、尺寸、標籤、規格）、
`ratings`（給 ERC 的資料手冊額定值）、`obstacleHeight`、`offboard`、`supplyPins`、`source`、`allowedRotations`、`strictNewton`。

### 3.7 介面層

- **殼層**（`src/ui/chrome`）：狀態膠囊是執行鍵；狀態提示列顯示問題模型最重要的一則；`run-control.ts` 是「執行／暫停／繼續被偵錯器停住的核心」的唯一入口（`useSimPhase()`：idle／running／paused／halted／fault）；
  `keys.ts` 在 capture 階段路由空白鍵與 F5／F10／Shift+F5，不管焦點在哪裡都一致。
- **桌面工作區**（`src/ui/workspace`，寬度 ≥ 1100 px 且為精確指標）：左側元件庫／範例／課程、右側屬性面板（未選取時為問題面板）、下方儀器匣；
  新面板使用 DESIGN.md 的 **Tier S** 配方（沒有 backdrop-filter），維持既有的毛玻璃預算。
- **問題模型**（`src/ui/embedded/problems.ts`）：把 ERC 發現、模擬器問題與 MCU 狀態合成一份清單——一件事（`fact`）一列、依等級排序、附修正動作與標示目標；
  `boardBlocker(id)` 回答「這塊板子為什麼不動」，儀器的空白畫面、UART 狀態列與課程都用它。
- **場景橋接**（`src/ui/workspace/scene-bridge.ts`）：UI 指向 3D 的唯一途徑——`focusInScene`（對準並以紅／橘／藍標示問題）、`frameCircuit`、`frameTargets`、`highlightSource`。
- **儀器**：邏輯分析儀與示波器只在可見時執行自己的拉取迴圈；網路即時摘要（`net-activity.ts`）每 250 ms 輪詢一次，只在有人需要時。
- **效能紀律**：每幀不做 React 工作。模擬快照以 ≤ 10 Hz 進入 React（原始類型選擇器只在值改變時重新算繪）、問題清單 ≤ 1 Hz、3D 遙測直接寫入場景、效能診斷浮層每 500 ms 直接改 DOM。

### 3.8 狀態與持久化

| 資料 | 位置 |
|---|---|
| 電路文件與復原紀錄 | `src/state/store.ts`；自動儲存在 localStorage `bb.layout` |
| 韌體綁定／韌體位元組 | `bb.firmware`／IndexedDB `ohmlet`→`firmware`（以 SHA-256 為鍵） |
| 工作區配置、收藏、終端機偏好、邏輯分析儀通道、解碼器與觸發、示波器設定 | `bb.workspace`、`bb.favorites`、`bb.terminal`、`bb.instruments`、`bb.logicView`、`bb.scopeView`（`src/state/lab.ts` 等） |
| 課程進度、收據署名 | `bb.lessons`（`src/lessons/progress.ts`）、`bb.studentName` |
| 介面語言、算繪模式、API 金鑰、效能診斷、導覽完成 | `bb.lang`、`bb.renderMode`、`bb.apiKey`、`bb.perfDiag`、`bb.onboarded` |
| 專案檔 | `src/state/project.ts`：`ohmlet-project` 封套 v1，內嵌每塊開發板的韌體（base64＋SHA-256＋大小，`.bin` 另記燒錄位址）、邏輯分析儀設定、工作區配置；讀取時逐版遷移，較新版本的檔案會被拒絕 |

所有讀取都能容忍儲存空間不存在或內容損毀：壞掉的項目會被丟棄，不會只讀一半。載入時舊的按鈕代號 `PB<n>` 改為 `SW<n>`（`migrateComponentIds`）。

### 3.9 課程與範例

- **課程**是資料：`src/lessons/<級別>/<id>.lesson.ts` 匯出 `LESSON`（契約 `src/lessons/types.ts`），由 `src/lessons/index.ts` 以 glob 收集。
  驗收引擎 `src/lessons/engine/evaluate.ts` 用真實模擬評估每種檢核，在瀏覽器中於 Module Worker（`lesson-check.worker.ts`）執行。
- **範例庫**：`examples/embedded/src/<id>.example.mjs` 描述檔 → `scripts/build-examples.mjs` → `examples/embedded/<id>.ohmlet.json`（與「儲存專案」逐位元組相同的專案檔）＋ `index.json`。
  開啟範例走與使用者專案相同的 `lab.importProject` 路徑（`openExampleById`）。

---

## 4. 新增元件

以「新增一個 I²C 感測器模組」為例，依序完成：

1. **目錄資料**：在 `src/model/parts/<家族>.parts.ts` 的 `PARTS` 加入 `CatalogEntry`（`type` 全域唯一）。至少填寫：
   `label`、`category`、`placement`、`pins`、`sim`、`doc`（英文，會放進 AI 的系統提示），以及 `support`（**誠實地**列出 `simulated` 與 `limits`）、`pinInfo`、`meta`；
   有本體的模組要設 `bodyFootprint`（遮蔽）與必要時的 `obstacleHeight`。電氣額定值寫在 `ratings`，ERC 只會檢查有寫的數值。
2. **模擬模型**：類比元件以 `registerDevice(model, factory)` 註冊；邏輯層裝置見 [§6](#6-新增數位裝置模型)；只做放置與接線、不模擬行為的元件設 `support.level = 'visual'` 並在 `limits` 寫清楚。
3. **3D 網格**：在 `src/three/meshes/ext/<家族>.mesh.ts` 以 `registerMeshBuilder(shape, minPins, build)` 註冊。沿用 `src/three/meshes/shared.ts` 的材質工廠與調色盤、真實比例、第 1 腳標記；
   每個元件 **≤ 4000 個三角形**（`tests/meshes*.test.ts` 會檢查）。會發光的元件要保留看得見的外框（課程標示會套在它外面）。
4. **中文文字**：在 `src/i18n/zh-TW/parts-<家族>.ts` 的 `PARTS_ZH` 加入同一個 `type`：`label`、`doc`、`specs`、`simulated`、`limits`（**項目數量與順序必須與目錄相同**）、
   `params`、`options`。模型產生的英文訊息要在 `messages-<家族>.ts` 加上翻譯樣式。`tests/i18n/` 會強制這些規則。
5. **腳位名稱**：介面上的腳位一律經過 `pinLabel()`／`pinDisplayName()`（[§11](#11-共用-ux-輔助函式與用語表)），有特別稱呼的腳（陽極、正端…）在字典中定義，不要在元件程式碼中自己拼字串。
6. **測試**：模型的單元測試（`tests/devices/`）、有韌體時加整合測試（`tests/devices/*-firmware.test.ts`）、網格測試、必要時的 ERC 測試。
7. **支援矩陣**：執行 `npm run docs:support` 並提交 `docs/support-matrix.md`（`tests/docs-support-matrix.test.ts` 會在內容過期時失敗）。
8. **視覺**：在 `tests/visual/extra-<家族>.json` 加入場景並建立基準截圖（見 [§14](#14-視覺回歸與經典外觀規則)）。

---

## 5. 新增 MCU 周邊

1. 新增 `src/mcu/stm32f1/<名稱>.ts`，實作 `Stm32Peripheral`（`periph-api.ts`）：`name`、`base`、`size`、`gate`（RCC 時脈閘）、
   `attach(ctx)`、`read`／`write`、`reset()`，以及需要時的 `clockChanged`、`remapChanged`、`clockEnabled`、`dmaAck`、`debugHalt`。
2. 只透過 `SocContext` 存取外界：`scheduler` 排程（以核心週期為單位）、`setIrq`、AF 腳位驅動、DMA 請求、觸發訊號。
   **不要**輪詢、不要每個週期計數；計時器之類的區塊在相關時刻才排事件（參考 `tim-counter.ts` 的延遲計算）。
3. 在 `peripherals.ts` 把該區塊從 `unsupported(...)` 改成實際的建構函式，並寫好 `PeripheralSupport` 的說明（做了什麼、**沒做什麼**、用哪些韌體驗證）。
   只有在記載的功能全部實作、且有通過的真實韌體整合測試時才能標 `verified`，其餘一律 `partial`。
4. 新的說明文字要在 `src/i18n/zh-TW/messages-mcu.ts`（或該波次自己的 `messages-*.ts`）的 `NOTES_ZH` 加上中文。
5. 測試：暫存器層級的單元測試（`tests/mcu/stm32f1/<名稱>.test.ts`），以及用 ST HAL 寫的韌體在協調器上的整合測試（`tests/mcu/stm32f1/*-firmware.test.ts`），最好再加上 `project.json` 的 `checks` 契約。
6. 重新產生支援矩陣：`npm run docs:support`。

---

## 6. 新增數位裝置模型

數位裝置（`src/sim/digital/api.ts`）是在邏輯層運作的元件：感測器、顯示器控制器、移位暫存器、EEPROM、模組。

1. 目錄條目使用 `sim: { kind: 'chip', model: 'digital-device' }` 與 `digital: DigitalSpec`：`model`、`supplyPin`／`groundPin`／`minVdd`、
   `inputs`、`outputs`（SDA、DQ 這類雙向腳位兩邊都要列）、需要時的輸入門檻、輸出阻抗、上拉阻值與 `outputRail`。
2. 在 `src/sim/models/<家族>.model.ts` 以 `registerDigitalDevice(model, factory)` 註冊，實作 `DigitalDevice`：
   `init(ctx)`（`now`、`read`、`voltage`、`drive`、`schedule`／`cancel`、`supply`、`issue`、`log`）、`onPinChange(pin, level)`（在邊緣上執行協定狀態機）、
   `powerChanged(powered)`（斷電時必須釋放所有腳位）、`setParam`（溫度、距離、加速度等環境輸入）、`telemetry()`（給 3D 與屬性面板的便宜快照）。
3. 時序以 `ctx.schedule(delay, fn)` 在虛擬時間中排程，**不要**讀牆鐘時間。
4. 錯誤的使用方式要產生真實的症狀並以 `ctx.issue()` 回報：位址不符就不回 ACK、時脈太快就讀錯位元、沒供電就不動作。
5. 測試：協定層的單元測試（`tests/devices/*-protocols.test.ts`），以及真實 HAL 韌體驅動該裝置的整合測試（`tests/devices/*-firmware.test.ts`）。

---

## 7. 新增課程

1. 在 `src/lessons/<beginner|intermediate|advanced>/<id>.lesson.ts` 匯出 `LESSON: Lesson`（契約 `src/lessons/types.ts`）。同一級別的共用電路放在該資料夾的 `bench.ts`。
2. 內容全部使用台灣繁體中文：`title`、`summary`、`objectives`、`wiring`、`theory`、`expected`、`mistakes`、`steps`。內文支援段落（空行分隔）、`**粗體**`、`` `程式碼` ``、`- ` 清單。
   用語依 [§11](#11-共用-ux-輔助函式與用語表) 的用語表（工作週期、在電路板上標示、探棒、還沒有韌體、已載入…）；腳位與端子用完整寫法（「U1 PA5（板上 A5）」「PS1 正端」），不要寫 `PS1:+` 這類原始代號。
3. `start` 是起始電路（可以只有開發板與電源），`solution` 是完整的參考電路；`firmware` 以 `firmware/dist` 的專案名稱指定 MCU 的韌體。
   元件編號請沿用編輯器的命名規則（`src/state/store.ts` 的 `ID_PREFIX`：`R`、`C`、`LED`、`SW`、`RV`、`Q`、`PS`、`FG`…；IC 與 MCU 為 `U`），學生自己放的元件才會得到檢核預期的編號。
4. `acceptance` 列出驗收檢核（全部通過才算完成），步驟可以有自己的 `check`：

   | 檢核 | 用途 |
   |---|---|
   | `has-part` | 電路中至少有幾個某類型的元件 |
   | `connected`／`not-connected` | 兩個點（`{component, pin}`、`{hole}`、`{terminal}`）是否在同一個網路；`via` 可要求「經由一顆數值在範圍內的電阻」 |
   | `firmware-loaded` | 開發板已綁定韌體；指定 `project` 時必須與 `firmware/dist/<project>.elf` 相同 |
   | `measure` | 執行模擬並量測電壓、頻率、工作週期、電流或 LED 亮度（`fresh` = 重新上電） |
   | `uart-contains` | 韌體在時限內從 UART 輸出指定文字 |
   | `firmware-checks` | 執行該韌體專案的 `checks` 契約 |
   | `erc-clean` | ERC 沒有指定等級以上的發現 |
   | `all` | 子檢核全部成立 |

5. **步驟動作**（`action`）：`load-firmware`、`run`、`arm-part`、`wire`（標出要接的兩端）、`add-logic`；沒寫時由檢核推導（`src/lessons/step-actions.ts`），`[]` 表示沒有。
   `highlight` 指定要在 3D 中標示的孔位與元件（`watch` 讓觀察步驟的鏡頭保持看得到某塊開發板的 LED）。
6. **常見錯誤**：`mistakes` 的 `match` 描述「哪些檢核失敗、哪些通過、哪條 ERC 規則出現」時是這個錯誤——驗收結果第一行的「最可能的原因」就是由它判斷。
   示範錯誤用的韌體放在 `firmware/projects/lesson-<id>-<錯誤>/`，選擇器會把它標成「錯誤示範」。
7. **誠實標示**：需要尚未模擬的功能時，`runnable` 設為 `'partial'` 或 `'not-yet'`，並在 `runnableNote` 寫清楚缺什麼。另有 `durationMin`（預估分鐘數）與 `requires`（需要的元件、韌體、預設打開的儀器）。
8. 測試會自動套用在每一課（`tests/lessons/registry.test.ts`）：編號唯一、文字是繁體中文、起始與解答電路通過 `validateLayout`、
   需要的元件與韌體都存在、**解答通過全部驗收檢核且起始電路至少有一項不通過**；各級別另有內容測試（`beginner.test.ts`、`intermediate.test.ts`、`advanced.test.ts`），
   用語表由 `tests/ux-shell-terms.test.ts` 檢查。新增課程後執行 `npm run docs:support`（支援矩陣列出每一課的狀態），並確認 README 的課程數量（`tests/docs-facts.test.ts` 會檢查）。

---

## 8. 新增範例

1. 在 `examples/embedded/src/<id>.example.mjs` 建立描述檔（格式見 `scripts/build-examples.mjs` 檔頭）：
   中文的 `title`／`summary`／`description`／`tags`、`category`、`difficulty`（初級／中級／進階）、要內嵌的 `firmware`（`firmware/dist` 專案名稱或 `null`）、
   `simulation`（`'partial'` 時必須寫 `simulationNote`）、以 `examples/embedded/src/lib.mjs` 的輔助函式搭出電路的 `build()`、
   預先設定的邏輯分析儀通道與解碼器、示波器預設、要開啟的儀器分頁，以及 `expect`（模擬中必須發生的事）。
2. 執行 `npm run examples:build` 產生 `<id>.ohmlet.json` 與 `index.json`，一起提交。輸出是確定性的；重新建置韌體後必須重跑。
3. `tests/examples-embedded.test.ts` 會驗證：佈局合法、沒有驗證警告、ERC 沒有未說明的風險、內嵌的韌體與 `firmware/dist` 相同、在模擬中真的出現 `expect` 描述的行為。
4. 執行 `npm run docs:support`（支援矩陣列出每個範例）。

---

## 9. 新增韌體專案

在 `firmware/projects/<名稱>/` 建立 CubeIDE 風格的專案（`main.c`、`main.h`、`stm32f1xx_it.c`、`stm32f1xx_hal_msp.c`、`project.json`），
執行 `npm run fw:build -- <名稱>`，提交 `firmware/dist/<名稱>.elf/.bin/.hex` 與 `manifest.json`。`project.json` 的 `checks` 契約會被
`tests/firmware-checks.test.ts` 自動執行，不需要修改測試檔；新映像檔會自動出現在內建韌體選擇器（`src/firmware-assets.ts` 以 glob 收集）。
沒有範例描述的專案，要在 `BundledFirmwarePicker.tsx` 的 `FIRMWARE_TEXT` 加上標題與一行說明（英文原文，中文在 `ux-inspector.ts`）。
細節見[韌體指南 §9–§10](firmware-guide.md#9-用本專案的-clang-工具鏈建置範例韌體) 與 [`firmware/README.md`](../firmware/README.md)。

---

## 10. 新增介面文字（字典條目）

- 介面預設為台灣繁體中文，英文仍可切換（設定、`?lang=en`）。程式碼中寫**英文原文**，以 `t('…')` 或帶情境的 `tc('…', 'context')`（字典鍵為 `原文|情境`）顯示；
  有參數時用 `{name}` 佔位（`t('{id} reset', { id })`）。
- 每個工作區域有自己的字典檔 `src/i18n/zh-TW/<區域>.ts`（以 glob 合併，避免多人同時編輯同一個檔案）。新功能請建立自己的檔案，不要改別人的條目：
  同一個鍵出現在兩個檔案時，以檔名字母順序最後的那個為準，所以**不要重新定義已存在的鍵**。
- 元件文字查 `partLabel()`／`partDoc()`／`pinLabel()`（`src/i18n/parts.ts`），執行期訊息在顯示邊界以 `tMessage()` 翻譯（`src/i18n/messages.ts`，樣式在 `messages-*.ts`）。
  模擬器與 ERC 產生的訊息維持英文原文（數字用 `plain: true` 格式），只在顯示時翻譯。
<!-- docs-terms: allow（下一行列出不該用的詞） -->
- 用語：程式、檔案、介面、記憶體、預設、韌體、網路、資料、設定、螢幕、軟體、硬體；不用程序、界面、內存、默認、數據、設置、屏幕、軟件、硬件等
  （完整清單見 `tests/i18n/zh-check.ts`）。中文句子使用全形標點；數字與單位之間空一格（`3.30 V`）。
<!-- docs-terms: end -->

- 中文字的字級至少 12 px；不要寫只有滑鼠能做的說法（「點一下」而不是「拖曳」），觸控有不同的出口時用不同的字串（`hints.ts`）。
- 測試：`tests/i18n/`（每個元件與執行期訊息都有中文、沒有中國大陸用語、全形標點、佔位符一致）、`tests/ux-shell-terms.test.ts`（用語表），
  以及瀏覽器中的 `npm run audit:i18n`（[§15](#15-i18n-稽核)）。

---

## 11. 共用 UX 輔助函式與用語表

產品負責人的要求是**操作、接線、顯示資訊的連貫性**：同一個東西在每個畫面上同名、同格式、同顏色。第二輪 UX 修正（[`docs/ux/UX_VERIFY.md`](ux/UX_VERIFY.md) §5.4、§7.1）
把這些規則做成共用的輔助函式。**新程式碼一律呼叫它們，不要自己寫變體**（不要自己 `toFixed(2) + ' V'`、不要自己拼腳位名稱、不要自己挑狀態色）；缺少的情況請擴充輔助函式本身。

| 編號 | 函式 | 模組 | 用途 |
|---|---|---|---|
| H1 | `pinLabel(entry, pin, {id, form})`、`terminalLabel(ref, layout)` | `src/i18n/parts.ts` | 腳位與端子名稱：「U1 PA5（板上 A5）」、表格簡寫「U1 PA5」、「LED1 陽極（長腳）」、「PS1 正端」「DMM1 COM 端」 |
| H2 | `endpointName(layout, ref)`、`wireRefusalText(refusal)` | `src/ui/workspace/hole-chip.ts` | 孔位與端點的名稱：「U1 PA0（c25）」「a25（U1 PA0 這一排）」「上方 − 電源軌 第 20 孔」；導線被拒絕的原因 |
| H3 | `fmtVoltage`、`fmtCurrent`、`fmtPower`、`fmtFreq`、`fmtPercent`、`fmtSpeedFactor`、`fmtSimClock`、`fmtSimTimeAt`、`approx` | `src/instruments/format.ts` | 唯一的單位格式：3 位有效數字（讀數 4 位）、不出現 mHz、不出現 −0、`|V| > 1 kV` 或非有限值顯示「—」、短路電流寫「> 2 A（短路）」、速度寫「0.8 倍速」 |
| H4 | `netLiveSummary`、`getNetLive`、`useNetLive`、`hasActivity`、`netLiveText` | `src/instruments/measure.ts`、`src/ui/embedded/instruments/net-activity.ts` | 網路在做什麼：PWM（頻率與工作週期）、訊號變化中（非週期）、直流、瞬時值——只在證據足夠時給頻率 |
| H5 | `Problem.fact`、`boardBlocker`、`useBoardBlocker` | `src/ui/embedded/problems.ts` | 一件事一列；開發板不動的最根本原因（沒有供電 → 還沒有韌體 → 鎖死 → 停住 → 系統記憶體開機） |
| H6 | `STATE_TONE`、`stateColor`、`SHORTCUTS`、`withKey(label, id)` | `src/ui/chrome/run-control.ts`、`ShortcutsSheet.tsx` | 唯一的狀態色（執行中綠、已暫停藍、核心已停住橘、故障與沒有供電紅、還沒有韌體橘、睡眠青…）；按鈕提示附快速鍵「單步（F10）」 |
| H7 | `focusInScene`、`frameTargets`、`highlightSource` | `src/ui/workspace/scene-bridge.ts`、`src/three/scene-api.ts` | 從 UI 指向 3D：問題標示分錯誤／風險／提示三種顏色 |
| H8 | `moveWireEnd`、`swapLeads`、`wireRefusal`、`migrateComponentIds` | `src/state/store.ts`、`src/state/project.ts` | 改接導線、對調兩腳（各一個復原步驟）；按鈕代號 `SW<n>` |
| H9 | 用語表 | `tests/ux-shell-terms.test.ts`、`scripts/i18n-audit.mjs` | 見下表 |
| H10 | `activePinFunction(functions, mode, ctx)` | `src/ui/embedded/instruments/pin-function.ts` | 腳位目前的複用功能（I²C 腳不會被標成 USART；重映射只在 AFIO_MAPR 已知時才採用；不確定就不寫） |
| H11 | `acceptFirmwareFile(id, file)`、`isFirmwareFileName` | `src/ui/embedded/McuPanel.tsx` | 所有韌體檔案入口（卡片、3D 拖放）的同一條路徑 |

**用語表**（`tests/ux-shell-terms.test.ts` 掃描 `src/i18n/zh-TW/*.ts` 與課程原始碼；`tests/docs-terms.test.ts` 對 README 與 `docs/` 的繁體中文文件檢查同一張表的用詞、
使用手冊與 README 中的原始代號，以及中國大陸用語）：

<!-- docs-terms: allow（這張表本身列出不該用的詞） -->

| 不要寫 | 要寫 |
|---|---|
| 佔空比 | 工作週期 |
| 在場景中標示 | 在電路板上標示／取消標示 |
| 入門（難度） | 初級／中級／進階 |
| n 支引腳 | n 腳 |
| 速度寫成「0.5×」 | 0.5 倍速（「更多 → 模擬 → 模擬速度（倍速）」的選項按鈕寫「0.5 倍」） |
| 探針 | 探棒 |
| 未載入韌體 | 還沒有韌體 |
| 韌體「正在執行」（只是載入了） | 已載入；「執行中」只用於模擬的執行狀態 |
| 原始代號 `3V3_1`、`GND2`、`U1.REG`、`U1.PA5`、`PS1:+` | `pinLabel`／`terminalLabel`／`endpointName` 的寫法 |
| 導線代號 w1 與 W1 混用 | 新導線一律 `W<n>`（舊範例與課程的小寫代號保留） |
| 按鈕代號 PB1（與 GPIO PB1 同名） | SW1 |

<!-- docs-terms: end -->

**經典外觀規則**：所有新的殼層行為都以 `isLegacyChrome()`（`src/ui/chrome/legacy.ts`：介面語言為英文**且**沒有顯示桌面工作區）為界——
經典外觀必須與 UX 改版前（commit `6d01968`）逐像素、逐行為相同，包括它的按鍵（F5 是瀏覽器重新整理、空白鍵按下聚焦中的按鈕）。

---

## 12. 測試策略

`npm test` 執行全部 vitest 測試（node 環境，fork 池上限 6 個，見 `vitest.config.ts`）。測試分層如下：

| 層 | 位置 | 內容 |
|---|---|---|
| 上游 | `tests/*.test.ts`（根目錄的非 `ux-*` 檔） | 麵包板幾何、網路表、類比引擎、晶片、驗證器、導線路由、網格、store 編輯、復原 |
| 舊行為等價 | `tests/sim/legacy-equivalence.test.ts` | 沒有 MCU 時，協調器與上游模擬迴圈逐位元相同；稀疏與稠密求解器逐位元相同（`perf-mna.test.ts`） |
| CPU | `tests/mcu/core/` | 指令、例外、週期、Unicorn 差分向量、主機對照的 C 自我測試、反組譯器 |
| SoC 周邊 | `tests/mcu/stm32f1/` | 各周邊的暫存器模型；`*-firmware.test.ts` 以真實 HAL 韌體在協調器上執行 |
| 支援表的真實性 | `tests/fidelity-*.test.ts` | 每個 `verifiedBy` 都真的有測試執行、「僅做過單元測試」的說法仍然成立、偵錯狀態的新欄位、模組輸出電源軌 |
| 協調器 | `tests/coordinator/` | lockstep 確定性、邏輯網路、開發板轉接器、記錄器、主機、韌體端對端、`checks` 電路 |
| 元件模型 | `tests/devices/` | 協定、目錄、網格與真實韌體驅動的整合測試 |
| 韌體契約 | `tests/firmware-checks.test.ts` | `firmware/dist/manifest.json` 中每個有 `checks` 的專案 |
| 儀器 | `tests/instruments/`、`tests/ux-instruments-*.test.ts` | 解碼器、觸發、量測、匯出、以真實韌體波形解碼；誠實的時間讀數、通道與電路的連結 |
| ERC | `tests/erc/`、`tests/ux-inspector-erc-*.test.ts` | 每條規則、範例電路、真實韌體的遙測、執行後才確認的規則 |
| 課程 | `tests/lessons/`、`tests/ux-lessons-*.test.ts` | 註冊表通用規則、各級課程、驗收引擎、診斷、步驟動作、引導卡、講義與收據 |
| 範例 | `tests/examples.test.ts`、`tests/examples-embedded.test.ts` | 經典範例與嵌入式範例庫（每個都真的執行） |
| UX 契約與共用輔助函式 | `tests/ux-contracts.test.ts`、`tests/ux-helpers-*.test.ts`、`tests/ux-shell-*.test.ts`、`tests/ux-scene-*.test.ts`、`tests/ux-inspector-*.test.ts` | H1–H11 的行為表、狀態色、按鍵路由、提示列模型、懸停晶片、取景、問題模型、用語表 |
| 發布前 QA 與收尾 | `tests/qa-*.test.ts`、`tests/sim/qa-sim-*.test.ts`、`tests/close-*.test.ts` | 三位新使用者審查與分析面板清晰度回合的修正（電表、課程、接線、膠囊與提示列、儀器名詞）；UART 終端機在 RX 腳上送出真實訊框、不與電路衝突、輸入框下方的說明 |
| 專案檔與狀態 | `tests/project-file.test.ts`、`tests/lab-store.test.ts`、`tests/store-*.test.ts` | 專案封套、遷移、韌體驗證、持久化 |
| i18n | `tests/i18n/` | 每個元件與執行期訊息都有中文、沒有中國大陸用語、全形標點 |
| 文件 | `tests/docs-*.test.ts` | 支援矩陣與程式碼一致；文件的相對連結、錨點與圖片存在且圖片 ≤ 300 KB；用語表；README 的數字與程式碼一致；文件提到的 `npm run` 指令都存在；使用手冊引用的介面文字由顯示它的程式碼產生後比對（`docs-ui-quotes`），截圖與 `scripts/docs-shots.mjs` 一一對應 |

瀏覽器中的檢查：`npm run test:visual`（[§14](#14-視覺回歸與經典外觀規則)）、`npm run audit:i18n`（[§15](#15-i18n-稽核)）、`npm run test:e2e`（12 步驟端對端驗收，報告寫到 `docs/acceptance/`），
以及 `scripts/ux-e2e/*.mjs`（UX 修正項目的逐項重播，每個腳本檔頭說明它驗證什麼）。

原則：

- **真實韌體優先**：周邊與裝置的行為以 ST HAL 編譯的韌體在協調器上驗證，量測腳位波形、UART 輸出與時序，而不是只測暫存器。
- **需要外部工具的測試會略過，不會假裝通過**：`describe.skipIf(...)`（例如主機端沒有 `clang` 時的自我測試、沒有 `llvm-objdump` 時的反組譯比對）。
- 牆鐘時間的效能斷言只有少數幾個，取多次執行的最佳值並留有 CI 餘裕（`OHMLET_BENCH=1` 啟用嚴格的模擬速度量測）。
- 測試從不放寬來讓變更通過；行為改變時要說明原因並更新契約。介面元件的測試以純函式模型為主（例如 `statusPillModel`、`firmwareGroups`），React 只在必要時以靜態算繪測試。

---

## 13. 持續整合（CI）

`.github/workflows/ci.yml`：

| 工作 | 何時執行 | 平台 | 內容 |
|---|---|---|---|
| `test` | 每次 push 與 pull request | Ubuntu、Windows × Node 20、22 | `npm ci` → `npm run typecheck` → `npm test` → `npm run examples:check` → `npm run build` |
| `firmware` | 手動觸發（勾選 `firmware`），或變更涉及 `firmware/` 時 | Ubuntu、LLVM 21（apt.llvm.org） | `npm run fw:vendor` → `npm run fw:build` → 確認 `firmware/dist/` 的 `.bin`、`.hex` 與 `manifest.json` 與提交的內容逐位元組相同 |
| `i18n-audit` | 手動觸發（勾選 `browser`） | Ubuntu、Node 22、Playwright Chromium | 建置後以 `vite preview` 提供頁面，`VR_CHANNEL=bundled npm run audit:i18n`，上傳報告 |
| `visual` | 手動觸發（勾選 `browser`） | Windows、Edge | 啟動關閉熱重載的開發伺服器，`npm run test:visual`，上傳截圖與差異報告；**不影響 CI 結果**（`continue-on-error`） |

- `npm test` 已包含 `tests/docs-*.test.ts`，所以支援矩陣過期、文件連結失效或 README 的數字與程式碼不符都會讓 `test` 工作失敗。
- `.elf` 含有偵錯資訊中的絕對路徑，不同機器建置會不同，所以韌體工作只比對實際燒錄的位元組（`.bin`／`.hex`）與 `manifest.json`。
  提交的映像檔以 LLVM 21.1.8 建置並已在本機重新建置驗證；apt.llvm.org 的 LLVM 21 修補版本若產生不同的機器碼，這個工作會指出差異的檔案。
- 視覺回歸的基準截圖在 Windows + Edge + GPU 上擷取，雲端執行環境的軟體算繪與字型會造成像素差異，所以 `visual` 只當參考；正式的判斷請在本機執行（[§14](#14-視覺回歸與經典外觀規則)）。
  端對端驗收（`npm run test:e2e`）同樣在本機執行。

---

## 14. 視覺回歸與經典外觀規則

`scripts/visual-regression.mjs` 以無頭 Chromium 系列瀏覽器對執行中的伺服器截圖，在瀏覽器內以 canvas 逐像素比對基準（`tests/visual/baseline/`）：

```sh
# 另開一個關閉熱重載的伺服器（或 npm run dev），再執行：
VR_URL=http://localhost:5173/ node scripts/visual-regression.mjs compare
VR_EXTRA=tests/visual/extra-displays.json VR_ONLY=displays node scripts/visual-regression.mjs compare
VR_OUT=<資料夾> node scripts/visual-regression.mjs compare   # 輸出到自己的資料夾（多人同時工作時）
```

- 內建的**舊場景**（`desktop-*`、`closeup-blinky-555`、`phone-*`，含經典外觀的導覽卡、空白狀態與手機屬性面板）固定使用英文介面與經典外觀，
  證明上游 ohmlet 的外觀與行為沒有被改動：**必須維持 0 差異**。
- 各領域的新場景在 `tests/visual/extra-*.json`（`VR_EXTRA` 一次指定一個檔案），可設定 `lang`、`workspace`、`tone`、`firmware`（開機前把 `firmware/dist` 的映像檔放進 IndexedDB）、
  `keys`（例如按空白鍵開始模擬）、`onboarding`、`select`。
- 環境變數：`VR_URL`、`VR_CHANNEL`（`msedge`／`chrome`／`bundled`）、`VR_ONLY`（正規表示式）、`VR_OUT`、`VR_TONE`、`VR_EXTRA`。單一場景差異比例超過 1 % 即失敗。
- **只有在刻意改變外觀時才更新基準**（`capture`），而且只更新自己負責的場景；改變了哪些場景要在變更說明中列出。不要為了讓比對通過而重新擷取別人的基準。

**文件截圖**：README 與 `docs/` 的截圖（`docs/images/*.jpg`）由 `scripts/docs-shots.mjs` 從目前的介面重新擷取，介面改變後請重拍受影響的圖：

```sh
# 另開一個關閉熱重載的伺服器，再執行（不加參數 = 全部重拍）：
SHOTS_HEADED=1 SHOTS_URL=http://localhost:5345/ node scripts/docs-shots.mjs
SHOTS_HEADED=1 SHOTS_URL=http://localhost:5345/ node scripts/docs-shots.mjs "picker|uart"   # 只重拍名稱符合的截圖
```

- 每張圖都從全新的瀏覽器環境開始：中文介面、桌面工作區、1440×900（手機圖 390×844），導覽已完成（導覽本身的圖除外）。
  電路由範例庫與課程電路以 App 自己的開啟流程載入，介面狀態盡量以真實點擊操作到位；JPEG 品質 80（`tests/docs-links.test.ts` 要求每張圖 ≤ 300 KB）。
- 環境變數：`SHOTS_URL`（預設 `http://localhost:5173/`）、`SHOTS_OUT`（預設 `docs/images`）、`SHOTS_CHANNEL`（`msedge`／`chrome`／`bundled`，未設定時沿用 `VR_CHANNEL`）、
  `SHOTS_TEXT=1`（另存每張圖的頁面文字，方便核對用語；不要放進 `docs/`）、`SHOTS_HEADED=1`（開啟真正的前景視窗擷取）。任何一張失敗會印出 `FAILED <名稱>`，其他照常擷取，結束碼為 1。
- **`docs/images` 請用 `SHOTS_HEADED=1` 擷取**：Windows 把無頭瀏覽器當成在背景執行的程式（排到省電核心），模擬執行緒只有約 0.3 倍速，膠囊會誠實寫出「0.3 倍速」；
  前景視窗才是使用者看到的速度。每張圖會等前一步的 toast 消失後才擷取。

---

## 15. i18n 稽核

`npm run audit:i18n`（`scripts/i18n-audit.mjs`）在真實瀏覽器中走過九十多種介面狀態（經典外觀、桌面工作區、手機），收集所有可見文字與
`aria-label`／`title`／`placeholder` 等屬性，任何不在允許清單上的 3 個字母以上英文單字都算洩漏，**必須維持 0**。
它也收集文字中的原始代號（`PS1:+`、`3V3_1`、`U1.PA5`…）到報告的 `rawRefs`（`I18N_RAWREF_STRICT=1` 時視為失敗）。
需要執行中的伺服器（`I18N_URL`，預設 `http://localhost:5173/`），報告寫到 `I18N_OUT`；`I18N_ONLY` 只跑名稱符合的狀態。
韌體輸出的 UART 位元組、暫存器名稱、檔名與按鍵名稱不是介面文字，不列入檢查（`translate="no"` 或腳本的 `SKIP_SELECTORS`）。

---

## 16. 貢獻規則

1. **不做假模擬。** 不寫特例程式碼讓某個範例「看起來會動」，不用動畫或錄好的資料代替模擬結果；做不到的就標示 `unsupported`／`partial`／`visual`／`not-yet`，並寫出缺少什麼。
   讀數不可信時顯示「—」並說明原因。
2. **誠實的狀態標示要跟著程式碼更新**：改了周邊或元件的能力，就更新 `PeripheralSupport` 說明或 `support.simulated`／`limits`（含中文），並執行 `npm run docs:support`。
3. **介面全中文（台灣用語）**：新的使用者可見字串一律經過 `t()`，中文放在自己的 `src/i18n/zh-TW/<區域>.ts`；課程、範例與使用者文件以繁體中文撰寫並遵守用語表。
4. **連貫性**：名稱用 `pinLabel`／`endpointName`，數字用 `src/instruments/format.ts`，狀態色用 `STATE_TONE`，問題經過問題模型，3D 標示經過場景橋接（[§11](#11-共用-ux-輔助函式與用語表)）。
5. **維持視覺語言**：沿用 Liquid Glass 元件組與 Tier S 面板配方，不增加 backdrop-filter；經典外觀的舊場景必須 0 差異。
6. **效能**：每幀不做 React 工作；大量資料用拉取查詢；模擬核心（`src/mcu`、`src/sim`）不依賴 DOM，必須能在 node 與 Worker 中執行。
7. **確定性**：模擬不讀牆鐘時間，不使用 `Math.random()`（需要雜訊時用固定種子）；同樣的輸入必須產生同樣的波形。
8. **TypeScript strict、沒有新的執行期相依套件**；沿用周圍程式碼的風格。
9. **測試**：新功能附測試；不放寬既有測試。提交前執行 `npm run typecheck` 與 `npm test`，改到介面時執行 `npm run audit:i18n` 與視覺回歸。
10. **授權**：ohmlet 為 MIT。第三方程式碼必須是相容授權；GPL 的工具（Unicorn、QEMU）只能當開發期的參考答案，不能打包或連結。新增隨產品散佈的第三方程式碼時，更新 [`docs/third-party-notices.md`](third-party-notices.md)。

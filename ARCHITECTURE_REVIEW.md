# ohmlet 架構審查報告（Phase 0）

> 對象：將 ohmlet 擴充為嵌入式電路模擬與學習平台之前的原始碼審查。
> 範圍：上游 `JENW1N/ohmlet` @ `02a5a72`，工作分支 `embedded-platform`。
> 方法：所有結論均以實際讀碼、實際執行（typecheck / vitest / vite build / Playwright 截圖 / 臨時探針腳本）驗證；
> **README 與 ARCHITECTURE.md 的敘述不被視為事實**，兩者與程式碼不一致之處列於 §5。

---

## 0. 摘要

| 項目 | 結論 |
|---|---|
| 可否在本機重現 | ✅ `npm install`、`tsc --noEmit`、`vite build` 全部成功；vitest 545/546 通過（唯一失敗為 wall-clock 效能斷言，單獨執行通過，見 §1） |
| 視覺基準 | ✅ 已建立跨平台視覺回歸工具 `scripts/visual-regression.mjs`，7 個場景基準截圖（headless Edge，Performance 模式，固定相機），自我比對差異 0.00000 |
| 授權 | ✅ 專案 MIT；131 個已安裝套件全為 MIT/ISC/Apache-2.0/BSD/Unlicense/CC-BY-4.0(dev-only)；無 GPL 系列 |
| 架構品質 | 高。資料驅動 catalog、純 TS 模擬核心（無 DOM 依賴，已有 Worker 先例）、程序化 3D 模型具一致設計語言 |
| 主要擴充障礙 | ① 模擬迴圈綁在主執行緒 rAF（8 ms 預算）② 每次編輯重建 SimEngine（等同斷電）③ validator 會**靜默丟棄**未知欄位 ④ 50 µs 固定步長無法解析 UART/I²C/SPI ⑤ 路由障礙物高度寫死 ⑥ 桌面玻璃濾鏡預算已滿 |
| 已發現缺陷 | SimEngine 忽略 board-rows（第 2 排以後的元件被當成 malformed 排除）等 6 項（§6） |
| MCU 引擎決策 | **自研 TypeScript ARMv7-M 直譯器 + STM32F103 周邊模型**，在 Web Worker 內與 MNA 求解器以虛擬時間 lockstep；以 Unicorn（僅開發期 oracle，不隨產品散佈）做指令級差分驗證，並以 ST 官方 HAL 原始碼編譯的真實 ELF 做整合驗收（§9） |

---

## 1. 驗證環境與基準

環境：Windows 11、Node v24.14.1、npm 11.11、Git 2.52、Edge 154、LLVM-MinGW clang 21.1.8（含 ARM/Thumb 後端與 ld.lld）、Python 3.9。

| 指令 | 結果 |
|---|---|
| `npm install` | 131 packages；`npm audit` 11 項（2 critical / 5 high / 4 moderate）**全在 dev 工具鏈**（vitest 2.1.9 內嵌的 vite 5 / esbuild 0.21 / tinypool），正式產物 0 項 |
| `npx tsc --noEmit` | 0 錯誤（約 12–15 s） |
| `npx vitest run` | 21 檔 / 546 測試；545 通過。失敗：`wire-router.test.ts`「routes 100 components + 200 wires in < 800ms」量到 1321 ms。單獨執行 464 ms 通過。原因：11 個 fork 共用 12 執行緒（4P+4E 混合架構）造成的時脈/排程競爭；該斷言為單次冷啟動 wall-clock 量測，屬**既有的環境敏感測試**，非回歸 |
| `npx vite build` | 成功（15 s）；主 chunk 1.29 MB（含 @anthropic-ai/sdk）；`verify.worker` 獨立 chunk |
| 視覺基準 | `node scripts/visual-regression.mjs capture` → `tests/visual/baseline/` 7 張；`compare` 自我比對 diffRatio 全為 0 |

既有 `scripts/*.mjs`（screenshot/closeups/modes/sweeps…）在 Windows **無法執行**：`spawn('npm')` ENOENT、`URL.pathname` 產生 `/C:/…`、`--use-angle=metal` 在 Windows 會退回 SwiftShader 軟體算圖。因此新建了跨平台的 `visual-regression.mjs`（`fileURLToPath`、Edge channel、無 metal 旗標、瀏覽器內 canvas 比對，無原生相依）。

---

## 2. 實際技術棧與建置

- **Vite 6.4.3 + React 18.3.1 + TypeScript 5.9（strict）**，three.js **0.170（不可升級：three-gpu-pathtracer 0.0.23 / three-mesh-bvh 0.7.8 綁定此版本）**，zustand 4.5.7，vitest 2.1.9（node 環境、forks pool）。
- 無 react-three-fiber；3D 為原生 three.js 單一大類別 `BreadboardScene`（`src/three/scene.ts`，4184 行）。
- `npm run dev|build|preview|typecheck|test`。無 vitest.config、無 ESLint/Prettier、**無任何 CI**（只有 `.replit`）。
- `@anthropic-ai/sdk: "latest"`（未鎖版，lockfile 解析為 0.104.1）。AI 功能需使用者自行填入 API Key；未填則完全不發出網路請求（符合「不要求付費雲端服務」）。

---

## 3. 授權審查

| 項目 | 授權 | 備註 |
|---|---|---|
| ohmlet 本體 | MIT © 2026 JENW1N | 擴充沿用 MIT |
| 21 個正式相依（含傳遞） | MIT ×19、Unlicense（fast-sha256）、MIT（xatlas-web） | 相容 |
| dev 相依 | MIT / ISC / Apache-2.0 / BSD-3 / CC-BY-4.0（caniuse-lite，不出貨） | 相容 |
| HDRI `public/hdri/studio_small_03_1k.hdr` | CC0（Poly Haven） | |
| 字型/圖示 | 系統字型堆疊；圖示為手繪 inline SVG | 無第三方資產 |
| **新增**：STM32F1 HAL（`firmware/vendor/stm32f1xx_hal_driver` v1.1.9） | BSD-3-Clause | 僅用於編譯測試/範例韌體；`firmware/vendor/` 不入庫，由 `firmware/scripts/fetch-vendor.mjs` 依固定 tag 取得 |
| **新增**：CMSIS Device F1 v4.3.5、CMSIS Core v5.9.0 | Apache-2.0 | 同上 |
| **新增**：Unicorn 2.1.4 | GPL-2.0 | **僅作開發期測試 oracle**（Python venv，不在 repo、不打包、不連結）；入庫的只有它產生的測試向量資料 |

結論：所有執行期程式碼保持 MIT 相容；GPL 模擬器（QEMU/Unicorn）不得打包進產品。

---

## 4. 原始碼架構（實際）

### 4.1 3D 渲染入口
- `App.tsx` 建立 `new BreadboardScene().mount(container)`。Renderer：`WebGLRenderer({antialias})`、pixelRatio ≤ 2、ACES 色調映射（exposure 1.05）、`PCFSoftShadowMap` 2048（**shadow 按需更新** `autoUpdate=false`）、`RoomEnvironment` PMREM（intensity 0.85）、主光 `0xfff0dd ×1.2` + 補光 `0xbcd0ff ×0.22`、胡桃木程序紋理桌面。
- **連續 rAF 渲染**（非 on-demand），分頁隱藏時暫停。
- 三種算圖模式（`src/three/render-modes/`）：Performance（純 raster）、Enhanced（HDRI + SAO + Bloom(threshold 1.6) + SMAA，桌機預設）、Studio（three-gpu-pathtracer 漸進路徑追蹤）。
- 元件外觀委派 `component-meshes.ts` 的 `dispatch(entry.visual.shape)`；builder 回傳 `{object, pinWorld, update}`，`update` 由遙測驅動（LED 發光、七段顯示）。

### 4.2 麵包板模型與接線
- `src/model/breadboard.ts`：1 unit = 0.1"；列 a–e z=3..7、f–j z=9..13（**中央溝槽為 2 單位，非實物 0.3"**）、電源軌 z=0,1,15,16。
- 網路：`S{col}T` / `S{col}B` / `R:{rail}`；多模組橫向串接時電源軌為同一網路，多排（board-rows）各自獨立並以 `1:a12` 前綴定址。
- 接線為「點孔 → 移動 → 點孔」（非拖曳），預覽路徑 = 實際路徑（`routeOne`）。導線為 `{id, from, to, color?}`，**無中繼點**，路徑完全由 `wire-router.ts`（2000 行、純幾何、可在 node 測試）決定。
- **0.6" 雙排排針**（Blue Pill）在本模型中恰好落在 c/h 列（距離 6 單位，且對稱於溝槽），可用既有 `'footprint'` placement 表達，已以探針腳本驗證 `at:'h10'` 得到 h10…h29 + c29…c10。

### 4.3 元件資料結構
- `CatalogEntry`（`src/model/catalog.ts`）：`type/label/category/placement('leads'|'dip'|'footprint'|'offboard'|'probe')/pins/footprintOffsets/internalBridges/bodyFootprint/params(ParamDef)/sim({device|chip|probe})/visual/doc`。31 種元件。
- **資料驅動**：validator、LLM schema/prompt、遮蔽、放置邏輯全部讀 catalog；新增型別只需 catalog + 模擬模型 + mesh。
- 陷阱：pin 名稱必須唯一（engine 以 Map 索引）；元件庫順序在 `src/ui/workspace/library-order.ts`：沒排名的元件排在該分類最後、不在 `CATEGORY_ORDER` 的分類排在清單最後，不會消失（`tests/library-order.test.ts` 要求每個新元件都明確排名）；搜尋結果先依符合程度排列（`rankByMatch`），使用順序只用來分高下相同的；單排 footprint 旋轉 90° 會讓所有腳落在同一 strip 造成靜默短路（validator 不檢查）。

### 4.4 電路求解器
- `src/sim/mna.ts`：稠密 Nodal Analysis，**僅 Norton 印記**（電源為 Thevenin→Norton，PSU rout 0.01 Ω），gmin 1e-9 S，LU 部分樞紐；矩陣與上次分解**逐位元相同**則重用 LU（因此可變 dt 是安全的，只有 RHS 改變不會重新分解）。
- 非線性：Newton-Raphson ≤ 40 次、1 µV 收斂、pn 結電壓限制；不收斂時保留最後迭代並警告一次。
- `src/sim/engine.ts`：每步 ①chips 讀上一步解並宣告 PinDrive ②元件 beginStep（後向 Euler 伴隨模型）③求解 ④endStep。`DEFAULT_DT = 50 µs`，固定步長。
- 行為晶片介面 `chip-api.ts`：`step(ctx)`、`readPin`、`drivePin({v, rout})`；推挽 50 Ω、開汲 25 Ω。**任何 STM32 GPIO 模式都可用單一 Norton 表示**（已逐一驗證，見 §10.4）。
- 實測效能（node，單執行緒）：blinky-555 2 µs/step（24× 即時）、date-display 63 節點 15.8 µs/step（3.2× 即時）；40 腳晶片透過字串 API 每步 I/O 約 1.8 µs。
- **模擬核心完全不依賴 DOM/three**，已有 `src/llm/verify.worker.ts` 在 Worker 內執行 SimEngine 的先例。

### 4.5 狀態管理與互動事件
- 單一 zustand store（`src/state/store.ts`，1472 行）實作 `src/state/types.ts` 契約。模擬迴圈在 **store.ts**（不是 App.tsx）：rAF、每幀 ≤ 8 ms 模擬預算、目標時間相對於 engine.time（落後即丟棄）、遙測每幀推給場景、React 10 Hz、示波器 1 kHz 取樣（以 `splice` 截斷的普通陣列，非 ring buffer）。
- **每次結構編輯與 undo/redo 都重建 SimEngine**（電容電荷、晶片狀態全部歸零）；只有 `runtime:true` 參數走 `setRuntimeParam`。
- Undo：`LayoutHistory` 保存不可變 layout 參考（上限 100，`param:*` 800 ms 合併）。
- 持久化：`localStorage['bb.layout']`（500 ms debounce，無 pagehide flush）、`bb.apiKey`、`bb.renderMode`。**載入時 `validateLayout` 重建物件，未知的頂層與元件欄位全部被丟棄**。

### 4.6 放置、拖曳、旋轉、吸附、刪除
- 放置：armed part → 全息投影 ghost（真實 mesh clone + shader）→ 點孔提交；遮蔽的孔會顯示紅色鎖頭與遮蔽者名稱。
- 吸附：射線打 y=0 平面，`HoleIndex.nearest`（滑鼠 0.55、觸控 0.9 單位）。
- 拖曳：在已選取元件上按下 → 群組全息 → `previewMove`/`commitMove`（全有或全無；導線不跟隨）；Shift+拖曳框選；儀器可在桌面上以 0.5 格拖動。
- 旋轉：R 鍵 / RotateButton（DIP 僅 0/180）。刪除：Delete/Backspace、長按動作表。
- **尚不存在**：腳位名稱 hover 提示、導線改色、導線中繼點/重新連接端點、複製/貼上、對齊、場景內錯誤標示、電源/接地網路著色、在 3D 中直接按按鈕。

### 4.7 測試與 CI
- 546 個 vitest 測試全在 node（無 jsdom、無 WebGL）。重要約束：`meshes.test.ts` 對**所有 catalog 型別**檢查「每零件 ≤ 4000 三角形、除 LED 外不得用 transmission、dispose 不得釋放共用資源」；`render-modes.test.ts` 對 `scene.ts` 原始碼做字面字串檢查（新 hook 必須是附加式）。
- 無 CI。

---

## 5. 文件與程式碼不一致（摘錄）

1. ARCHITECTURE.md 稱模擬迴圈在 App.tsx — 實際在 store.ts。
2. 「示波器 ring-buffered」— 實際為 `splice` 普通陣列。
3. 「chip supply 靜態檢查」— 實際在第一次求解後檢查，且只認 `VCC`/`VDD` 名稱。
4. 「吸附半徑 0.5」— 實際 0.55/0.9。
5. 「路由的軸向元件只有三種」— 實際 LED 與電容也被路由（standing）。
6. RENDER-MODES.md「bloom threshold 1.0」— 實際 1.6；DESIGN.md 提到的 `BatchedMesh` 不存在。
7. DESIGN「Scope 停靠右下卡片」— 實際為右側 360 px 全高面板。
8. ARCHITECTURE.md 稱 `rotateArmed` 可復原 — 實際只改模式；MoreSheet 稱「清空不可復原」— 實際可復原。
9. ARCHITECTURE.md 稱 CSS 變數在 styles.css — 實際在 `src/ui/kit/kit.css`。
10. MoreSheet About：「No microcontrollers」— 本次擴充後須更新。

---

## 6. 已發現缺陷（Phase 0 已確認，修正排入 Phase 1）

| # | 缺陷 | 證據 | 影響 |
|---|---|---|---|
| B1 | `SimEngine` 建構 rig 時漏了 `rows`（`engine.ts:152-155`） | 臨時腳本：`boardRows:2` 時 `1:a12` 上的電阻被回報 malformed 並排除 | 放在第 2 排以後的任何元件（含未來的 Blue Pill）不會被模擬 |
| B2 | PropertiesSheet 的 PinsGroup 同樣漏 `boardRows`（`PropertiesSheet.tsx:763`） | 讀碼 | 後排零件腳位顯示 incomplete |
| B3 | 單排 footprint 旋轉 90/270 可造成同 strip 短路而 validator 回報 ok | 探針腳本 | 新增模組（OLED、GY-521）時必須限制旋轉或補檢查 |
| B4 | 路由障礙物忽略 `bodyFootprint`、footprint 高度寫死 1.1 | `wires.ts:174-245` | 高的模組板導線會穿模 |
| B5 | 晶片 Norton 驅動接到「全域地」而非晶片 GND 腳；直接接地的輸出腳短路不會被偵測 | `engine.ts:443-450` | MCU GPIO 短路警告需另行實作 |
| B6 | `ListRow` 渲染 `<button role="listitem">` 覆蓋按鈕語意 | 讀碼 | a11y |

---

## 7. 可重用模組

- **完全重用**：MNA 求解器、元件模型（LED/二極體/BJT/MOSFET/RC…）、netlist union-find、validator、catalog 資料驅動機制、wire-router、全息放置/拖曳/旋轉/遮蔽 UX、undo 歷史、Liquid Glass UI kit（Sheet/Segmented/Stepper/Slider/Switch/Toast…）、三種算圖模式、程序化 mesh 工具（`shared.ts` 的 `metal/plastic/moldedEpoxy`、`etchedLabelMaterial`、`mergeStatic`、`gullWingLeg`、`legMesh`）、PSU 儀器的動態螢幕模式（CanvasTexture + key 閘控）、`verify.worker.ts` 的 Worker 模式。
- **附加式擴充點**：`registerChip`（MCU 板、數位裝置）、`dispatch(visual.shape)`（新 mesh）、`setTelemetrySink`/`setLayoutLoadedSink`（sink 模式）、catalog 選用欄位。

---

## 8. 技術限制與風險

| 風險 | 說明 | 對策 |
|---|---|---|
| R1 主執行緒預算 | 72 MHz 韌體在 8 ms/幀預算內不可能即時 | 模擬移入 Web Worker（§10.5） |
| R2 時間解析度 | 50 µs 步長無法表示 115200 baud（8.7 µs/bit）或 100 kHz I²C | 事件驅動 lockstep + 邏輯網路層（§10.3–10.4） |
| R3 重建即斷電 | 每次編輯重建 engine | MCU 狀態放在 coordinator，依元件 id + 韌體 hash 熱接線保留 |
| R4 欄位被丟棄 | validator 重建物件 | 韌體與工作區設定不放進 `CircuitLayout`；專案檔用外層封套（§10.6） |
| R5 三角形預算 | 每零件 ≤ 4000 | Blue Pill 以合併幾何 + 低段數引腳設計（目標 ≈ 2.8k），不放寬既有零件的限制 |
| R6 玻璃濾鏡預算 | 桌面已達 4 個 backdrop-filter 上限 | 新面板使用 Tier S（無 blur 的近不透明玻璃），不新增 lens |
| R7 視覺基準 | 預設佈局改變會使桌面截圖不同 | 視覺回歸分成「經典佈局場景（必須 0 差異）」與「工作區新場景（新基準）」 |
| R8 three.js 版本鎖定 | 升級會改變 Studio 算圖 | 不升級任何算圖相依 |
| R9 CPU 正確性 | 自研指令集模擬器的錯誤會造成難以察覺的韌體異常 | Unicorn 差分模糊測試 + 真實 HAL 韌體整合測試 + 主機/目標差分自測韌體 |

---

## 9. MCU 韌體模擬引擎評估

需求：真正執行 STM32CubeIDE 產生的 Cortex-M3 ELF；在瀏覽器內、無需安裝、無付費雲端；與類比求解器在**可重現的虛擬時間**內 lockstep 交換 GPIO 狀態；授權與 MIT 相容。

| 方案 | 授權 | 瀏覽器內執行 | STM32F103 周邊 | 與外部電路 lockstep | 評估 |
|---|---|---|---|---|---|
| **Renode**（Antmicro） | MIT | ✗（.NET 原生程式，需另行安裝並以 socket 橋接） | 有 `stm32f103` 平台描述，常用周邊有模型 | 以量子（quantum）同步，需自行撰寫外部協同模擬橋接；每次 GPIO 交換都跨行程 | 適合作為**選用的桌面後端**，不適合作為預設（需安裝、非瀏覽器、延遲大） |
| **QEMU** 上游 | GPL-2.0 | 僅實驗性 wasm 移植 | 上游沒有 STM32F103 機器（有 STM32F100 `stm32vldiscovery`、F2/F4 等，周邊覆蓋有限）；舊分支 `beckus/qemu_stm32`、xPack QEMU Arm 有 F103 但已停滯 | 無原生虛擬時間 GPIO co-sim 介面 | GPL 不能打包；不採用 |
| **Unicorn**（unicorn.js / wasm） | GPL-2.0 | 有 wasm 版 | **只有 CPU，沒有任何周邊** | 需自行實作全部周邊 | 授權不相容打包；**採用為開發期測試 oracle** |
| **rp2040js / avr8js**（Wokwi） | MIT | ✓（純 TS） | RP2040 / AVR，**ARMv6-M（Cortex-M0+）**，缺 Thumb-2 32 位元指令、IT 區塊、除法、位元欄位等 | ✓ | 證明「純 TS 指令級模擬 + 虛擬時間」可行且足夠快；ISA 不足以跑 Cortex-M3 |
| **自研 TS ARMv7-M + STM32F103 周邊**（採用） | MIT | ✓（Worker） | 依 RM0008 逐一實作，未實作者明確標示 | ✓（同一行程、同一虛擬時鐘，邊緣以週期精確時間戳） | 開發量最大，但唯一同時滿足全部硬性需求的方案 |

**決策**：自研 `src/mcu/`（ARMv7-M 直譯器 + STM32F103 SoC），理由：
1. 瀏覽器內、零安裝、MIT；2. 與 MNA 求解器在同一 Worker、同一虛擬時鐘，GPIO 邊緣具週期精度；3. 可決定性重現（相同輸入 → 相同波形）；4. 每個周邊的支援狀態可誠實標示。

**驗證策略（禁止假模擬）**：
- 指令級：clang 整合組譯器組譯的指令測試程式 + 以 Unicorn（Cortex-M3 模式）產生的隨機指令差分向量（入庫為資料）。
- 程式級：同一份 C 自測程式分別編譯為主機（x86）與 Cortex-M3（-O0/-O2/-Os），比對輸出。
- 整合級：以 **ST 官方 HAL v1.1.9 + ST 官方 GCC startup** 用 clang 編譯的 ELF（已驗證可編譯，與 CubeIDE 產物結構相同），在模擬器中執行並以電路量測斷言（例如 LED 網路 1 Hz 方波）。
- 本機無 `arm-none-eabi-gcc`（GCC 產生的指令序列與 clang 不同）；以 Unicorn 隨機向量覆蓋全部 ISA 編碼類別來彌補，並在文件中註明「CubeIDE(GCC) ELF 的實機驗收需使用者提供」。

Renode 橋接列為後續可選後端（`McuDevice` 介面已預留：任何實作該介面的後端都可接入 coordinator）。

### 9.1 調研補充（附來源，2026-10 查證）

| 方案 | 關鍵事實 | 來源 |
|---|---|---|
| Renode 1.17 `stm32f103.repl` | MIT（CPU 函式庫 tlib 為 LGPL-2.1）；**F103 平台沒有 RCC、FLASH 介面、ADC、SPI、IWDG 與 bit-band**；CubeMX `SystemClock_Config` 會卡住（issue #652）；計時器時脈寫死 10 MHz | github.com/renode/renode/blob/master/platforms/cpus/stm32f103.repl、renode/renode#652、External Control API 文件 |
| QEMU 上游 11.1 | 僅 `stm32vldiscovery`（F100），除 USART/SPI 外皆為 unimplemented；10.1 起的 Emscripten 移植為實驗性且需 pthreads/SharedArrayBuffer | qemu.org/docs/master/system/arm/stm32.html、wiki.qemu.org/ChangeLog/10.1 |
| lcgamboa/qemu `picsimlab-stm32` | 目前最完整的開源 F103 暫存器模型（GPL-2.0，PICSimLab 使用），未有 WASM 版 | github.com/lcgamboa/qemu（branch picsimlab-stm32） |
| Unicorn 2.1.4 | GPL-2.0、純 CPU（無 NVIC/周邊）；unicorn.js 為 TCI 直譯 | github.com/unicorn-engine/unicorn、AlexAltea/unicorn.js |
| rp2040js（Wokwi） | MIT、TS，但只有 ARMv6-M（無 IT/CBZ/UDIV/TBB/LDREX…）；其 cycle 計數 + alarm 清單架構可作為範本 | github.com/wokwi/rp2040js |
| stm32f1-emu（Rust→WASM，MIT） | 2026-08 新專案、自述功能廣；周邊以 2 萬指令為批次推進、PWM 以佔空比值輸出（非邊緣）、CPUID 誤設為 M4 | github.com/danish9661/STM32F1-emulator |
| emul（Apache-2.0，TS） | ARMv7E-M + 求解器 lockstep，設計最接近；僅支援 F429/F746 | github.com/ChernihivPolytechnicNationalUniversity/emul |
| Wokwi Blue Pill | 閉源；文件自述無 DMA/IWDG/PWR/RTC、ADC 部分 | docs.wokwi.com/parts/board-stm32-bluepill |

**HAL 啟動依賴（模擬器必須正確重現）**：RCC_CR 重置值 HSION/HSIRDY=1；HAL 以 **bit-band 別名**寫 PLLON/HSION；`HAL_RCC_ClockConfig` 會**回讀** FLASH_ACR LATENCY 並輪詢 SWS==SW；`HAL_InitTick` 依賴 SysTick 中斷；HAL UART 以 LDREX/STREX 對**周邊暫存器**做原子操作（STREX 必須成功）；`HAL_GPIO_Init` 在輸入模式寫 BSRR/BRR 選擇上下拉（ODR 必須在輸入模式保留）；ADC 校準輪詢自清除的 RSTCAL/CAL；**DBGMCU_IDCODE 依勘誤表 DocID14574 §2.3 在未連接除錯器時由使用者程式讀為 0**。

**GPIO 電氣參數（DS5319）**：標準 I/O VIL ≤ 0.28(VDD−2)+0.8、VIH ≥ 0.41(VDD−2)+1.3；**FT I/O VIL ≤ 0.32(VDD−2)+0.75、VIH ≥ 0.42(VDD−2)+1**；遲滯 ≥ 200 mV（標準）；RPU/RPD 30/40/50 kΩ；VOL ≤ 0.4 V @ 8 mA（≈50 Ω）；絕對最大：非 FT 腳 VIN ≤ 4.0 V、FT 腳 ≤ VDD+4.0 V、每腳 ±25 mA、注入電流 ±5 mA；PC13–PC15 ≤ 3 mA、≤ 2 MHz。FT 腳（LQFP48）：PA8–PA15、PB2–PB4、PB6–PB15。

---

## 10. 最小侵入式擴充方案

### 10.1 模組佈局（新增為主）

```
src/mcu/                       純 TS、無 DOM（node 測試與 Worker 共用）
  core/        types.ts scheduler.ts cpu-api.ts（契約） cpu.ts …（ARMv7-M 核心、NVIC/SCB/SysTick/DWT/ITM）
  stm32f1/     periph-api.ts（契約） soc.ts rcc.ts gpio.ts afio.ts exti.ts usart.ts tim.ts i2c.ts spi.ts adc.ts dma.ts …
  loader/      elf.ts bin.ts ihex.ts
  pins.ts firmware.ts mcu-api.ts registry.ts（契約）
src/sim/coordinator/           Simulation Coordinator、MCU 板轉接、記錄器、inline/worker host
src/sim/digital/               邏輯網路層 + 數位裝置契約與模型（SSD1306、MPU6050…）
src/three/meshes/boards.ts …   Blue Pill / 模組的程序化 3D 模型
src/ui/workspace/ src/ui/embedded/ src/ui/lessons/
firmware/                      build.mjs、common/、projects/*（測試與範例韌體原始碼）、dist/*.elf（入庫）
```

### 10.2 對既有核心檔案的修改（全部為附加式）

| 檔案 | 修改 |
|---|---|
| `src/model/types.ts` | `ComponentTelemetry` 新增選用欄位 `sub/mcu/display/values/rgb/leds/text` 與 `McuTelemetry`、`DisplayTelemetry`（✅ 已完成） |
| `src/model/catalog.ts` | 新類別 `mcu/sensor/module/motor`；選用欄位 `support/pinInfo/subcircuit/mcu/digital/meta/obstacleHeight/supplyPins`（✅ 已完成）；新增零件條目 |
| `src/sim/engine.ts` | 修 B1；`chipOf(id)`、`nodeOf(ref)`、`nodeVoltages`、`sample()`；subcircuit（板上 LED/上拉/穩壓器）實例化；`setRuntimeParam` 退回給晶片 |
| `src/sim/devices.ts` | `registerDevice` 註冊表；新增 LDO 穩壓器等模型 |
| `src/sim/chip-api.ts` | 選用 `ChipInstance.setRuntimeParam/fillTelemetry`、`ChipStepCtx.readPinAt/drivePinAt/reportIssue` |
| `src/state/store.ts` | 模擬迴圈改為呼叫 `SimHost`（行為與既有迴圈對等）；韌體/工作區另存 |
| `src/three/component-meshes.ts` | `dispatch` 新增數個 case |
| `src/three/internal/wires.ts` | 障礙物使用 `bodyFootprint` 與 `obstacleHeight` |
| `src/three/scene.ts` | 附加 hook：腳位名稱提示文字、物件 hover（不改動 render-modes 測試檢查的字面行） |
| `src/ui/sheets/PartsSheet.tsx` | 新類別（✅）、搜尋/篩選/收藏/支援等級徽章 |
| `src/App.tsx` | 掛載工作區與新面板 |

### 10.3 時間模型與 lockstep

- MCU 以 HCLK 週期計時（float64 整數），由 SoC 的時鐘樹換算成秒；韌體切換時鐘（HSI 8 MHz → PLL 72 MHz）時重新定基。**MCU 時間 = 模擬時間**。
- Coordinator 每次推進：`tNext = min(目標, 上次類比步 + 50 µs, 下一個裝置事件)` → 各 MCU `runUntil(tNext)`；**若 MCU 改變了連到「類比網路」的腳位驅動，MCU 在該指令邊界停下**（精確邊緣），coordinator 以 `dt = 邊緣時間 − 上次類比時間` 推進 SimEngine（最小步長 0.5 µs，更密的邊緣以工作週期加權平均）。
- 沒有 MCU/數位裝置時退化為固定 `DEFAULT_DT` 步進，**與既有行為逐位元相同**（既有 546 個測試必須不變）。
- 所有計時（SysTick、TIM、UART 位元時間、I²C/SPI 時脈）都由同一週期計數器排程（`EventQueue`），與瀏覽器幀率無關；畫面只是取樣觀看結果。

### 10.4 混合訊號三層模型（電氣 / 邏輯 / 協定分離）

1. **電氣層**：既有 MNA。MCU 腳位一律以 Norton 印記：浮接/類比 = 無驅動；上拉/下拉 = {VDD|0, 40 kΩ}；推挽 = {VDD|0, 50 Ω}；開汲 = {0, 50 Ω} 或釋放。輸入以 STM32F1 資料手冊門檻（VIL = 0.28(VDD−2)+0.8、VIH = 0.41(VDD−2)+1.3）加遲滯判定。過壓（非 FT 腳 > VDD+0.3 V）、浮接輸入、輸出短路/過流（> 25 mA）產生分級警告。
2. **邏輯層**：只由 MCU 腳、數位裝置腳、接到固定電壓軌的電阻（上拉/下拉）與電源軌組成的網路，視為「可邏輯解析」：驅動改變時立即以 wired-AND/強弱驅動解析（含競爭 → X、無上拉 → 浮接），並同步通知監聽者。因此 I²C/SPI/UART 能以真實匯流排速度、位元級運作而不需要逼迫類比步進。含其他元件（LED、電容、電晶體…）的網路一律走電氣層解析。
3. **協定層**：周邊與裝置在腳位邊緣上實作各自的狀態機（START/STOP/ACK、移位暫存器）。MCU 周邊與感測器之間**沒有任何函式直呼**——接線錯誤（缺上拉、SDA/SCL 互換、位址錯）會產生真實的症狀。

### 10.5 Worker 架構
- `SimHost` 介面（`src/sim/coordinator/api.ts`）：`load/setFirmware/start/pause/reset/stepTime/mcu*/setRuntimeParam/uartSend/setLogicChannels/query`；回呼 `onFrame(SimFrame)`。
- `WorkerSimHost`（瀏覽器）與 `InlineSimHost`（node 測試 / Worker 不可用時的後援）執行同一份 `SimulationCoordinator`。
- 主執行緒只接收快照（≤ 每幀一次），React 狀態維持 ≤ 10 Hz；示波器/邏輯分析儀以「拉取視窗」方式向 Worker 查詢，不把大量樣本推進 React。
- 不使用 SharedArrayBuffer（未設定 COOP/COEP）。

### 10.6 專案檔格式
- 既有裸 `CircuitLayout`（version 1）照常可匯入。
- 新封套：`{ "format": "ohmlet-project", "formatVersion": 1, "app": {...}, "layout": CircuitLayout, "firmware": { [componentId]: { name, format, sha256, data(base64) } }, "workspace"?: {...}, "instruments"?: {...} }`。
- 讀取：依 `formatVersion` 逐版遷移（migrations 陣列）；未知的較新版本拒絕並說明。韌體 blob 存 IndexedDB（避開 localStorage 5 MB 上限），layout 仍走既有 autosave。

### 10.7 UI 工作區
- 桌面寬螢幕（≥ 1100 px、精確指標）啟用工作區：左（元件庫/範例/課程）、右（屬性/Pinout/電氣資訊/MCU 狀態/警告）、下（UART 終端機/邏輯分析儀/示波器/模擬日誌）；面板漂浮於全幅 3D 畫布之上、可收合與調整尺寸、配置存 `localStorage['bb.workspace']`。
- 新面板使用 Tier S 玻璃（無 backdrop-filter）以維持既有濾鏡預算；手機維持既有 Sheet 模式並新增「Lab」分頁。

### 10.8 測試策略
- 既有 546 測試必須持續通過（效能斷言另以 `vitest.config.ts` 限制平行度）。
- 新增：CPU 指令/差分/例外測試、SoC 周邊暫存器測試、以真實 ELF 的整合測試（GPIO/EXTI/UART/TIM-PWM/I²C/SPI/ADC）、coordinator lockstep 決定性測試、儀器量測測試、專案存讀測試、mesh 預算測試。
- 視覺：經典佈局場景必須與 Phase 0 基準 0 差異；新零件/工作區建立新基準。

### 10.9 視覺品質保證
- 新零件全部程序化建模，沿用 `shared.ts` 材質工廠與調色盤、`etchedLabelMaterial` 雷射蝕刻字、真實比例（mm→unit）、Pin 1 標記、無共面面、無 transmission、無點光源（LED 以 emissive + additive sprite），每零件 ≤ 4000 三角形。
- 每個新 mesh 都以視覺回歸工具在三種算圖模式截圖檢查。

---

## 11. 交付階段

| 階段 | 內容 | 驗收 |
|---|---|---|
| Phase 0 | 本報告、基準、授權、契約檔、韌體建置系統 | ✅ |
| Phase 1 | Blue Pill 3D 模型與 Pinout、LED/按鈕/電阻/電源/GND、接線、屬性面板、engine 修正與 hook | 視覺與電氣拓樸正確的 STM32 接線實驗 |
| Phase 2 | ARMv7-M 核心、ELF/BIN 載入、RCC/GPIO/AFIO/EXTI/SysTick/NVIC、coordinator + Worker、韌體面板 | 真實 HAL Blink ELF 控制虛擬 LED |
| Phase 3 | USART + 終端機、TIM/PWM、I²C、SPI、ADC、DMA、邏輯分析儀/解碼器、示波器強化、萬用電表 | 對應韌體整合測試 |
| Phase 4 | MPU6050、SSD1306、HC-SR04、DHT22 等數位裝置與 3D 模型 | 韌體讀感測器/驅動顯示器 |
| Phase 5 | 課程、ERC、範例、UI 精修、效能、文件 | 全部測試 + 視覺回歸 |

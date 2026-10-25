# ohmlet — Architecture

A Crumb-style **3D breadboard circuit simulator** in the browser:
real-time hybrid analog (MNA) + digital (behavioral IC) simulation,
JSON import/export, and a Claude-powered "describe a circuit → it appears on
the board" panel — extended into an **embedded-systems lab**: an STM32F103C8
"Blue Pill" executes real Cortex-M3 firmware (ELF / BIN / HEX) in lockstep
with the circuit, with instruments (UART terminal, logic analyzer +
protocol decoders, oscilloscope, multimeters), an electrical rule checker,
guided lessons accepted by the real simulation and an example library. The
UI is Traditional Chinese (Taiwan) by default, English on request.

Decisions (locked, upstream): Three.js 3D rendering · custom MNA solver +
event-driven chips · Claude called directly from the browser with the user's
API key (`claude-opus-4-8`). The upstream decision "no MCU" is superseded by
the embedded extension below (§ Embedded lab); every upstream circuit still
simulates bit-identically (`tests/sim/legacy-equivalence.test.ts`) and the
English classic chrome is pixel- and behaviour-identical to the pre-extension
UI (§ UI shell and the classic chrome).

User / developer documentation (zh-TW): `README.md`, `docs/user-guide.md`,
`docs/firmware-guide.md`, `docs/developer-guide.md`, `docs/support-matrix.md`
(generated from the code); English overview: `README.en.md`.

## Stack

Vite + React 18 + TypeScript (strict) · Three.js (vanilla, no react-three-fiber)
· zustand · @anthropic-ai/sdk · vitest · Playwright (browser scripts only).
`npm run dev|build|typecheck|test`; the full script list is in
`docs/developer-guide.md` §1. Workers build as ES modules (`worker.format: 'es'`).

## Directory map & ownership

| Path | Owner | Contents |
|---|---|---|
| `src/model/types.ts` | CONTRACT | shared types (layout, holes, telemetry) |
| `src/model/breadboard.ts` | CONTRACT | topology, hole parsing, coordinates, net ids, footprints |
| `src/model/catalog.ts` | CONTRACT¹ | every component definition (pins, params, docs, body footprints) |
| `src/model/occlusion.ts` | CONTRACT | body occlusion: which holes a molded body covers beyond its pins |
| `src/model/validate.ts` | **llm agent** | layout validator (schema + placement + electrical rules) |
| `src/sim/chip-api.ts` | CONTRACT | chip↔solver bridge + chip registry |
| `src/sim/netlist.ts` `mna.ts` `devices.ts` `engine.ts` | **sim-core agent** | union-find nets, MNA solver, analog devices, engine |
| `src/sim/chips/all.ts` | CONTRACT | barrel importing `all-a` + `all-b` |
| `src/sim/chips/all-a.ts` + gates/flipflops/timer555/opamp | **chips-A agent** | 7400/04/08/32/86, 7474, NE555, LM358 |
| `src/sim/chips/all-b.ts` + counters/decoders | **chips-B agent** | CD4017, CD4026, CD4511, 74193, CD4040 |
| `src/three/scene-api.ts` | CONTRACT | scene interface |
| `src/three/scene.ts` (+ `src/three/internal/*`) | **scene agent** | scene, board mesh, picking, wires, ghost, edit drags |
| `src/three/render-modes/*` | **render-modes agent** | Performance / Enhanced / Studio engine (spec: its `RENDER-MODES.md`) |
| `src/three/component-meshes.ts` (+ `src/three/meshes/*`) | **meshes agent** | procedural component visuals |
| `src/state/types.ts` | CONTRACT | store interface |
| `src/state/store.ts`, `src/state/history.ts`, `src/App.tsx` | **glue agent** | real store, undo history, app layout, sim loop |
| `src/ui/*` | **ui agent** | panels (palette, properties, scope, LLM, toolbar...) |
| `src/llm/*` | **llm agent** | Claude client, schema, prompt builder, generate+repair |
| `tests/*.test.ts` | **tests agent** | vitest suites |
| `examples/*.json` | **demos agent** | curated example circuits |

¹ Chip agents may correct the **pin name arrays of their own chips** in
`catalog.ts` after verifying against datasheets (use the Edit tool with small,
surgical replacements — another agent may be editing other entries of the same
file concurrently). Everything else in catalog.ts is fixed.

**Never modify files owned by another agent.** If a contract needs changing,
return the request in your `contractRequests` output instead.

### Embedded-lab modules (added by the extension)

| Path | Contents |
|---|---|
| `src/mcu/core/` | ARMv7-M (Cortex-M3) interpreter: decode / execute, exception model, NVIC / SCB / SysTick / DWT, cycle-keyed event scheduler, disassembler; contract `cpu-api.ts` |
| `src/mcu/stm32f1/` | STM32F103C8 SoC (`soc.ts`) + peripheral plug-ins (`periph-api.ts`); the honest support table (`peripherals.ts`) |
| `src/mcu/loader/` | ELF (by LMA) / Intel HEX / raw BIN loaders, SHA-256 |
| `src/mcu/mcu-api.ts`, `registry.ts`, `pins.ts`, `firmware.ts` | `McuDevice` contract, model registry, GPIO electrical parameters |
| `src/sim/coordinator/` | lockstep coordinator, MCU board adapter (`mcu-board.ts`), recorders, stimulus, firmware `checks` runner, Worker / inline hosts; contract `api.ts` |
| `src/sim/digital/` | logic-net layer (`nets.ts`) + digital-device contract (`api.ts`) |
| `src/sim/models/*.model.ts` | part-family simulation plug-ins (analog devices, chips, digital devices) |
| `src/sim/erc/` | electrical rule checker (rule table `api.ts`) |
| `src/instruments/` | protocol decoders, triggers, measurements, auto-fit, VCD / CSV export, the shared unit formatter (`format.ts`) — pure |
| `src/model/parts/*.parts.ts` | part-family catalog plug-ins (collected by `import.meta.glob`) |
| `src/three/meshes/ext/*.mesh.ts` | part-family mesh plug-ins (`registerMeshBuilder`) |
| `src/state/lab.ts`, `lab-types.ts`, `project.ts`, `firmware-store.ts` | embedded-lab store (firmware bindings, MCU frames, instruments, workspace prefs), project file v1, IndexedDB firmware blobs |
| `src/ui/chrome/` | the new shell: run capsule, status pill, run control + state colours, global key routing, shortcuts, onboarding, classic-chrome switch (`legacy.ts`) |
| `src/ui/workspace/` | desktop workspace: library / examples / lessons panel, inspector frame, instrument tray, hover chip + endpoint names, probe menu, firmware drop, scene bridge |
| `src/ui/embedded/` (+ `instruments/`) | MCU panel + built-in firmware picker, pinout, problems model + list, ERC panel, UART terminal, logic analyzer, scope, readings, simulation log, glossary |
| `src/ui/lessons/`, `src/lessons/` | lesson UI (browser, coach, check results, handout / receipt); lesson contract, registry, acceptance engine (worker), diagnosis, progress |
| `src/ui/perf/` | performance-diagnostics overlay (off by default) |
| `src/i18n/` | `t()` / `tc()`, part texts, runtime-message translation; zh-TW dictionaries per area |
| `src/firmware-assets.ts` | `firmware/dist/*.elf` as lazily fetched assets |
| `firmware/` | clang + lld build system, CubeIDE-style HAL projects, prebuilt images (`dist/`, committed) |
| `examples/embedded/` | example projects (`*.ohmlet.json`) generated from descriptors by `scripts/build-examples.mjs` |
| `scripts/` | visual regression, i18n audit, acceptance E2E, UX replays (`ux-e2e/`), example / support-matrix generators |
| `tools/cpu-oracle/` | Unicorn-based CPU vector generator (development-time only, GPL, never bundled) |

## Breadboard geometry (the coordinate system everyone shares)

Boards come in three size presets (`BOARD_SIZES` in `src/model/types.ts`,
keyed by `BoardSizeId`):

| id | label | columns | rail holes | points |
|---|---|---|---|---|
| `half` | Half | 1..30 | 0..24 | 400 |
| `standard` | Standard | 1..63 | 0..49 | 830 |
| `labxl` | Lab XL | 1..126 | 0..99 | 1660 |

**The 2-D board grid.** Identical modules of one preset gang into a 2-D
rig: `BoardConfig = { size: BoardSizeId; count: number; rows: number }`
(types.ts), carried on the layout as the optional `boardCount` (modules
wide, 1..`MAX_BOARD_COUNT` = 6; absent = 1) and `boardRows` (board-rows
deep, 1..`MAX_BOARD_ROWS` = 4; absent = 1) fields. The two axes behave
differently, mirroring a real bench:

- **Across a row (modules, side by side):** column numbering and rail
  indices are **continuous** — module 2 of a `'standard'` rig starts at
  column 64; total columns = cols × count, total rail holes =
  railHoles × count — and each of the four power rails stays ONE bused net
  along the whole row (like ganged lab stations), so `netIdForHole` needs
  no module awareness. The one physical rule is the **seam rule**: a rigid
  dip/footprint package may not straddle the gap between two modules —
  `spansSeam(holes, config)` — enforced by the validator, store placement
  and board-size/count switches; wires and flexible leaded parts cross
  seams freely. Module helpers: `moduleOfCol`, `moduleOfRailIndex`,
  `moduleSeamXs` (plan-view seam x positions for the scene).
- **Front-to-back (board-rows):** each board-row is a COMPLETE rig row with
  its own four power rails. Hole refs address rows with an optional
  0-indexed prefix — the front row (row 0) is bare (`a12`, `top+5`; full
  back-compat), deeper rows are `1:a12`, `2:top+5`, `3:j63` (`0:` parses as
  a non-canonical alias; `formatHole` always emits bare row 0). Row r is
  offset in plan z by r × `BOARD_ROW_PITCH` (19.5 units = one row's full
  mesh depth — rows abut at a thin molded seam); x is unchanged. Unlike
  the side-by-side bus, rails on DIFFERENT
  board-rows are **independent nets** (jumper power between rows), which
  `netIdForHole` encodes by namespacing nets per row (`2:S12T`, `1:R:top+`;
  row 0 stays unprefixed). A rigid package can never span board-rows
  (`spansBoardRows`); wires and flexible leaded parts may.

Every size-aware helper accepts `BoardConfig | BoardSizeId` (a bare size
id = a single board, via `asBoardConfig`). A layout's board is
`layout.board` (absent = `'standard'`; use `boardOf(layout)`) and its full
rig is `boardConfigOf(layout)` (hardened — a malformed `boardCount` /
`boardRows` can never produce a bogus rig; read rows with `boardRowsOf`).
The deprecated `NUM_COLS` / `RAIL_HOLES` / `BOARD_EXTENTS` constants remain
as the single-standard-board values. Full details + helpers in
`src/model/breadboard.ts` — always use its helpers, never re-derive.

- Terminal strips: columns **1..cols** × rows **a..j**. Rows a–e are the top
  block, f–j the bottom block, center channel between e and f.
  Connectivity: one net per (column, block) — `a12..e12` are one net (`S12T`),
  `f12..j12` another (`S12B`).
- Power rails: 4 horizontal rails (`top+`, `top-`, `bot-`, `bot+`),
  `railHoles` holes each, each rail is ONE continuous net.
- Hole refs (DSL strings): `"a12"`, `"j63"`, `"top+5"`, `"bot-12"`, plus
  the optional board-row prefix `"1:a12"`, `"2:top+5"` (0-indexed; row 0 is
  written bare). `parseHole()` is SYNTAX-level: it accepts the maxima
  across **rigs** (columns 1..756, rail index 0..599 — the `'labxl'`
  preset × `MAX_BOARD_COUNT` modules — and board-row prefixes
  0..`MAX_BOARD_ROWS`−1); whether a hole exists on a given rig is
  `isHoleOnBoard(hole, config)`. Size-aware helpers (`allHoles`,
  `boardExtents`, `dipHoles`, `footprintHoles`, `componentPinHoles`) take a
  trailing `config: BoardConfig | BoardSizeId = 'standard'` argument.
- Plan units: 1 unit = 0.1" pitch; x = along board, z = across, y = up.
  Board top surface is y = 0. `holePosition()` gives {x,z}. The geometry
  formulas are size-independent (strip x = col; rail hole i at
  x = 2.5 + i + ⌊i/5⌋, grouped in 5s) — larger boards just extend the same
  lattice rightward; only the bounds differ.
- **DIP rule**: `at` = pin 1's hole, must be row `f`. Pins 1..N/2 run
  left→right along row f; N/2+1..N right→left along row e (`dipHoles()`).
- **Rotation** (dip/footprint packages only): the optional
  `rotation: 0 | 90 | 180 | 270` on a component is the in-plane package
  rotation, clockwise in plan view, about the `at` anchor. DIPs accept only
  0|180 (90/270 would put every pin pair in one strip column) — 180 spins
  the package IN PLACE: same holes, `at` still names the row-f hole at the
  package's left end, but the pin walk reverses (`dipHoles`). Footprints
  rotate their offset deltas in quarter turns (`rotateOffsetDelta` /
  `footprintHoles`). Leaded parts orient by their hole placement;
  instruments have no orientation.
- **Body occlusion** (`src/model/occlusion.ts`): a part's molded body
  covers holes beyond its own pins, from `CatalogEntry.bodyFootprint`
  (`'auto'` = the pin bounding rect; explicit plan-rects mirror the
  rendered meshes). A covered hole takes no other pin and no wire end —
  errors in the validator, a named-coverer toast in the app, and per-part
  warnings in the LLM prompt. Rotation-aware: the rect rotates with the
  pins. Whenever a part's visual extents change, `bodyFootprint` and the
  router obstacle rects must be re-synced to the new geometry (DESIGN §4b).
- Off-board units (power supply, function generator, batteries, bench
  motors and driver modules) have terminals, not holes. Wire endpoints use
  `"PS1:+"` form. Each type may declare its own bench geometry,
  `CatalogEntry.offboard` = `{ terminalPitch?, terminalOffset?, rect? }`
  (plan units relative to the body anchor); every absent field keeps the
  legacy instrument value (pitch 2.5, terminal 0 at anchor + (2, 2), the
  6.5 × 4.5 rect), so a part without it renders, routes and validates
  exactly as before. Render positions come from
  `offboardTerminalPosition(slot, pinIndex, pos?, geom?)`: terminal i sits at
  anchor + (ox + pitch·i, oz) on the unit's front face. `slot` is the unit's
  default-shelf slot — the off-board components numbered in layout order,
  each advancing the counter by `offboardSlotSpan(geom)` (1 for a legacy
  unit, so slot = index in a legacy layout; 1.5 for a unit deeper than 4.5 —
  the ULN2003 / L298N boards, the 28BYJ-48, the NEMA 17), so
  `OFFBOARD_SHELF_CLEARANCE` = 2.5 of free bench stays in front of every
  terminal row (the router runs each terminal wire 1.5 straight out of the
  front face). Every consumer (scene, router obstacles, store auto-nudge,
  E2E hooks) advances the slot the same way. A unit with its own body is
  right-aligned on the shelf to x = −3.5 (`OFFBOARD_SHELF_RIGHT`, its rect
  ending 3 units left of the board) with its back edge on the legacy back
  line (slot·7 − 2); a legacy unit keeps x = −10, z = slot·7. Units are
  MOVABLE: an optional `pos: {x, z}` on the component (plan units,
  0.5-grid) overrides the shelf as the body anchor
  (`offboardBodyPosition(slot, pos?, geom?)`); absent `pos` = the shelf, so
  existing layouts render identically, and `pos` round-trips export/import.
  `offboardBodyRect(slot, pos?, geom?)` is the unit's plan footprint (legacy:
  the 6.5-wide enclosure + terminal-post apron; with a declared `rect`: x from
  the anchor to anchor + w, the front edge 0.5 in front of the terminal row,
  reaching d back — it holds the whole unit, body, leads and terminals;
  `OFFBOARD_BODY_HEIGHT` ≈ 4 is its obstacle height). The validator rejects
  a `pos` off the 0.5 grid, a body rect intersecting the active rig's
  `boardExtents`, or one overlapping another unit's body rect.

## The DSL (= import/export format = LLM output)

```json
{
  "version": 1,
  "name": "555 blinker",
  "board": "standard",
  "components": [
    { "id": "PS1", "type": "power_supply", "params": { "voltage": 5 } },
    { "id": "U1", "type": "ne555", "at": "f20" },
    { "id": "R1", "type": "resistor", "params": { "resistance": 1000 }, "holes": ["j18", "j24"] },
    { "id": "C1", "type": "capacitor", "params": { "capacitance": 1e-5 }, "holes": ["d22", "top-10"] },
    { "id": "D1", "type": "led", "params": { "color": "red" }, "holes": ["b30", "b32"] }
  ],
  "wires": [
    { "id": "w1", "from": "PS1:+", "to": "top+0", "color": "red" },
    { "id": "w2", "from": "PS1:-", "to": "top-0", "color": "black" }
  ]
}
```

`holes[]` length must equal the catalog pin count (leads/probe). `at` for
dip/footprint (which may also carry `"rotation"`: 0|180 for DIPs, quarter
turns for footprints). Off-board components have neither, but may carry a
movable-instrument `"pos"` (plan units on the 0.5 grid). `"board"` is
optional (`"half" | "standard" | "labxl"`; absent = `"standard"` for full
backward compatibility), `"boardCount"` is optional (integer 1..6; absent
= 1) — it gangs that many identical modules into one rig with continuous
column/rail numbering — and `"boardRows"` is optional (integer 1..4;
absent = 1) — it stacks that many full rig rows front-to-back, addressed
by the `"1:a12"` hole-ref prefix, each with independent power rails. The
validator bounds-checks every hole against the declared 2-D rig and
rejects dip/footprint packages that straddle a module seam (or would span
board-rows). The LLM is told the active rig and may emit a larger
`"board"` / `"boardCount"` / `"boardRows"` when the request needs more
room.

## Simulation architecture

### Nets (src/sim/netlist.ts — sim-core)

Union-find: seed each hole's static net (`netIdForHole`), each off-board
terminal (`netIdForTerminal`), then merge across wires and catalog
`internalBridges`. Expose: `buildNetlist(layout)` →
`{ netOf(ref: EndpointRef): string|null, nets: string[], ground: string|null,
warnings }`. Ground = the net of the first `power_supply`'s `-` terminal
(else first `function_generator`'s `gnd`, else first net + warning).

### Solver (src/sim/mna.ts — sim-core)

Nodal analysis, **Norton-only** (no group-2 voltage-source rows): every
source is a Thevenin {v, rout} stamped as G = 1/rout, I = v/rout (power
supply rout = 0.01Ω). Matrix = pure conductance form, dense, solved with LU +
partial pivoting. Nonlinear devices (diodes, BJTs, MOSFETs) iterate
Newton-Raphson (≤ 40 iters, tol 1µV, with pn-junction voltage limiting for
convergence). Linear-only circuits factor once and reuse. Capacitors/inductors
use backward-Euler companion models.

The extension adds a **structural-sparsity fast path** (`MnaSystem`): the
dense storage and the reference arithmetic stay, but stamping records the
touched entries, the first factorization of a structure records a symbolic
elimination plan and later factorizations / substitutions replay it over the
nonzero lists only — bit-identical to the dense algorithm (the reasoning is
in `mna.ts`; `tests/perf-mna.test.ts` and the legacy-equivalence test check
it). Subcircuits (on-board LEDs, regulators, pull-ups), rail-stage chip
drives and an opt-in strict Newton mode (`strictNewton`) serve the MCU
worlds.

### Chips (src/sim/chip-api.ts bridge)

Behavioral models step BEFORE each solve: read previous-step pin voltages,
update state, declare per-pin drives ({v, rout} Norton stamps). Conventions
(in chip-api.ts): logic threshold 0.5·VDD; push-pull rout 50Ω; open-drain
conducting {v:0, rout:25}; supply pin < 2V → release all outputs. Each chip
self-registers via `registerChip(model, factory)`; engine instantiates with
`createChip` after importing `src/sim/chips/all`.

### Engine (src/sim/engine.ts — sim-core) — EXACT public API

```ts
export const DEFAULT_DT = 5e-5 // seconds
export class SimEngine {
  constructor(layout: CircuitLayout)
  readonly issues: SimIssue[]            // static + runtime, deduped
  time: number
  step(dt?: number): void                // one step (default DEFAULT_DT)
  advance(seconds: number, dt?: number): void
  telemetry(): SimTelemetry
  /** live tweaks while running: pot position, switch state, pressed, light, voltage... */
  setRuntimeParam(componentId: string, key: string, value: ParamValue): void
  netVoltage(ref: EndpointRef): number   // NaN if unknown ref
}
```

Telemetry per component: pinVoltages always; `current` for 2-lead devices;
`ledBrightness` 0..1 (≈ I/10mA clamped); `burned` latches when LED current
> 30mA sustained for > 1ms (burned LEDs stop emitting light but still conduct);
`segments` for seven_segment; `outputs` from chips; `sounding` for buzzer
(|V| > 1). Issue examples: "no power supply", "no ground", "chip U1 VCC pin
not connected to a powered net" (checked statically), "LED D1 burned out
(current 80mA — add a series resistor)", "supply current > 2A (short
circuit?)".

Performance target: a 30-net circuit at dt=50µs must simulate ≥ 20k
steps/sec (reuse buffers; don't allocate per step).

### Devices (src/sim/devices.ts — sim-core)

resistor, capacitor, inductor, potentiometer (2 resistors), photoresistor
(R = 200Ω·10^(3·(1−light))), diode/led (Shockley, Is=1e-12, n=2 for LEDs with
per-color Vf via saturation scaling — red≈1.8V green≈2.2 yellow≈2.0 blue≈3.0
white≈3.2 at 10mA), npn/pnp (Ebers-Moll, β=150), nmos (square law, Vth=2,
k=0.1), pushbutton/slide_switch/dip_switch_8 (G = 20S closed / 1e-9S open),
seven_segment (8 LED junctions to COM), buzzer (300Ω + sounding flag),
power_supply (Thevenin 0.01Ω), function_generator (time-varying Thevenin 50Ω).

## 3D scene

Contract in `src/three/scene-api.ts`. Scene owns renderer/camera
(OrbitControls)/lights/board mesh/wires/ghost/picking; component visuals are
delegated to `component-meshes.ts` (`buildComponentObject` /
`updateComponentVisual`). Picking: raycast a y=0 plane and snap to the nearest
hole within 0.5 units (use breadboard.ts math); component bodies picked by
raycasting their groups (set `userData.componentId`).

**Unified wire + component routing**
(`src/three/internal/wire-router.ts` — pure geometry, no three.js imports,
node-tested; fed by `internal/wires.ts`): wires AND axial leaded parts
(resistor / diode / inductor — body dims from `routedBodyFor`) are planned
in ONE deterministic pass: components first (their rigid bodies become
collision samples other paths must clear), then wires, longest plan span
first, ids breaking ties. Endpoints always enter holes vertically; short
hops become low "staple" jumpers, longer runs flat-topped arcs; conflicts
walk a fixed cost-ordered candidate ladder where lateral mid-section dodges
are cheaper than lift tiers, so paths spread sideways before stacking
upward. A leaded part routes as a **span** (the rigid body reserved as a
straight, level segment on the flat top, collision-sampled as a fat
cylinder) or — under 3 plan units — a **vertical** stand-up mount (body
upright over hole A, hairpin lead over to B) with a deterministic lean
ladder (±0.12·n rad toward the plan axes) when upright bodies collide;
the lean is reported as `tilt`. `routeOne()` previews a single candidate
against the already-routed world without mutating it — the placement
hologram and the wire-drag preview show the same path the commit produces
(modulo exact span-length ties). `toRoutedPose()` converts a routed path
into the mesh builders' `RoutedComponent` render contract (body pose +
per-lead waypoint runs). Rendered wires are CatmullRom tubes along the
planned waypoints, colored.

Off-board instruments are router obstacles too: `routeAll(items, obstacles,
instruments?)` takes optional `InstrumentObstacle` boxes ({id, plan extents,
height ~4, terminals with per-post `exitDir`}). The boxes are
collision-checked like any component obstacle — wires can no longer noclip
through a PSU enclosure — and a wire whose ENDPOINT sits on an instrument
terminal gets a fixed EXIT SEGMENT: it rises from the post, then runs level
along the terminal's exitDir (away from the box face) for ≥ 1.5 units before
the normal staple/arc geometry begins, so a wire can never slice back
through the instrument it plugs into. The fixed exit prefix is exempt from
candidate evaluation (it cannot move) but its samples join the world grid so
later paths dodge it; `routeOne()` previews resolve the same exits from the
world's remembered instruments (preview = commit, instruments included).

**Placement & hover FX** (`internal/hologram.ts`, `internal/hole-fx.ts`):
the placement ghost is a hologram clone of the real part mesh (shader
scanlines + fresnel rim + flicker, all driven off one shared clock uniform;
cyan = valid, iOS red = invalid) with per-hole pin markers (glow ring +
light beam); with one hole picked, 2-lead parts ghost their full routed
pose (`GhostSpec.picked`). The hovered hole gets a springy glow ring plus a
pooled CanvasTexture coordinate chip ("e23"). Four 3D "+" grow paddles —
one per 2-D grid edge (select mode, sim stopped, axis below its
`MAX_BOARD_COUNT` / `MAX_BOARD_ROWS` cap) — grow the rig via the optional
`onGrowGrid(direction)` scene callback → `store.growGrid(direction)`;
`scene.setLayout` rebuilds the board for size, count and row changes and
springs new modules in.

**Edit drags** (scene-side gestures, select mode; the store stays the
validator): a drag starting on an already-selected part suspends
OrbitControls and translates the selection as a snapping hologram —
`onMovePreview(ids, target)` tints it valid/invalid against
`store.previewMove` and `onMoveCommit` lands it (`MoveTarget`: `{anchor}`
re-anchors one package, `{dCol, dRowLattice}` translates a group; wires
stay put). Shift+drag on empty board (desktop mouse) sweeps a screen-space
marquee → `onMarqueeSelect(ids)`; `onObjectClick(id, additive)` carries
shift/cmd for toggle-into-selection. Dragging a selected off-board
instrument snaps its bench anchor to the 0.5 grid with a validity-tinted
overlay box (`onInstrumentMovePreview` / `onInstrumentMoveCommit` →
`store.setInstrumentPos`). Tapping a body-occluded hole fires
`onHoleOcclusionRejected(hole)` so the app can name the covering part.

**Render modes** (`src/three/render-modes/`, spec + wiring contract in its
`RENDER-MODES.md`): the scene consumes one facade, `RenderModeManager` —
Performance (the untouched raster path, zero added cost), Enhanced (HDRI
IBL + SAO/bloom/SMAA composer), Studio (three-gpu-pathtracer progressive
path tracing of the same scene graph; raster fallback during interaction;
raster overlays composited live over the held still via the `bbNoStudio`
camera-layer pass). Enhanced and Studio are lazy-loaded chunks; mode
selection/persistence logic is pure and node-tested (`capability.ts`,
default phone → performance, desktop → enhanced, stored override under
`localStorage['bb.renderMode']`).

60 fps with ~100 components; dispose() must free all GPU resources.

**Embedded-lab scene additions** (all optional members of
`IBreadboardScene`, so older callers are unaffected): `setViewInsets`
(centre the board in the space the workspace panels leave free; zero insets
= the classic projection, bit-identical), `frameContent` / `frameTargets`
(circuit-first framing inside the free area, optional minimum elevation for
wiring steps), `setHighlights` (the lesson coach's layer) and a separate
**problem layer** `setProblemHighlights` (red error / amber risk / blue info,
declared by `problemHighlightLevels`; light-emitting parts get rims, not
covers, so an LED stays visible), `setSourceHighlight` (hover-only marker),
the hover-chip text callback (`holeLabelText`, fed by
`src/ui/workspace/hole-chip.ts`), `onProbeRequest` (right-click / long-press
→ the probe menu), pressing a held part (pushbutton) directly in 3D while
running, end handles on the one selected wire (`moveWireEnd`, one undo step),
and `setDockedChrome` (the new chrome's paddle / handle behaviour). UI code
never calls the scene directly: it goes through the scene bridge
(`src/ui/workspace/scene-bridge.ts`: `focusInScene`, `frameCircuit`,
`frameTargets`, `highlightSource`). The procedural Blue Pill, logic probe,
DMM and every part family's mesh plug-in keep ≤ 4000 triangles per part.

## State & app loop (glue agent)

`src/state/store.ts` implements `src/state/types.ts` with zustand and drives
the simulation through a **`SimHost`** (`src/sim/coordinator/api.ts`) — a
Web Worker in the browser (`WorkerSimHost`), an inline coordinator in node
and as a fallback (`InlineSimHost`) — so real firmware never starves the UI
thread. Every document change (edit, undo/redo, load, clear) is sent with
`host.load(layout, rev)`; runtime params go to `host.setRuntimeParam`. Sim
timing (wall dt × simSpeed, a per-frame CPU budget, falling behind rather
than freezing) is the host's job; the store consumes `SimFrame`s: telemetry
is pushed to the scene on every frame (telemetry sink), React state
(telemetry / simTime / issues / scope) is throttled to ~10 Hz while running.
The 1 kHz scope feed arrives with each frame; the high-resolution scope and
logic data are PULLED by the instruments (`queryScope` / `queryLogic`).
Legacy session semantics are preserved (`startSim` / `stopSim` / `resetSim`).
Autosave layout to localStorage (debounced) and restore on boot (old `PB<n>`
pushbutton ids load as `SW<n>`). API key in localStorage (`bb.apiKey`).

The embedded-lab state lives in a second store, `src/state/lab.ts`
(`useLab`, contract `lab-types.ts`): firmware bindings (bytes in IndexedDB
keyed by SHA-256, records in `bb.firmware`, re-parsed and re-hashed on boot),
the ≤ 10 Hz MCU frame snapshot (state, PC, cycles, HCLK, clocked
peripherals), MCU debug calls (halt / step / resume / reset, registers,
support table), UART and log ring buffers, logic-analyzer channels / decoders
/ trigger, workspace layout, favorites and terminal preferences, plus
`exportProject` / `importProject`.

Document edits flow through the in-memory undo history
(`src/state/history.ts`): every user-level edit — placement, wiring,
deletes (incl. group deletes), param changes, moves (`commitMove`,
all-or-nothing across the selected group), rotations (`rotateArmed` /
`rotatePlaced`), instrument repositioning (drag-coalesced), board
size/count/rows switches, `growGrid` (incl. the left/up hole-ref remap),
imports and AI applies — is exactly ONE undoable step. `selection` is an
id array (`select` / `toggleSelect` / `marqueeSelect` / `clearSelection`);
the persisted render-mode preference lives on the store as
`renderMode`/`setRenderMode` (`null` = device default). See
`src/state/types.ts` for the full annotated contract.

## LLM flow (llm agent)

`src/llm/` calls Claude **from the browser** with the user's key
(`claude-opus-4-8`). System prompt is built programmatically from CATALOG
(pin tables from the `pins` arrays + `doc` strings + the breadboard rules
above + 1 worked example layout). The model must return a CircuitLayout via
structured output (strict tool or output_config json_schema — confirm what the
installed SDK version supports by reading node_modules). Pipeline:
generate → `validateLayout()` (src/model/validate.ts) → if errors, send them
back for repair (≤ 2 retries) → return {layout, explanation}. Use streaming.
The validator is also used by import: it must catch bad hole refs (bounds
checked against the declared 2-D rig, board-row prefixes included), wrong
holes[] length, DIP anchors off row f, packages straddling a module seam,
invalid `rotation` values (non-quarter-turn anywhere; 90/270 on a DIP;
rotation on parts that cannot rotate), overlapping hole occupancy, pins or
wire ends landing under another part's body (occlusion), bad instrument
`pos` (off the 0.5 grid / body over the board / overlapping another
instrument), unknown types/params, duplicate ids, wires to nonexistent
endpoints, missing power supply (warning).

The LLM prompt knows the MCU and module catalog entries; the assistant
builds circuits only (it never writes firmware).

## Embedded lab

### Cortex-M3 core (src/mcu/core)

A TypeScript ARMv7-M interpreter (Thumb-2, no FP/DSP extension).
Instructions are decoded once per address into per-4-KiB-page arrays and run
from there; flash programming / image reloads invalidate the cache; the loop
allocates nothing per instruction. Exception model per DDI 0403E §B1.5
(entry, return, tail-chaining, approximated late arrival, escalation,
lockup), WFI / WFE / SLEEPONEXIT, NVIC, SCB, SysTick, DWT.CYCCNT, ITM,
bit-band. BKPT halts the core (no semihosting). Deliberate deviations are
listed at the top of `cpu.ts` — chiefly **zero-wait-state memory** (flash
wait states and bus contention are not modeled; cycle counts follow the
Cortex-M3 TRM table). Verified by ISA / exception / cycle tests, 27k
differential vectors generated with Unicorn 2.1.4 (`tools/cpu-oracle/`,
development-time only), a host-vs-target C self-test at -O0/-O2/-Os, and a
disassembler checked against `llvm-objdump`.

### STM32F103C8 SoC (src/mcu/stm32f1)

`soc.ts` implements `McuDevice` (`src/mcu/mcu-api.ts`): memory map with the
BOOT0 boot alias and BusFault on unmapped space, RCC clock tree with exact
cycle↔time rebasing on every HCLK change (MCU time = simulation time), the
FLASH interface, PWR, GPIOA–D (LQFP48 pins, JTAG/SWD ownership), AFIO
remaps, EXTI and DBGMCU. USART1–3, TIM1–4, I2C1–2, SPI1–2, ADC1–2, DMA1,
IWDG, WWDG, BKP and CRC are `Stm32Peripheral` plug-ins (`periph-api.ts`)
that talk to the chip only through `SocContext` (clocks, the cycle-keyed
event queue, IRQ lines, AF pin drives, DMA requests, TRGO/CCx triggers) —
no polling, no per-cycle counting (timers are lazy counters). Protocols are
bit-level on the pins (I²C open-drain wired-AND with clock stretching, SPI
modes 0–3, UART frames with 3-sample RX).

**Honesty table.** `peripherals.ts` reports `PeripheralSupport` per block:
`verified` (documented features complete AND a passing real-firmware
integration test, named in `verifiedBy`), `partial` (notes say what is and
is not implemented) or `unsupported` (USB, CAN, RTC, USB/CAN SRAM: reads 0,
ignores writes, logs every access). The table is the inspector's 周邊 tab
and the source of `docs/support-matrix.md` (`scripts/gen-support-matrix.mjs`;
`tests/docs-support-matrix.test.ts` fails when the committed file is stale;
`tests/fidelity-support.test.ts` checks every claim against the tests that
run firmware). `McuDebugState` also reports `pcSymbol` / `lrSymbol` (ELF
symbols), `clocked` (blocks the firmware switched on — the 「只看韌體用到的」
filter) and `afioMapr` (remap-aware pin functions).

### Firmware loading (src/mcu/loader, src/state/firmware-store.ts)

`loadFirmwareFile()` detects the format by content first (ELF magic, Intel
HEX syntax), then by extension; only bytes whose load address is in flash are
programmed (like a programmer); a raw BIN defaults to 0x08000000. Every UI
entry point (firmware card, canvas drop, built-in firmware picker, lesson
step action) goes through `lab.loadFirmware`. Bundled images
(`firmware/dist/*.elf`) are Vite assets fetched on demand
(`src/firmware-assets.ts`). The firmware build system (`firmware/build.mjs`,
clang + ld.lld, no GCC) compiles CubeIDE-style projects against ST HAL
v1.1.9 / CMSIS / FreeRTOS fetched into the gitignored `firmware/vendor/`;
each `project.json` carries a prose `expect` and a machine-checkable
`checks` contract copied into `firmware/dist/manifest.json`.

### Simulation coordinator (src/sim/coordinator)

`SimulationCoordinator` owns one world in **deterministic virtual time**:
each advance stops at `min(target, last analog step + max step, pending
analog time points, next event)` and runs every MCU `runUntil(tStop)`. An MCU
that changes the drive of a pin on an ANALOG net records an analog time
point at the exact edge and stops at the next instruction boundary, so the
analog step ends on the edge; edges denser than the 0.5 µs minimum step are
duty-averaged (`stage.ts`). Pins on LOGIC nets resolve immediately in
`DigitalNets`. With no MCU and no digital device the coordinator degenerates
to fixed 50 µs steps, bit-identical to the upstream loop. No wall-clock time
enters the simulation. The MCU board adapter (`mcu-board.ts`) is the
`McuDevice`'s electrical face in the engine (push-pull 50 Ω, open-drain,
40 kΩ pulls, datasheet VIL/VIH with hysteresis, POR/PDR, NRST, BOOT0,
over-voltage / over-current / floating-input warnings); MCUs survive circuit
rebuilds (hot wiring). Recorders (`recorders.ts`): high-resolution scope
rings, per-source logic edge rings (logic-analyzer channels only), UART
bytes, the simulation log — preallocated, pulled by the UI. Test and lesson
hooks: `setStimulus` (a 50 Ω source on a net, never MCU registers),
`scheduleAt`, `addUartListener`; `checks.ts` builds a contract's `circuit`
on a bench and evaluates it.

**The UART terminal's USB-TTL adapter** (`uart-adapter.ts` and the TTL block
of `coordinator.ts`): `uartSend` on an MCU USART never writes into the
peripheral. The terminal is a virtual 3.3 V USB-TTL adapter (a CMOS output of
150 Ω, powered from USB, referenced to the board's GND) whose TXD is jumpered
to the USART's RX pin — USART1 → PA10, USART2 → PA3, USART3 → PB11, or the
pin AFIO_MAPR remaps it to. Typed bytes leave as real UART frames (start bit,
the M-bit word LSB first with its parity bit, stop bits) at the line settings
the firmware programmed, bit by bit in virtual time, and the USART receives
them through its normal pin sampling (RXNE, IDLE, FE / PE / NE / ORE, DMA
requests); the plugged-in adapter idles high. On a logic net it is a
`DigitalNets` slot whose high level is fixed above the board's GND
(`addSlot` `upOffset`) and that yields to any other strong driver
(`setYield`, `strongDriver`); on an analog net it is a Norton source
(`McuBoardChip.setSource`) whose edges end analog steps. It never fights the
circuit: when something else drives the RX net (a module's TXD, another
output, a supply rail, a level shifter's other side…) it stays unplugged or
lets go, and every MCU frame reports per USART the RX pin, its state
(`free` / `driven` / `rail` / `output` / `absent`), the driver and that
driver's own host port (`McuFrameInfo.uartRx`) — the terminal says so and
offers the module's port. The logic analyzer and its UART decoder see the
frames like any other signal; the firmware contracts' UART drives take the
same path. A module port (CH340 `COM`, HC-05 `BT`) transmits on the module's
own pins.

### Digital layer and devices (src/sim/digital, src/sim/models)

Three layers: the electrical MNA layer (every MCU / device pin drive is also
a Norton stamp, so DC levels, currents, pull-ups and meter readings are
physical; a module may declare its output rail — e.g. its on-board 3.3 V
regulator — with `DigitalSpec.outputRail`); the logic layer (`nets.ts`:
nets made only of logic pins, resistors to fixed rails and rails resolve at
the exact edge — open-drain wired-AND, pull strength, contention →
undefined, no pull → floating; everything else is read from the last analog
solution through input thresholds); the protocol layer (peripherals and
`DigitalDevice`s run their bus state machines on pin edges — no direct
function calls between an MCU peripheral and a sensor). Part families are
plug-ins: `src/model/parts/*.parts.ts` (catalog), `src/sim/models/*.model.ts`
(`registerDevice` / `registerChip` / `registerDigitalDevice`),
`src/three/meshes/ext/*.mesh.ts` (`registerMeshBuilder`), zh-TW texts in
`src/i18n/zh-TW/parts-*.ts`. Every `CatalogEntry` may carry `support`
(level + simulated / limits), `pinInfo`, `subcircuit`, `mcu`, `digital`,
`meta`, `ratings` (for the ERC), `offboard`, `source`, `supplyPins`,
`allowedRotations`, `strictNewton`.

### Instruments (src/instruments, src/ui/embedded/instruments)

Pure modules: UART (auto-baud) / I²C / SPI / 1-Wire decoders over recorded
edge lists, edge and pattern triggers, measurements (`measure.ts`:
`netSummary` / `netLiveSummary` — a frequency or duty only for a periodic
signal; serial data is "changing (not periodic)"), auto-fit, VCD / CSV
export, and **the one unit formatter** (`format.ts`: 3 significant digits, 4
for readings, never mHz, never −0, untrusted values → 「—」). UI: the logic
analyzer (16 channels, smart channel picker with bus presets, markers,
decoded-results table), the oscilloscope (4 channels, 自動設定, cursors,
honest timing readouts), the UART terminal, the Readings tab, the simulation
log; each view runs its pull loop only while visible.

### Electrical rule checker (src/sim/erc)

A static, rule-based checker over the netlist graph, the parts' `ratings`
and — while running — the latest telemetry and MCU state (pin modes, reset,
BOOT0, unclocked ports): 13 rules (`ERC_RULES` in `api.ts`) graded error /
risk / info. It never guesses: a rule fires only on data. Findings feed the
problems model.

### UI shell and the classic chrome (src/ui/chrome, src/ui/workspace)

The run capsule is the run control (`run-control.ts`: `useSimPhase()` idle /
running / paused / halted / fault, `runOrResume`, `toggleRun`, the
`STATE_TONE` colour table); while it runs with every board blocked it names
the first blocker in its state colour (「執行中 · U1 沒有供電」 /
「執行中 · U1 還沒有韌體」, `runningBlockerOf`), and a detail line may carry
an action (`CapsuleDetailOptions.action`: a tap on 「U1 故障（鎖死）——查看原因」
opens the board's 執行狀態 card instead of pausing); the status pill under it
shows the problems model's top row with its one-click fix; `keys.ts` routes Space / F5 / F10 /
Shift+F5 in the capture phase wherever the focus is; `ShortcutsSheet.tsx`
holds the one key table (`SHORTCUTS`, `withKey`). The desktop workspace
(≥ 1100 px, fine pointer) floats Tier-S panels over the canvas (no new
backdrop-filter — the glass budget in DESIGN.md is unchanged): library /
examples / lessons, the inspector (problems when nothing is selected), the
instrument tray. **Classic chrome:** `isLegacyChrome()` (`legacy.ts`) =
English AND no workspace showing; every new shell behaviour is gated on it,
and the classic chrome (including its keys) stays pixel- and
behaviour-identical to the pre-extension UI — the legacy visual-regression
scenes pin it at 0 diff.

### Problems model and shared UX helpers

`src/ui/embedded/problems.ts` merges ERC findings, simulator issues and MCU
states into one list (≤ 1 Hz): one `fact` per row, levels error / warning /
info, actions, scene targets; `boardBlocker(id)` gives the most fundamental
reason a board does nothing (no power → no firmware → lockup → debugger halt
→ system-memory boot) for the instruments' empty states and the lessons.
Shared helpers keep names, formats and states coherent across surfaces:
`pinLabel` / `terminalLabel` (`src/i18n/parts.ts`), `endpointName`
(`hole-chip.ts`), the unit formatter, `netLiveSummary` / `useNetLive`,
`STATE_TONE` / `withKey`, the scene bridge, `moveWireEnd` / `swapLeads`,
`activePinFunction`, `acceptFirmwareFile`; a canonical term table is
enforced by `tests/ux-shell-terms.test.ts` (dictionaries and lessons) and
`tests/docs-terms.test.ts` (docs). See `docs/developer-guide.md` §11.

### Lessons and examples (src/lessons, examples/embedded)

A lesson is data (`src/lessons/types.ts`): zh-TW text, a starting circuit, a
solution, steps with one-click actions (load built-in firmware, run, arm a
part, start a wire, add analyzer channels) and acceptance checks evaluated on
the real simulation in a module worker (`engine/lesson-check.worker.ts`):
connectivity, measurements, UART text, firmware `checks` contracts, ERC.
Mistakes carry a `match` for the "most likely cause". `runnable: 'partial' |
'not-yet'` + `runnableNote` state honestly what is not simulated. Examples are
`ohmlet-project` files generated from descriptors
(`examples/embedded/src/*.example.mjs` → `scripts/build-examples.mjs`), opened
through the same `importProject` path as a user's project; tests run every
example.

### Internationalisation (src/i18n)

Call sites hold English sources; `t()` / `tc(src, context)` look them up in
zh-TW dictionaries merged from `src/i18n/zh-TW/*.ts` (one file per area, so
parallel work never edits the same dictionary). Catalog text stays English
(the validator and the LLM prompt use it) and is translated by `partLabel` /
`partDoc` / `pinLabel`; simulator, ERC and loader messages stay English in the
simulation code and are translated at the display boundary by `tMessage()`.
`scripts/i18n-audit.mjs` walks ~90 live UI states and fails on any
untranslated English word.

### Project files (src/state/project.ts)

Envelope `ohmlet-project`, `formatVersion` 1: the validator-owned
`CircuitLayout`, every board's firmware embedded byte-exact (base64 + SHA-256
+ size, BIN load address), logic-analyzer channels / decoders / trigger and
the workspace layout. Reading migrates one version at a time; a newer file
is refused; a firmware whose size or hash mismatches rejects the whole
project. A bare legacy layout is formatVersion 0.

### Performance discipline

No per-frame React work: frames reach React at ≤ 10 Hz through primitive
selectors, the problems model at ≤ 1 Hz, net summaries at ≤ 4 Hz and only
while asked for; telemetry goes straight to the scene; instruments pull data
windows; the performance-diagnostics overlay (`src/ui/perf`, off by default)
writes its figures to the DOM twice a second.

## Testing

`npm test` (vitest, node, fork pool capped at 6) covers the upstream suites,
legacy equivalence, the CPU, every peripheral (register models and real HAL
firmware on the coordinator), the coordinator, devices, firmware `checks`
contracts, instruments, ERC, lessons, examples, project files, UX contracts
and helpers, i18n and the docs (`tests/docs-*.test.ts`: the support matrix,
links / anchors / images, terms, figures quoted in the README, UI texts quoted
in the user guide rendered from the code that shows them). Browser
scripts (Playwright): `npm run test:visual` (legacy scenes must stay 0-diff),
`npm run audit:i18n`, `npm run test:e2e` (12-step acceptance walkthrough).
CI: `.github/workflows/ci.yml` (typecheck, tests, build on Ubuntu and Windows
× Node 20 / 22; optional firmware-reproducibility and browser jobs).

## Conventions

- TypeScript strict; no new runtime dependencies beyond package.json.
- Upstream styles in `src/ui/styles.css` (dark theme, CSS vars defined
  there); kit and panel styles beside their components (`*.css`); new panels
  follow DESIGN.md's Tier-S recipe (no new backdrop-filter).
- Every user-visible string goes through `t()` with a zh-TW entry; names,
  numbers, state colours, problems and 3D highlights go through the shared
  helpers above.
- No fake simulation: anything not simulated is labelled as such.
- Verify with `npx tsc --noEmit` — ignore errors in files you don't own.
- Tests: `npx vitest run` (node env, no DOM needed for sim tests).

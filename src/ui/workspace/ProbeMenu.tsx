/**
 * 3D probe menu (UX wave contract K6 — SC-5): right-click a hole, a pin or a
 * terminal post in the workspace → measure it in one more click.
 *
 *   openProbeMenu(target, screen, opts?)  scene onProbeRequest (App, SH-4 / SH-15) / any caller
 *   closeProbeMenu()
 *   <ProbeMenuHost/>                      mounted once by Workspace.tsx (desktop, SC-5)
 *                                         and by PartsSheet.tsx (phones, SC-14)
 *
 * Items: 加入邏輯分析儀 (addLogicChannelFor) · 放示波器探棒（CH n）
 * (addScopeProbeFor; disabled with the reason when all four are in use) ·
 * 選取接在這裡的元件 (every part on the net) · for MCU pins 在檢視面板看這支腳
 * (focusInspector → pins tab). Header: what the point is (「U1 PA5（板上 A5）·
 * c20」, 「PS1 正端 · 5.00 V」 — the hover chip's own words; the board id
 * stays with a single board too, release QA SC-F2).
 *
 * UX fix wave SC-14: a point the analyzer / the scope ALREADY measures says
 * so and shows it instead of offering to add it again — 「在邏輯分析儀中檢視
 * （PA5 LED）」 (the channel's display name; opens the analyzer and flashes the
 * row — probe-actions flashLogicChannel; 檢視 like the UART terminal's and the
 * log's rows, release QA SC-F4) and 「在示波器中檢視（CH1）」 (opens the
 * scope, flashes CH1 — flashScopeChannel); a deliberate second scope probe
 * on that net stays one explicit item, 「再放一支示波器探棒（CH2）」
 * (addScopeProbeFor allowDuplicate). A touch request (a long-press —
 * `opts.pointer === 'touch'`, or a coarse pointer) renders the same header
 * and items as a kit ActionSheet; its 「在…中檢視」 rows also ask the phone
 * host to open the instruments sheet (revealInstrument open).
 *
 * Desktop: a Tier-S popover (the UndoPill over-scene recipe, NO
 * backdrop-filter), portaled to <body>, positioned at the pointer and clamped
 * to the viewport. role='menu': ↑/↓/Home/End move, Enter/Space activate, Esc
 * / Tab / a click outside / scroll / resize close it. Opening state lives in
 * a tiny module store, so the scene callback never re-renders the App.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { ActionSheet, pressProps, tick } from '../kit'
import { getEntry } from '../../model/catalog'
import type { SceneProbeTarget } from '../../three/scene-api'
import { useStore } from '../../state/store'
import { t, useLang } from '../../i18n'
import { pinLabel } from '../../i18n/parts'
import {
  addLogicChannelFor,
  addScopeProbeFor,
  findLogicChannel,
  findScopeProbe,
  flashLogicChannel,
  flashScopeChannel,
  netMembersFor,
  nextScopeChannel,
  probeHolesOnNet,
  probeTargetFromScene,
  resolveProbeTarget,
  type ProbeTarget,
} from '../embedded/probe-actions'
import { channelDisplayName } from '../embedded/instruments/channel-name'
import { revealInstrument } from '../embedded/instruments/instrument-request'
import { focusInspector } from '../embedded/problems'
import { dotJoin, endpointName, holeChipText } from './hole-chip'
import './ProbeMenu.css'

/** What the menu probes: the scene's {hole?, terminal?} or a ProbeTarget. */
export type ProbeMenuTarget = SceneProbeTarget | ProbeTarget

interface MenuState {
  /** `sheet`: a touch request — the menu renders as an ActionSheet */
  open: { target: ProbeTarget; x: number; y: number; seq: number; sheet: boolean } | null
}

const useProbeMenu = create<MenuState>(() => ({ open: null }))

function isProbeTarget(t: ProbeMenuTarget): t is ProbeTarget {
  return 'kind' in t
}

/** A coarse primary pointer (phones / tablets): the menu is an ActionSheet there. */
function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/**
 * Open the menu for `target` at viewport position `screen` (CSS px). Ignores
 * empty targets. `opts.pointer === 'touch'` (a long-press, SC-14) — or a
 * coarse pointer — shows it as an ActionSheet.
 */
export function openProbeMenu(
  target: ProbeMenuTarget,
  screen: { x: number; y: number },
  opts: { pointer?: 'mouse' | 'touch' } = {},
): void {
  const tg = isProbeTarget(target) ? target : probeTargetFromScene(target)
  if (!tg || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return
  const seq = (useProbeMenu.getState().open?.seq ?? 0) + 1
  const sheet = opts.pointer === 'touch' || (opts.pointer !== 'mouse' && coarsePointer())
  useProbeMenu.setState({ open: { target: tg, x: screen.x, y: screen.y, seq, sheet } })
}

export function closeProbeMenu(): void {
  if (useProbeMenu.getState().open) useProbeMenu.setState({ open: null })
}

/** Is the menu open (tests / callers)? */
export function probeMenuOpen(): boolean {
  return useProbeMenu.getState().open !== null
}

/** One probe-menu row. */
export interface ProbeMenuItem {
  key: string
  label: string
  disabled?: boolean
  title?: string
  /**
   * The row SHOWS this instrument (「在邏輯分析儀中檢視」…): the touch sheet
   * also asks the host to bring the phone's instruments sheet up on it.
   */
  reveal?: 'logic' | 'scope'
  /** a disabled row's reason in one short line (the touch sheet's fine print — a finger has no tooltip) */
  note?: string
  run: () => void
}

/** Header text + items for `target` against the live layout (pure apart from the actions). */
export function probeMenuModel(target: ProbeTarget): { header: string; items: ProbeMenuItem[] } {
  const layout = useStore.getState().layout
  const r = resolveProbeTarget(target, layout)
  if (!r.ok) return { header: r.reason, items: [] }
  const rt = r.target
  let header: string
  if (rt.kind === 'mcu-pin') {
    const comp = layout.components.find((c) => c.id === rt.componentId)
    const entry = comp ? getEntry(comp.type) : undefined
    // H1 full form with the board id 「U1 PA4（板上 A4）」 — the hover chip's own words; only
    // the board's own inspector drops the id (release QA SC-F2)
    const name = entry ? pinLabel(entry, rt.pin, { id: rt.componentId }) : `${rt.componentId} ${rt.pin}`
    header = rt.hole ? dotJoin(name, rt.hole) : name
  } else {
    // the hover chip's words for the point (「PS1 正端 · 5.00 V」), never a raw ref
    header = holeChipText(rt.hole ?? rt.ref) ?? endpointName(layout, rt.ref)
  }
  // already on the analyzer / the scope: show it instead of adding it again (SC-14)
  const onLogic = findLogicChannel(target, layout)
  const items: ProbeMenuItem[] = [
    onLogic
      ? {
          key: 'logic',
          label: t('Show in the logic analyzer ({name})', { name: channelDisplayName(layout, onLogic).name }),
          reveal: 'logic',
          // the instruments on the analyzer, that row scrolled in and flashed (IS-13)
          run: () => flashLogicChannel(onLogic.index),
        }
      : { key: 'logic', label: t('Add to logic analyzer'), run: () => void addLogicChannelFor(target) },
  ]
  const onScope = findScopeProbe(target, layout)
  const ch = nextScopeChannel(layout)
  // where a new probe would go — the same search addScopeProbeFor makes, so
  // the menu never offers a probe it would then refuse (「…已經沒有空孔」)
  const anchor = rt.hole
  const full =
    anchor && probeHolesOnNet(layout, anchor).length === 0
      ? t('The net of {hole} has no free hole — free a hole on its strip, or wire the net to an empty strip', { hole: anchor })
      : null
  const fullNote = anchor ? t('No free hole left on the net of {hole}', { hole: anchor }) : undefined
  items.push(
    onScope
      ? {
          key: 'scope',
          label: t('Show in the oscilloscope (CH{n})', { n: onScope.channel }),
          reveal: 'scope',
          run: () => flashScopeChannel(onScope.channel),
        }
      : ch === null
        ? {
            key: 'scope',
            label: t('Place a scope probe'),
            disabled: true,
            title: t('All four scope channels are in use — move or remove a probe first'),
            note: t('All four scope channels are in use'),
            run: () => undefined,
          }
        : full
          ? { key: 'scope', label: t('Place a scope probe (CH{n})', { n: ch }), disabled: true, title: full, note: fullNote, run: () => undefined }
          : { key: 'scope', label: t('Place a scope probe (CH{n})', { n: ch }), run: () => void addScopeProbeFor(target) },
  )
  // a deliberate second probe on a net the scope already measures (two
  // channels on one net — comparing ground bounce, a probe on each end of a
  // long wire): one explicit item, never the default (IS-13 one net, one probe)
  if (onScope && ch !== null) {
    items.push({
      key: 'scope-more',
      label: t('Place another scope probe (CH{n})', { n: ch }),
      disabled: full !== null,
      note: full ? fullNote : undefined,
      title:
        full ??
        t('{id} already measures this net on CH{n} — this adds a second probe', {
          id: onScope.componentId,
          n: onScope.channel,
        }),
      run: () => (full ? undefined : void addScopeProbeFor(target, { allowDuplicate: true })),
    })
  }
  const members = netMembersFor(target, layout).componentIds
  items.push({
    key: 'select',
    label: t('Select the parts connected here'),
    disabled: members.length === 0,
    title: members.length === 0 ? t('Nothing else is connected to this point yet') : members.join(t(', ')),
    note: members.length === 0 ? t('Nothing else is connected to this point yet') : undefined,
    run: () => useStore.getState().marqueeSelect(members),
  })
  if (rt.kind === 'mcu-pin') {
    items.push({
      key: 'inspect',
      label: t('Show this pin in the inspector'),
      run: () => focusInspector(rt.componentId, { tab: 'pins', pin: rt.pin }),
    })
  }
  return { header, items }
}

const MARGIN = 8

export function ProbeMenuHost() {
  const open = useProbeMenu((s) => s.open)
  useLang()
  if (!open || typeof document === 'undefined') return null
  if (open.sheet) return <ProbeSheet key={open.seq} target={open.target} />
  return createPortal(<ProbeMenu key={open.seq} target={open.target} x={open.x} y={open.y} />, document.body)
}

/**
 * Touch (SC-14): the same header and items as a kit ActionSheet — a
 * long-press on a hole / pin / terminal measures it in one more tap.
 */
function ProbeSheet({ target }: { target: ProbeTarget }) {
  const [model] = useState(() => probeMenuModel(target))
  // a finger has no tooltip: why the first unavailable row is greyed out is
  // the sheet's fine print (one short line — the sheet sizes for one)
  const note = model.items.find((i) => i.disabled && i.note)?.note
  return (
    <ActionSheet
      open
      onDismiss={closeProbeMenu}
      title={model.header}
      message={note}
      actions={model.items.map((item) => ({
        label: item.label,
        disabled: item.disabled,
        onSelect: () => {
          if (item.disabled) return
          tick()
          closeProbeMenu()
          item.run()
          // a phone shows its instruments in a sheet: 「在…中檢視」 brings it up there
          if (item.reveal) revealInstrument(item.reveal, { open: true })
        },
      }))}
    />
  )
}

function ProbeMenu({ target, x, y }: { target: ProbeTarget; x: number; y: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [model] = useState(() => probeMenuModel(target))

  // clamp to the viewport once the size is known (before paint: no jump)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN))
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - h - MARGIN))
    setPos({ left, top })
  }, [x, y])

  // focus the first enabled item once placed (clamping re-renders before paint)
  const placed = pos !== null
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [placed])

  // close on an outside press / wheel / resize / window blur
  useEffect(() => {
    const el = ref.current
    const onDown = (e: PointerEvent) => {
      if (el && e.target instanceof Node && el.contains(e.target)) return
      closeProbeMenu()
    }
    const close = () => closeProbeMenu()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // the menu owns the keyboard while focused: arrows must not nudge the
    // selection, Esc must not also clear it, Delete must not delete (App keydown)
    e.stopPropagation()
    const el = ref.current
    if (!el) return
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const go = (n: number) => {
      e.preventDefault()
      buttons[(n + buttons.length) % buttons.length]?.focus()
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      closeProbeMenu()
    } else if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(buttons.length - 1)
  }

  return (
    <div
      ref={ref}
      className="ws-probe-menu"
      role="menu"
      aria-label={t('Measure {what}', { what: model.header })}
      style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ws-probe-head" aria-hidden="true">
        {model.header}
      </div>
      {model.items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="ws-probe-item lg-pressable"
          disabled={item.disabled}
          title={item.title}
          {...pressProps}
          onClick={() => {
            if (item.disabled) return
            tick()
            closeProbeMenu()
            item.run()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

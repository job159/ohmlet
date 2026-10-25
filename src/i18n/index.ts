/**
 * UI localisation. The interface is Traditional Chinese (zh-TW) by default;
 * English remains available (Settings, `?lang=en`, localStorage 'bb.lang')
 * and is what the legacy visual-regression scenes pin, so they keep proving
 * the 3D scene is pixel-identical to upstream ohmlet.
 *
 * gettext style: call sites keep the ENGLISH source string, `t()` looks it up
 * in the active dictionary and falls back to the source. Placeholders use
 * `{name}`: t('{n} selected', { n: 3 }).
 *
 * Dictionaries live in src/i18n/zh-TW/*.ts (one file per UI area, each
 * exporting `default` as Record<englishSource, chinese>) and are merged at
 * build time with import.meta.glob, so translators never edit the same file.
 * Part names/descriptions (keyed by catalog type) and runtime simulator
 * messages (regex patterns) have their own tables — see parts.ts and
 * messages.ts.
 *
 * Pure module: safe in node tests and workers (no DOM access at import).
 */
import { useSyncExternalStore } from 'react'

export type Lang = 'zh-TW' | 'en'
export const LANGS: readonly Lang[] = ['zh-TW', 'en']
export const DEFAULT_LANG: Lang = 'zh-TW'
export const LANG_STORAGE_KEY = 'bb.lang'

type Dict = Record<string, string>

const zhModules = import.meta.glob<{ default: Dict }>(
  ['./zh-TW/*.ts', '!./zh-TW/parts-*.ts', '!./zh-TW/messages-*.ts'],
  { eager: true },
)
const ZH: Dict = Object.assign({}, ...Object.keys(zhModules).sort().map((k) => zhModules[k].default))

function isLang(v: unknown): v is Lang {
  return v === 'zh-TW' || v === 'en'
}

function detect(): Lang {
  try {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('lang')
      if (isLang(q)) return q
      const s = window.localStorage.getItem(LANG_STORAGE_KEY)
      if (isLang(s)) return s
    }
  } catch {
    /* no storage */
  }
  return DEFAULT_LANG
}

let current: Lang = detect()
const listeners = new Set<() => void>()

function applyDocumentLang(l: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'zh-TW' ? 'zh-Hant-TW' : 'en'
}
applyDocumentLang(current)

export function lang(): Lang {
  return current
}

/** Switch language (persisted). React views using useLang()/t() re-render. */
export function setLang(l: Lang): void {
  if (l === current) return
  current = l
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, l)
  } catch {
    /* storage unavailable */
  }
  applyDocumentLang(l)
  for (const cb of listeners) cb()
}

export function onLangChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** React hook: the active language; components re-render on change. */
export function useLang(): Lang {
  return useSyncExternalStore(onLangChange, lang, lang)
}

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

/**
 * A source may carry a gettext-style context suffix ("Details|problem",
 * "{n} pins|count") so one English word can map to two Chinese ones; the
 * English fallback shows the source without it.
 */
const CONTEXT_SUFFIX = /\|[a-z0-9-]+$/

function withoutContext(src: string): string {
  return src.includes('|') ? src.replace(CONTEXT_SUFFIX, '') : src
}

/** Translate an English UI source string (falls back to the source). */
export function t(src: string, params?: Record<string, string | number>): string {
  const s = current === 'zh-TW' ? ZH[src] ?? withoutContext(src) : withoutContext(src)
  return interpolate(s, params)
}

/** True when the active dictionary has an entry (used by coverage tests). */
export function hasTranslation(src: string): boolean {
  return current === 'en' || src in ZH
}

/** All zh-TW source keys (coverage tests). */
export function zhKeys(): string[] {
  return Object.keys(ZH)
}

/** Test-only: force the language without touching storage/listeners. */
export function __setLangForTests(l: Lang): void {
  current = l
}

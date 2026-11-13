/**
 * Preview toolbar state (theme, dark mode, width). Persisted the way DSH's
 * slot stores persist (JSON in localStorage under one key), so it survives a
 * refresh. It only drives the iframe's query/width and messages; it never
 * reaches the model.
 */
import { THEMES, WIDTHS, type ThemeName, type WidthName } from '../src/shared/preview-protocol.js'

export interface PreviewPrefs {
  readonly theme: ThemeName
  readonly dark: boolean
  readonly width: WidthName
}

export const STORAGE_KEY = 'dsh-astryx-studio:preview:v1'
export const DEFAULT_PREFS: PreviewPrefs = { theme: 'neutral', dark: false, width: 'desktop' }

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Parse stored prefs, dropping anything unknown (old versions, hand edits). */
export function parsePrefs(raw: string | null): PreviewPrefs {
  if (!raw) return DEFAULT_PREFS
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof PreviewPrefs, unknown>>
    return {
      theme: (THEMES as readonly unknown[]).includes(v.theme) ? (v.theme as ThemeName) : DEFAULT_PREFS.theme,
      dark: typeof v.dark === 'boolean' ? v.dark : DEFAULT_PREFS.dark,
      width: typeof v.width === 'string' && Object.hasOwn(WIDTHS, v.width) ? (v.width as WidthName) : DEFAULT_PREFS.width,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export interface PrefsStore {
  get(): PreviewPrefs
  set(patch: Partial<PreviewPrefs>): void
  subscribe(listener: () => void): () => void
}

export function createPrefsStore(storage: KeyValueStorage | undefined): PrefsStore {
  let state = parsePrefs(safe(() => storage?.getItem(STORAGE_KEY) ?? null) ?? null)
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch }
      if (next.theme === state.theme && next.dark === state.dark && next.width === state.width) return
      state = next
      safe(() => storage?.setItem(STORAGE_KEY, JSON.stringify(state)))
      for (const l of listeners) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

/** Remember which "open the tab" request (openSeq) each session has already honoured. */
export function createOpenLedger(storage: KeyValueStorage | undefined) {
  const key = 'dsh-astryx-studio:open-seq:v1'
  // In-memory copy too: without storage (private mode, tests) a request must still open the tab only once.
  const memory: Record<string, number> = {}
  const read = (): Record<string, number> => {
    try {
      return { ...memory, ...(JSON.parse(storage?.getItem(key) ?? '{}') as Record<string, number>) }
    } catch {
      return { ...memory }
    }
  }
  return {
    /** True (and recorded) when `seq` is newer than what this session already opened. */
    shouldOpen(sessionId: string, seq: number): boolean {
      const all = read()
      if (seq <= (all[sessionId] ?? 0)) return false
      all[sessionId] = seq
      memory[sessionId] = seq
      safe(() => storage?.setItem(key, JSON.stringify(all)))
      return true
    },
  }
}

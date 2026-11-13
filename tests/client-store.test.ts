import { describe, expect, it } from 'vitest'
import { createOpenLedger, createPrefsStore, DEFAULT_PREFS, parsePrefs, STORAGE_KEY } from '../client/store.js'
import { emptyText, iframeUrl, verifyText, viteText } from '../client/preview-tab.js'

function memory() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('preview prefs store', () => {
  it('persists theme/dark/width and restores them after a "refresh"', () => {
    const s = memory()
    const a = createPrefsStore(s)
    expect(a.get()).toEqual(DEFAULT_PREFS)
    let n = 0
    a.subscribe(() => n++)
    a.set({ theme: 'gothic', dark: true, width: 'mobile' })
    a.set({ theme: 'gothic' }) // no-op
    expect(n).toBe(1)
    expect(createPrefsStore(s).get()).toEqual({ theme: 'gothic', dark: true, width: 'mobile' })
  })

  it('drops unknown or corrupt values', () => {
    expect(parsePrefs('{"theme":"neon","dark":"yes","width":"watch"}')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    const s = createPrefsStore(broken)
    s.set({ dark: true })
    expect(s.get().dark).toBe(true)
    expect(STORAGE_KEY).toMatch(/astryx-studio/)
  })

  it('open ledger honours each openSeq once per session, across reloads', () => {
    const s = memory()
    expect(createOpenLedger(s).shouldOpen('a', 0)).toBe(false)
    expect(createOpenLedger(s).shouldOpen('a', 1)).toBe(true)
    expect(createOpenLedger(s).shouldOpen('a', 1)).toBe(false)
    expect(createOpenLedger(s).shouldOpen('b', 1)).toBe(true)
    expect(createOpenLedger(s).shouldOpen('a', 2)).toBe(true)
  })
})

describe('preview tab text helpers', () => {
  const base = { openSeq: 1, verify: { state: 'none', summary: '', at: 0 } } as const
  it('builds the iframe URL from the server URL, page and prefs', () => {
    expect(iframeUrl({ ...base, page: 'src/pages/main/page.tsx', preview: { state: 'running', url: 'http://127.0.0.1:5199/', log: [] } }, 'stone', true)).toBe(
      'http://127.0.0.1:5199/?page=src%2Fpages%2Fmain%2Fpage.tsx&theme=stone&dark=1',
    )
    expect(iframeUrl({ ...base, preview: { state: 'running', url: 'http://127.0.0.1:5199/', log: [] } }, 'stone', true)).toBeUndefined()
  })
  it('explains every empty state and status', () => {
    expect(emptyText(undefined, 'boom')).toContain('boom')
    expect(emptyText({ ...base, preview: { state: 'idle', log: [] } }, undefined)).toContain('astryx_template')
    expect(emptyText({ ...base, page: 'p', preview: { state: 'error', error: 'x', log: ['l1'] } }, undefined)).toContain('l1')
    expect(viteText({ ...base, preview: { state: 'running', url: 'http://127.0.0.1:1/', log: [] } })).toContain('运行中')
    expect(verifyText({ ...base, preview: { state: 'idle', log: [] }, verify: { state: 'pass', summary: 'astryx verify ✓ (tsc 0.6s)', at: 1 } })).toBe('verify ✓ (tsc 0.6s)')
    expect(verifyText({ ...base, preview: { state: 'idle', log: [] }, verify: { state: 'fail', summary: 'astryx verify ✗ (tsc 0.6s) · page.tsx:3 TS2322', at: 1 } })).toContain('TS2322')
  })
})

describe('originOf (preview message trust)', () => {
  it('gives the preview server origin, or undefined', async () => {
    const { originOf } = await import('../client/preview-tab.js')
    expect(originOf('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173')
    expect(originOf(undefined)).toBeUndefined()
    expect(originOf('not a url')).toBeUndefined()
  })
})

describe('prefs width check', () => {
  it('rejects inherited property names as widths', async () => {
    const { sanitizePrefs } = await import('../src/gallery.js')
    for (const width of ['constructor', 'toString', '__proto__']) {
      expect(sanitizePrefs({ theme: 'neutral', dark: false, width })).toBeUndefined()
      expect(parsePrefs(JSON.stringify({ theme: 'neutral', dark: false, width })).width).toBe(DEFAULT_PREFS.width)
    }
    expect(sanitizePrefs({ theme: 'neutral', dark: false, width: 'mobile' })?.width).toBe('mobile')
  })
})

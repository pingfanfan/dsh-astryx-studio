// Smoke test for the built web client: evaluates lib/client.js the way DSH's
// ModuleLoader does and checks it registers the tab type, its body and the
// open-preview watcher.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

type Factory = (require: (id: string) => unknown) => Record<string, unknown>

function loadClient() {
  const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let loaded: { id: string; factory: Factory } | undefined
  const window = { __ModuleLoader__: { load: (m: { id: string; factory: Factory }) => (loaded = m) } }
  new Function('window', src)(window)
  if (!loaded) throw new Error('lib/client.js did not call __ModuleLoader__.load')
  const required: string[] = []
  const mod = loaded.factory((id) => {
    required.push(id)
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })
  return { id: loaded.id, mod, required }
}

describe('client bundle', () => {
  it('loads as a ModuleLoader factory, needs only react, and registers the preview tab + body + watcher', async () => {
    vi.useFakeTimers()
    const { id, mod, required } = loadClient()
    expect(id).toBe('dsh-astryx-studio')
    expect(new Set(required)).toEqual(new Set(['react', 'react/jsx-runtime']))
    expect(mod.inject).toEqual(['slots', 'sidebarRightTabs', 'sidebarRight', 'connection'])

    const tabs: { id: string; kind: string; title: (a: string) => string; keepMounted?: boolean }[] = []
    const bodies: { name: string; key: string; inject: (sessionId: string) => { astryx: Record<string, unknown> } }[] = []
    const opened: [string, string][] = []
    const disposers: (() => void)[] = []
    let openSeq = 0
    const ctx = {
      effect: (fn: () => () => void) => disposers.push(fn()),
      sidebarRightTabs: { register: (d: (typeof tabs)[number]) => (tabs.push(d), () => {}) },
      slots: {
        inject: (_seat: string, register: () => () => void) => register(),
        register: (o: (typeof bodies)[number]) => (bodies.push(o), () => {}),
        entriesOfSlot: () => [],
      },
      sidebarRight: {
        mounted: { getSnapshot: () => 'session-1', subscribe: () => () => {} },
        openTabIn: (s: string, k: string) => opened.push([s, k]),
        openResourceIn: () => {},
      },
      connection: { rpc: { call: async (_c: string, endpoint: string) => ({ ok: true, value: { openSeq, preview: { state: 'idle', log: [] }, verify: { state: 'none', summary: '', at: 0 } } }) } },
    }
    ;(mod.apply as (c: typeof ctx) => void)(ctx)
    expect(tabs.map((t) => [t.id, t.kind])).toEqual([
      ['dsh-astryx-studio/preview', 'astryx-preview'],
      ['dsh-astryx-studio/gallery', 'astryx-gallery'],
    ])
    expect(tabs[0]).toMatchObject({ keepMounted: true })
    expect(tabs[0]!.title('')).toBe('Astryx 预览')
    expect(tabs[1]!.title('')).toBe('Astryx 模板画廊')
    expect(bodies.map((b) => b.key).sort()).toEqual(['dsh-astryx-studio/gallery', 'dsh-astryx-studio/preview'])
    const body = (key: string) => bodies.find((b) => b.key === key)!
    const face = body('dsh-astryx-studio/preview').inject('session-1').astryx
    expect(face.sessionId).toBe('session-1')
    expect((face.hasWebReview as () => boolean)()).toBe(false)
    ;(face.openGallery as () => void)()
    expect(opened).toEqual([['session-1', 'astryx-gallery']])
    opened.length = 0
    expect(body('dsh-astryx-studio/gallery').inject('session-1').astryx.sessionId).toBe('session-1')

    // astryx_template bumps openSeq → the watcher opens the tab once.
    openSeq = 1
    await vi.advanceTimersByTimeAsync(2100)
    await vi.advanceTimersByTimeAsync(2100)
    expect(opened).toEqual([['session-1', 'astryx-preview']])
    disposers.forEach((d) => d())
    vi.useRealTimers()
  })

  function rig(getPrefs: () => Promise<unknown>) {
    const { mod } = loadClient()
    const bodies: { key: string; inject: (sessionId: string) => { astryx: Record<string, unknown> } }[] = []
    const disposers: (() => void)[] = []
    const sent: unknown[] = []
    const ctx = {
      effect: (fn: () => () => void) => disposers.push(fn()),
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (_s: string, r: () => () => void) => r(), register: (o: (typeof bodies)[number]) => (bodies.push(o), () => {}), entriesOfSlot: () => [] },
      sidebarRight: { mounted: { getSnapshot: () => undefined, subscribe: () => () => {} }, openTabIn: () => {}, openResourceIn: () => {} },
      connection: {
        rpc: {
          call: async (_c: string, endpoint: string, body: { payload: { prefs?: unknown } }) => {
            if (endpoint.endsWith('getPrefs')) return getPrefs()
            if (endpoint.endsWith('setPrefs')) sent.push(body?.payload?.prefs)
            return { ok: true, value: {} }
          },
        },
      },
    }
    ;(mod.apply as (c: typeof ctx) => void)(ctx)
    const face = bodies.find((b) => b.key === 'dsh-astryx-studio/preview')!.inject('s').astryx
    const prefs = face.prefs as { get: () => { theme: string; dark: boolean; width: string }; set: (p: object) => void }
    return { prefs, sent, dispose: () => disposers.forEach((d) => d()) }
  }

  it('Host prefs are checked like local ones (an unknown width falls back)', async () => {
    const { prefs, dispose } = rig(async () => ({ ok: true, value: { prefs: { theme: 'stone', dark: true, width: 'phone' } } }))
    await vi.waitFor(() => expect(prefs.get().theme).toBe('stone'))
    expect(prefs.get().dark).toBe(true)
    expect(['desktop', 'tablet', 'mobile']).toContain(prefs.get().width)
    dispose()
  })

  it('a toolbar change made before the Host answers is not overwritten', async () => {
    let answer!: (v: unknown) => void
    const { prefs, dispose } = rig(() => new Promise((r) => (answer = r)))
    prefs.set({ theme: 'matcha' })
    answer({ ok: true, value: { prefs: { theme: 'stone', dark: false, width: 'desktop' } } })
    await new Promise((r) => setTimeout(r, 10))
    expect(prefs.get().theme).toBe('matcha')
    dispose()
  })
})

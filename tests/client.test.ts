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
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ id: 'dsh-astryx-studio/preview', kind: 'astryx-preview', keepMounted: true })
    expect(tabs[0]!.title('')).toBe('Astryx 预览')
    expect(bodies[0]).toMatchObject({ name: 'sidebar.right.pane.tab', key: 'dsh-astryx-studio/preview' })
    const face = bodies[0]!.inject('session-1').astryx
    expect(face.sessionId).toBe('session-1')
    expect((face.hasWebReview as () => boolean)()).toBe(false)

    // astryx_template bumps openSeq → the watcher opens the tab once.
    openSeq = 1
    await vi.advanceTimersByTimeAsync(2100)
    await vi.advanceTimersByTimeAsync(2100)
    expect(opened).toEqual([['session-1', 'astryx-preview']])
    disposers.forEach((d) => d())
    vi.useRealTimers()
  })
})

// Smoke test for the built web client: evaluates lib/client.js the way DSH's
// ModuleLoader does and checks it registers the tab type and its body.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as jsxRuntime from 'react/jsx-runtime'

type Factory = (require: (id: string) => unknown) => Record<string, unknown>

function loadClient() {
  const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let loaded: { id: string; factory: Factory } | undefined
  const window = { __ModuleLoader__: { load: (m: { id: string; factory: Factory }) => (loaded = m) } }
  new Function('window', src)(window)
  if (!loaded) throw new Error('lib/client.js did not call __ModuleLoader__.load')
  const mod = loaded.factory((id) => {
    if (id === 'react/jsx-runtime') return jsxRuntime
    throw new Error(`unexpected require: ${id}`)
  })
  return { id: loaded.id, mod }
}

describe('client bundle', () => {
  it('loads as a ModuleLoader factory and registers the preview tab', () => {
    const { id, mod } = loadClient()
    expect(id).toBe('dsh-astryx-studio')
    expect(mod.inject).toEqual(['slots', 'sidebarRightTabs'])

    const tabs: { id: string; kind: string; title: (a: string) => string }[] = []
    const bodies: { name: string; key: string }[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      sidebarRightTabs: { register: (d: (typeof tabs)[number]) => (tabs.push(d), () => {}) },
      slots: {
        inject: (_seat: string, register: () => () => void) => register(),
        register: (o: { name: string; key: string }) => (bodies.push(o), () => {}),
      },
    }
    ;(mod.apply as (c: typeof ctx) => void)(ctx)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ id: 'dsh-astryx-studio/preview', kind: 'astryx-preview' })
    expect(tabs[0]!.title('')).toBe('Astryx 预览')
    expect(bodies).toEqual([{ name: 'sidebar.right.pane.tab', key: 'dsh-astryx-studio/preview' }])
  })
})

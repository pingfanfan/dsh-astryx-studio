import { describe, expect, it } from 'vitest'
import { apply, inject, ping, pingTool, PING_TOOL, PROMPT_SECTION } from '../src/index.js'

function fakeContext() {
  const tools: unknown[] = []
  const sections: { name: string; order: number }[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    effect(fn: () => () => void) {
      disposers.push(fn())
    },
    tools: {
      register(def: unknown) {
        tools.push(def)
        return () => tools.splice(tools.indexOf(def), 1)
      },
    },
    systemPrompt: {
      section(s: { name: string; order: number }) {
        sections.push(s)
        return () => sections.splice(sections.indexOf(s), 1)
      },
    },
  }
  return { ctx, tools, sections, dispose: () => disposers.reverse().forEach((d) => d()) }
}

describe('host plugin', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['tools', 'systemPrompt'])
  })

  it('registers astryx_ping and one prompt section, and cleans both up', () => {
    const f = fakeContext()
    apply(f.ctx as never)
    expect(f.tools).toHaveLength(1)
    expect((f.tools[0] as { name: string }).name).toBe(PING_TOOL)
    expect(f.sections.map((s) => s.name)).toEqual([PROMPT_SECTION])
    f.dispose()
    expect(f.tools).toHaveLength(0)
    expect(f.sections).toHaveLength(0)
  })

  it('ping returns a canonical value', () => {
    expect(ping()).toEqual({ ok: true, plugin: 'dsh-astryx-studio', echo: 'pong' })
    expect(ping('hi').echo).toBe('hi')
  })

  it('tool definition exposes a model-facing schema', () => {
    expect(pingTool.name).toBe(PING_TOOL)
    expect(JSON.stringify(pingTool.parameters)).toContain('message')
  })
})

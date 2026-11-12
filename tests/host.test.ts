import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apply, inject, MESSAGE_SOURCE } from '../src/index.js'
import { LONG_TEMPLATES, PROMPT_SECTION_NAME, PROMPT_TEXT, REQUEST_TABLE, SKILL_CONTENT, SKILL_NAME, STYLEX_TEMPLATES } from '../src/prompt.js'
import catalog from '../src/generated/catalog.json' with { type: 'json' }
import { fakeRunner, ok, tempProject, tick } from './helpers.js'

type Handler = (...args: any[]) => Promise<any>

function fakeContext(cwd: string | undefined, services: Record<string, unknown> = {}) {
  const tools: { name: string }[] = []
  const sections: { name: string; text: string }[] = []
  const skills: Record<string, unknown>[] = []
  const handlers = new Map<string, Handler>()
  const disposers: (() => void)[] = []
  const ctx = {
    effect(fn: () => () => void) { disposers.push(fn()) },
    on(name: string, h: Handler) { handlers.set(name, h) },
    tools: { register: (d: { name: string }) => (tools.push(d), () => tools.splice(tools.indexOf(d), 1)) },
    systemPrompt: { section: (s: { name: string; text: string }) => (sections.push(s), () => sections.splice(sections.indexOf(s), 1)) },
    skills: { register: (s: Record<string, unknown>) => (skills.push(s), () => skills.splice(skills.indexOf(s), 1)) },
    workingDirectory: { ensure: async () => cwd },
    ...services,
    /** cordis ctx.plugin: a sub-plugin applies only when every service it injects exists. */
    plugin(def: { inject: string[]; apply: (scope: unknown) => void }) {
      if (def.inject.every((n) => n in services)) def.apply(ctx)
    },
  }
  return { ctx, tools, sections, skills, handlers, dispose: () => disposers.reverse().forEach((d) => d()) }
}

const agent = { id: 'agent-1' }
const PAGE = `import {VStack} from '@astryxdesign/core/Layout';\nexport default function Page() { return <VStack gap={2}>hi</VStack> }\n`

function boot(cwd: string | undefined, services: Record<string, unknown> = {}) {
  const f = fakeContext(cwd, services)
  const runner = fakeRunner()
  apply(f.ctx as never, {}, { run: runner.run })
  return { ...f, runner }
}

describe('host plugin registration', () => {
  it('declares its services and registers 6 tools, one prompt section and the astryx-page skill; dispose cleans up', () => {
    expect(inject).toEqual(['tools', 'systemPrompt', 'skills', 'workingDirectory'])
    const f = boot(undefined)
    expect(f.tools.map((t) => t.name)).toEqual(['astryx_build', 'astryx_template', 'astryx_component', 'astryx_search', 'astryx_render', 'astryx_screenshot'])
    expect(f.sections.map((s) => s.name)).toEqual([PROMPT_SECTION_NAME])
    expect(f.skills).toHaveLength(1)
    expect(f.skills[0]).toMatchObject({ name: SKILL_NAME, source: 'bundled' })
    expect(typeof f.skills[0]!.description).toBe('string')
    expect(typeof f.skills[0]!.whenToUse).toBe('string')
    f.dispose()
    expect(f.tools).toHaveLength(0)
    expect(f.sections).toHaveLength(0)
    expect(f.skills).toHaveLength(0)
  })

  it('prompt section is a stable constant carrying the playbook rules and the Chinese workflow', () => {
    const f = boot(undefined)
    expect(f.sections[0]!.text).toBe(PROMPT_TEXT)
    for (const rule of catalog.rules) expect(PROMPT_TEXT).toContain(rule)
    expect(PROMPT_TEXT).toContain('英文')
    expect(PROMPT_TEXT).toContain('astryx_component')
    expect(PROMPT_TEXT).toContain('预览工具条')
  })

  it('every template id the skill names exists; the skill covers copy length, stylex and long templates', () => {
    const ids = new Set(catalog.templates.map((t) => t.id))
    const named = REQUEST_TABLE.flatMap(([, v]) => v.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []).filter((w) => w.length > 2)
    expect(named.length).toBeGreaterThan(15)
    for (const id of named) expect(ids.has(id), id).toBe(true)
    for (const id of [...STYLEX_TEMPLATES, ...LONG_TEMPLATES.map(([id]) => id)]) expect(ids.has(id), id).toBe(true)
    expect(STYLEX_TEMPLATES).toHaveLength(15)
    expect(SKILL_CONTENT).toContain('中文文案长度')
    expect(SKILL_CONTENT).toContain('canvas-editor（2876 行）')
    expect(SKILL_CONTENT).toContain('StyleX 模板')
  })
})

describe('rpc registration', () => {
  it('registers exact /api/astryx-studio/* Fetch routes through a sub-plugin that injects connection', async () => {
    const paths: string[] = []
    const connection = { fetch: { register: (r: { path: string }) => (paths.push(r.path), async () => {}) } }
    boot(undefined)
    expect(paths).toEqual([])
    boot(tempProject(), { connection })
    expect(paths).toEqual(['status', 'openPreview', 'reportRuntimeError', 'exportHtml', 'gallery', 'startTemplate', 'getPrefs', 'setPrefs', 'thumb'].map((e) => `/api/astryx-studio/${e}`))
  })
})

describe('tools/pre-execute', () => {
  it('asks the user before astryx_template scaffolds a new project', async () => {
    const f = boot(tempProject({}, false))
    const d = await f.handlers.get('tools/pre-execute')!({ name: 'astryx_template', callId: 'c', arguments: {}, agent, signal: new AbortController().signal }, async () => ({ kind: 'allow' }))
    expect(d.kind).toBe('ask')
    expect(d.displayReason.zh).toContain('astryx-app')
  })

  it('does not ask when a workspace exists, and keeps an upstream deny', async () => {
    const f = boot(tempProject())
    const pre = f.handlers.get('tools/pre-execute')!
    const exec = { name: 'astryx_template', callId: 'c', arguments: {}, agent, signal: new AbortController().signal }
    expect(await pre(exec, async () => ({ kind: 'allow' }))).toEqual({ kind: 'allow' })
    const g = boot(tempProject({}, false))
    expect(await g.handlers.get('tools/pre-execute')!(exec, async () => ({ kind: 'deny', reason: 'policy' }))).toEqual({ kind: 'deny', reason: 'policy' })
  })
})

describe('tools/post-execute + agent/pre-step', () => {
  it('a bad edit gets astryx verify ✗ as an additional context; tsc ✓ arrives at the next step', async () => {
    const ws = tempProject({ 'src/pages/main/page.tsx': PAGE })
    const file = join(ws, 'src/pages/main/page.tsx')
    const f = boot(ws)
    const signal = new AbortController().signal
    const exec = { name: 'edit', callId: 'e1', arguments: { file_path: 'src/pages/main/page.tsx' }, agent, signal }
    await f.handlers.get('tools/pre-execute')!(exec, async () => ({ kind: 'allow' }))
    writeFileSync(file, PAGE.replace('hi', '<div style={{color: "red"}}>hi</div>'))
    const d = await f.handlers.get('tools/post-execute')!(exec, { isError: false, value: { path: file }, content: [] }, async () => ({ kind: 'accept' }))
    expect(d.kind).toBe('accept')
    expect(d.additionalContexts).toHaveLength(1)
    const msg = d.additionalContexts[0]
    expect(msg.role).toBe('user')
    expect(msg.source).toEqual({ kind: MESSAGE_SOURCE })
    expect(msg.content[0].text).toMatch(/^astryx verify ✗/)
    expect(msg.content[0].text).toContain('<div>')
    expect(msg.content[0].text).toContain('style={{}}')

    const tscCall = f.runner.calls.find((c) => c.args.includes('--noEmit'))!
    tscCall.resolve(ok({ ms: 2100 }))
    await tick()
    const step = await f.handlers.get('agent/pre-step')!({ agent, messages: [], turn: 1, step: 2, signal }, async () => ({ kind: 'enter', messages: [] }))
    expect(step.messages.map((m: any) => m.content[0].text)).toEqual(['astryx verify ✓ (tsc 2.1s)'])
    const again = await f.handlers.get('agent/pre-step')!({ agent, messages: [], turn: 1, step: 3, signal }, async () => ({ kind: 'enter', messages: [] }))
    expect(again.messages).toEqual([])
  })

  it('a clean edit adds nothing; failed tool results and non-file tools pass through', async () => {
    const ws = tempProject({ 'src/pages/main/page.tsx': PAGE })
    const file = join(ws, 'src/pages/main/page.tsx')
    const f = boot(ws)
    const post = f.handlers.get('tools/post-execute')!
    const signal = new AbortController().signal
    const exec = { name: 'write', callId: 'w1', arguments: { file_path: file }, agent, signal }
    await f.handlers.get('tools/pre-execute')!(exec, async () => ({ kind: 'allow' }))
    writeFileSync(file, PAGE.replace('hi', '你好'))
    expect(await post(exec, { isError: false, value: { path: file }, content: [] }, async () => ({ kind: 'accept' }))).toEqual({ kind: 'accept' })
    expect(await post({ ...exec, callId: 'w2' }, { isError: true, error: {}, content: [] }, async () => ({ kind: 'accept' }))).toEqual({ kind: 'accept' })
    expect(await post({ ...exec, name: 'bash' }, { isError: false, value: {}, content: [] }, async () => ({ kind: 'accept' }))).toEqual({ kind: 'accept' })
  })

  it('the next step waits for a tsc run still in flight (model ends its turn right after an edit)', async () => {
    const ws = tempProject({ 'src/pages/main/page.tsx': PAGE })
    const file = join(ws, 'src/pages/main/page.tsx')
    const f = boot(ws)
    const signal = new AbortController().signal
    await f.handlers.get('tools/post-execute')!({ name: 'edit', callId: 'e', arguments: {}, agent, signal }, { isError: false, value: { path: file }, content: [] }, async () => ({ kind: 'accept' }))
    const run = f.runner.calls.find((c) => c.args.includes('--noEmit'))!
    setTimeout(() => run.resolve(ok({ ms: 600 })), 30)
    const step = await f.handlers.get('agent/pre-step')!({ agent, messages: [], signal }, async () => ({ kind: 'enter', messages: [] }))
    expect(step.messages[0].content[0].text).toBe('astryx verify ✓ (tsc 0.6s)')
  })

  it('a superseded (cancelled) tsc run injects nothing', async () => {
    const ws = tempProject({ 'src/pages/main/page.tsx': PAGE })
    const file = join(ws, 'src/pages/main/page.tsx')
    const f = boot(ws)
    const post = f.handlers.get('tools/post-execute')!
    const signal = new AbortController().signal
    for (const id of ['a', 'b']) {
      await post({ name: 'write', callId: id, arguments: {}, agent, signal }, { isError: false, value: { path: file }, content: [] }, async () => ({ kind: 'accept' }))
    }
    const runs = f.runner.calls.filter((c) => c.args.includes('--noEmit'))
    expect(runs).toHaveLength(2)
    expect(runs[0]!.signal?.aborted).toBe(true)
    await tick()
    setTimeout(() => runs[1]!.resolve(ok({ code: 2, stdout: "src/pages/main/page.tsx(2,40): error TS2322: Type '\"x\"' is not assignable to type 'number'." })), 20)
    const s1 = await f.handlers.get('agent/pre-step')!({ agent, messages: [], signal }, async () => ({ kind: 'enter', messages: [] }))
    // Exactly one message: the newest run's result; the cancelled first run contributed nothing.
    expect(s1.messages).toHaveLength(1)
    expect(s1.messages[0].content[0].text).toContain('TS2322')
    const s2 = await f.handlers.get('agent/pre-step')!({ agent, messages: [], signal }, async () => ({ kind: 'enter', messages: [] }))
    expect(s2.messages).toEqual([])
  })
})

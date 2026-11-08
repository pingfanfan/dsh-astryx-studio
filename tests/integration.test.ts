// Real CLI + real pnpm + real tsc. Opt-in (network, ~1 min): ASTRYX_E2E=1 pnpm vitest run tests/integration.test.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { loadAstryxApi } from '../src/astryx.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { runProcess } from '../src/proc.js'
import { createTools, TOOL_NAMES } from '../src/tools.js'
import { createTscScheduler } from '../src/verify/tsc.js'
import { Verifier } from '../src/verify/verifier.js'
import { tempProject } from './helpers.js'

describe.runIf(process.env.ASTRYX_E2E === '1')('real scaffold → template → verify', () => {
  it('scaffolds, writes dashboard, tsc passes, a wrong prop fails tsc', { timeout: 600_000 }, async () => {
    const cwd = tempProject({}, false)
    const tsc = createTscScheduler({ run: runProcess, timeoutMs: 120_000 })
    const tools = createTools({ api: loadAstryxApi, cwdOf: async () => cwd, config: DEFAULT_CONFIG, run: runProcess, tsc })
    const get = (n: string) => tools.find((t) => t.name === n) as ToolDefinition
    const exec = { signal: new AbortController().signal } as ToolRunContext

    const kit = (await get(TOOL_NAMES.build).execute({ keywords: 'course sales dashboard revenue orders' }, exec)) as { start: { name: string } }
    const v = (await get(TOOL_NAMES.template).execute({ id: kit.start.name }, exec)) as { workspace: string; file: string; scaffolded: boolean; installed: string[] }
    expect(v.scaffolded).toBe(true)
    console.log('template result', JSON.stringify(v))

    const verifier = new Verifier({ tsc, maxReportedErrors: 5 })
    const file = join(v.workspace, v.file)
    const clean = await tsc.schedule(v.workspace)
    console.log('tsc on template:', JSON.stringify(clean))
    expect(clean?.kind).toBe('pass')

    // Introduce a wrong prop on the first VStack.
    const src = readFileSync(file, 'utf8')
    verifier.snapshot('e1', 'edit', { file_path: file }, cwd)
    const broken = src.replace(/<VStack\b/, '<VStack colour="red"')
    expect(broken).not.toBe(src)
    writeFileSync(file, broken)
    const sync = await verifier.afterWrite({ callId: 'e1', name: 'edit', value: { path: file }, cwd, workspace: v.workspace, agentId: 'a' })
    expect(sync).toEqual([])
    const bad = await tsc.schedule(v.workspace)
    console.log(verifier.formatTsc(bad!))
    expect(bad?.kind).toBe('fail')

    writeFileSync(file, src)
    const fixed = await tsc.schedule(v.workspace)
    console.log(verifier.formatTsc(fixed!))
    expect(fixed?.kind).toBe('pass')

    // The scaffold + template must also bundle under Vite (catches CSS/resolution mistakes tsc cannot see).
    const vite = await runProcess(join(v.workspace, 'node_modules/.bin/vite'), ['build', '--logLevel', 'error'], { cwd: v.workspace, timeoutMs: 180_000 })
    console.log('vite build', vite.code, vite.stderr.slice(-800))
    expect(vite.code).toBe(0)
  })
})

describe.runIf(process.env.ASTRYX_E2E === '1')('real preview Vite', () => {
  it('harness serves the page and blocks the rest of the workspace', { timeout: 600_000 }, async () => {
    const { spawn } = await import('node:child_process')
    const { PreviewManager } = await import('../src/preview/manager.js')
    const cwd = tempProject({}, false)
    const tsc = createTscScheduler({ run: runProcess, timeoutMs: 120_000 })
    const tools = createTools({ api: loadAstryxApi, cwdOf: async () => cwd, config: DEFAULT_CONFIG, run: runProcess, tsc })
    const exec = { signal: new AbortController().signal } as ToolRunContext
    const v = (await (tools.find((t) => t.name === TOOL_NAMES.template) as ToolDefinition).execute({ id: 'dashboard' }, exec)) as { workspace: string; file: string }
    writeFileSync(join(v.workspace, 'secret.env'), 'TOKEN=1')

    const children: ReturnType<typeof spawn>[] = []
    const m = new PreviewManager({ run: runProcess, installTimeoutMs: 300_000 })
    m.setSpawner((argv, cwd2) => {
      const child = spawn(argv[0]!, argv.slice(1), { cwd: cwd2, env: { ...process.env, FORCE_COLOR: '0' } })
      children.push(child)
      return {
        onOutput: (l) => { child.stdout!.on('data', (d) => l(String(d))); child.stderr!.on('data', (d) => l(String(d))) },
        done: new Promise((r) => child.on('close', (code, signal) => r({ exitCode: code, signal }))),
        terminate: () => child.kill('SIGTERM'),
      }
    })
    m.templateWritten('s', v.workspace, v.file)
    const st = await m.open('s')
    console.log('preview status', JSON.stringify({ state: st.preview.state, url: st.preview.url, error: st.preview.error }))
    expect(st.preview.state).toBe('running')
    const url = st.preview.url!
    const html = await fetch(url)
    expect(html.status).toBe(200)
    const main = await fetch(url + 'main.tsx')
    expect(main.status).toBe(200)
    const page = await fetch(url + '@fs' + join(v.workspace, v.file))
    console.log('page module', page.status)
    expect(page.status).toBe(200)
    const secret = await fetch(url + '@fs' + join(v.workspace, 'secret.env'))
    console.log('secret.env via /@fs', secret.status)
    expect(secret.status).toBe(403)
    const pkg = await fetch(url + '@fs' + join(v.workspace, 'package.json'))
    expect(pkg.status).toBe(403)
    m.stopAll()
    await new Promise((r) => setTimeout(r, 300))
    expect(children.every((c) => c.killed || c.exitCode !== null)).toBe(true)
  })
})

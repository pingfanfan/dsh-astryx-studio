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

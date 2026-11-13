import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTscScheduler, parseTscOutput } from '../src/verify/tsc.js'
import { pathsFromArgs, pathsFromValue, Verifier, writesFromValue } from '../src/verify/verifier.js'
import { fakeRunner, ok, tempProject, tick } from './helpers.js'

const PAGE = `import {VStack} from '@astryxdesign/core/Layout';\nexport default function Page() { return <VStack gap={2}>hi</VStack> }\n`

function setup(files: Record<string, string> = { 'src/page.tsx': PAGE }) {
  const ws = tempProject(files)
  const { run, calls } = fakeRunner()
  const tsc = createTscScheduler({ run, timeoutMs: 30_000 })
  const verifier = new Verifier({ tsc, maxReportedErrors: 5 })
  return { ws, run, calls, tsc, verifier }
}

describe('argument and result paths', () => {
  it('reads paths from write/edit/str_replace_editor/apply_patch', () => {
    expect(pathsFromArgs('edit', { file_path: 'a.tsx' })).toEqual(['a.tsx'])
    expect(pathsFromArgs('str_replace_editor', { path: 'b.tsx' })).toEqual(['b.tsx'])
    const patch = '*** Begin Patch\n*** Update File: src/a.tsx\n@@\n-x\n+y\n*** Add File: src/b.ts\n+z\n*** End Patch'
    expect(pathsFromArgs('apply_patch', { input: patch })).toEqual(['src/a.tsx', 'src/b.ts'])
    expect(pathsFromValue('write', { path: '/w/a.tsx' }, '/w')).toEqual(['/w/a.tsx'])
    expect(
      pathsFromValue('apply_patch', { operations: [{ kind: 'update', path: 'a.tsx' }, { kind: 'delete', path: 'b.tsx' }, { kind: 'move', path: 'c.tsx', destination: 'd.tsx' }] }, '/w'),
    ).toEqual(['/w/a.tsx', '/w/d.tsx'])
  })
})

describe('Verifier pre/post', () => {
  it('snapshot before + diff after: an edit that adds a <div> is reported, tsc starts', async () => {
    const { ws, calls, verifier } = setup()
    const file = join(ws, 'src/page.tsx')
    verifier.snapshot('c1', 'edit', { file_path: 'src/page.tsx' }, ws)
    writeFileSync(file, PAGE.replace('hi', '<div>hi</div>'))
    const reports = await verifier.afterWrite({ callId: 'c1', name: 'edit', value: { path: file }, cwd: ws, workspace: ws, agentId: 'a1' })
    expect(reports).toHaveLength(1)
    expect(reports[0]!.lint.map((l) => l.rule)).toEqual(['div'])
    expect(verifier.formatReports(reports)).toContain('astryx verify ✗')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.args).toContain('--noEmit')
  })

  it('a clean edit reports nothing; existing <div>s in the old file are not counted', async () => {
    const before = PAGE.replace('hi', '<div>hi</div>')
    const { ws, verifier } = setup({ 'src/page.tsx': before })
    const file = join(ws, 'src/page.tsx')
    verifier.snapshot('c1', 'edit', { file_path: file }, ws)
    writeFileSync(file, before.replace('hi', '你好'))
    expect(await verifier.afterWrite({ callId: 'c1', name: 'edit', value: { path: file }, cwd: ws, workspace: ws, agentId: 'a1' })).toEqual([])
  })

  it('reports syntax errors synchronously', async () => {
    const { ws, verifier } = setup()
    const file = join(ws, 'src/page.tsx')
    verifier.snapshot('c1', 'write', { file_path: file }, ws)
    writeFileSync(file, PAGE.replace('</VStack>', '</HStack>'))
    const reports = await verifier.afterWrite({ callId: 'c1', name: 'write', value: { path: file }, cwd: ws, workspace: ws, agentId: 'a1' })
    expect(reports[0]!.syntax.length).toBeGreaterThan(0)
  })

  it('ignores files outside the workspace, non-ts files, tool configs and other tools', async () => {
    const { ws, calls, verifier } = setup({ 'src/page.tsx': PAGE, 'README.md': '', 'vite.config.ts': "import path from 'node:path'\n" })
    for (const [name, value] of [['write', { path: join(ws, 'README.md') }], ['write', { path: join(ws, 'vite.config.ts') }], ['write', { path: '/tmp/elsewhere.tsx' }], ['bash', { path: join(ws, 'src/page.tsx') }]] as const) {
      expect(await verifier.afterWrite({ callId: 'x', name, value, cwd: ws, workspace: ws, agentId: 'a1' })).toEqual([])
    }
    expect(calls).toHaveLength(0)
  })

  it('tsc result is collected once, at the next step of the agent that wrote', async () => {
    const { ws, calls, verifier } = setup()
    const file = join(ws, 'src/page.tsx')
    await verifier.afterWrite({ callId: 'c1', name: 'write', value: { path: file }, cwd: ws, workspace: ws, agentId: 'a1' })
    expect(await verifier.collect('a1')).toBeUndefined()
    calls[0]!.resolve(ok({ code: 2, stdout: `src/page.tsx(2,40): error TS2322: Type 'string' is not assignable to type 'number'.` }))
    await tick()
    const got = await verifier.collect('a1')
    expect(got?.outcome.kind).toBe('fail')
    expect(verifier.formatTsc(got!.outcome)).toMatch(/astryx verify ✗ \(tsc 1\.2s\)\nsrc\/page\.tsx:2 TS2322/)
    expect(await verifier.collect('a1')).toBeUndefined()
    expect(await verifier.collect('other')).toBeUndefined()
  })
})

describe('collect waits for a run in flight', () => {
  it('waits up to waitMs and returns the result that lands meanwhile', async () => {
    const { ws, calls, verifier } = setup()
    await verifier.afterWrite({ callId: 'c1', name: 'write', value: { path: join(ws, 'src/page.tsx') }, cwd: ws, workspace: ws, agentId: 'a1' })
    setTimeout(() => calls[0]!.resolve(ok({ ms: 800 })), 20)
    expect((await verifier.collect('a1', 2000))?.outcome).toEqual({ kind: 'pass', ms: 800 })
  })

  it('gives up after waitMs; the result is delivered at a later step', async () => {
    const { ws, calls, verifier } = setup()
    await verifier.afterWrite({ callId: 'c1', name: 'write', value: { path: join(ws, 'src/page.tsx') }, cwd: ws, workspace: ws, agentId: 'a1' })
    const t0 = Date.now()
    expect(await verifier.collect('a1', 30)).toBeUndefined()
    expect(Date.now() - t0).toBeLessThan(1000)
    calls[0]!.resolve(ok())
    await tick()
    expect((await verifier.collect('a1'))?.outcome.kind).toBe('pass')
  })

  it('stops waiting when the step is aborted', async () => {
    const { ws, verifier } = setup()
    await verifier.afterWrite({ callId: 'c1', name: 'write', value: { path: join(ws, 'src/page.tsx') }, cwd: ws, workspace: ws, agentId: 'a1' })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 10)
    const t0 = Date.now()
    expect(await verifier.collect('a1', 10_000, ac.signal)).toBeUndefined()
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('tsc scheduler', () => {
  it('a newer write cancels the run in flight, and the cancelled run injects nothing', async () => {
    const { ws, calls, tsc } = setup()
    const first = tsc.schedule(ws)
    const second = tsc.schedule(ws)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.signal?.aborted).toBe(true)
    expect(await first).toBeUndefined()
    expect(tsc.take(ws)).toBeUndefined()
    calls[1]!.resolve(ok())
    expect(await second).toEqual({ kind: 'pass', ms: 1200 })
    expect(tsc.take(ws)).toEqual({ kind: 'pass', ms: 1200 })
  })

  it('a timeout is "unverified", not a failure', async () => {
    const { ws, calls, tsc } = setup()
    const p = tsc.schedule(ws)
    calls[0]!.resolve(ok({ timedOut: true, code: null, ms: 30_000 }))
    expect((await p)?.kind).toBe('unverified')
  })

  it('parses tsc diagnostics relative to the workspace', () => {
    expect(parseTscOutput(`/w/src/a.tsx(3,5): error TS2339: Property 'colour' does not exist.\nnoise`, '/w')).toEqual([
      { file: 'src/a.tsx', line: 3, column: 5, code: 'TS2339', message: "Property 'colour' does not exist." },
    ])
  })

  it('uses the workspace tsc with an incremental build info under .astryx-studio', async () => {
    const { ws, calls, tsc } = setup()
    void tsc.schedule(ws)
    expect(calls[0]!.args.join(' ')).toContain('--incremental --tsBuildInfoFile .astryx-studio/tsbuildinfo')
    expect(readFileSync(join(ws, 'package.json'), 'utf8')).toContain('@astryxdesign/core')
    tsc.dispose()
  })
})

describe('review fixes', () => {
  it('an apply_patch move is judged against the source file, so a rename is not a new file', async () => {
    const before = PAGE.replace('hi', '<div>hi</div>')
    const { ws, verifier } = setup({ 'src/old.tsx': before })
    const patch = '*** Begin Patch\n*** Update File: src/old.tsx\n*** Move to: src/new.tsx\n@@\n-x\n+y\n*** End Patch'
    verifier.snapshot('m1', 'apply_patch', { input: patch }, ws)
    writeFileSync(join(ws, 'src/new.tsx'), before)
    const value = { operations: [{ kind: 'update', path: 'src/old.tsx', destination: 'src/new.tsx', status: 'completed' }] }
    expect(await verifier.afterWrite({ callId: 'm1', name: 'apply_patch', value, cwd: ws, workspace: ws, agentId: 'a1' })).toEqual([])
  })

  it('skips apply_patch operations that did not complete', () => {
    expect(writesFromValue('apply_patch', { operations: [{ kind: 'update', path: 'a.tsx', status: 'failed' }, { kind: 'add', path: 'b.tsx', status: 'completed' }] }, '/w')).toEqual([
      { file: '/w/b.tsx', from: '/w/b.tsx' },
    ])
  })

  it('snapshots are keyed by any property key (DSH execution tokens are symbols)', async () => {
    const { ws, verifier } = setup()
    const file = join(ws, 'src/page.tsx')
    const a = Symbol('a')
    const b = Symbol('b') // same model call id in practice; distinct executions
    verifier.snapshot(a, 'edit', { file_path: file }, ws)
    writeFileSync(file, PAGE.replace('hi', '<div>hi</div>'))
    verifier.snapshot(b, 'edit', { file_path: file }, ws)
    expect((await verifier.afterWrite({ callId: a, name: 'edit', value: { path: file }, cwd: ws, workspace: ws, agentId: 'a1' }))[0]!.lint.map((l) => l.rule)).toEqual(['div'])
    expect(await verifier.afterWrite({ callId: b, name: 'edit', value: { path: file }, cwd: ws, workspace: ws, agentId: 'a1' })).toEqual([])
  })

  it('each agent that wrote in the workspace sees the tsc result once', async () => {
    const { ws, calls, verifier } = setup()
    const file = join(ws, 'src/page.tsx')
    await verifier.afterWrite({ callId: 'p', name: 'write', value: { path: file }, cwd: ws, workspace: ws, agentId: 'parent' })
    await verifier.afterWrite({ callId: 's', name: 'write', value: { path: file }, cwd: ws, workspace: ws, agentId: 'sub' })
    calls[1]!.resolve(ok({ code: 2, stdout: `src/page.tsx(2,40): error TS2322: bad.` }))
    await tick()
    expect((await verifier.collect('sub'))?.outcome.kind).toBe('fail')
    expect((await verifier.collect('parent'))?.outcome.kind).toBe('fail')
    expect(await verifier.collect('sub')).toBeUndefined()
    expect(await verifier.collect('parent')).toBeUndefined()
  })

  it('a tsc that cannot even be set up is "unverified", not an unhandled rejection', async () => {
    const tsc = createTscScheduler({ run: async () => { throw new Error('spawn ENOENT') }, timeoutMs: 1000 })
    expect((await tsc.schedule('/nonexistent/readonly/ws'))?.kind).toBe('unverified')
  })
})

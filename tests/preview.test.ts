import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { formatRuntimeErrors, PreviewManager } from '../src/preview/manager.js'
import { LOAD_RETRY_DELAYS, missingPreviewPackages, PREVIEW_DIR, previewFiles, writePreviewHarness } from '../src/preview/scaffold.js'
import { parseVitePort, PreviewServer, type SpawnedProcess, type Spawner } from '../src/preview/server.js'
import { createRpcHandler, fetchRoutes } from '../src/rpc.js'
import { THEMES } from '../src/shared/preview-protocol.js'
import { fakeRunner, ok, tempProject, tick } from './helpers.js'

/** A fake ctx.subprocess process the test drives. */
function fakeSpawner() {
  const procs: { argv: readonly string[]; cwd: string; emit: (s: string) => void; exit: (code: number | null) => void; terminated: boolean }[] = []
  const spawn: Spawner = (argv, cwd) => {
    const listeners: ((s: string) => void)[] = []
    let exit!: (o: { exitCode: number | null; signal: string | null }) => void
    const done = new Promise<{ exitCode: number | null; signal: string | null }>((r) => (exit = r))
    const entry = { argv, cwd, emit: (s: string) => listeners.forEach((l) => l(s)), exit: (code: number | null) => exit({ exitCode: code, signal: null }), terminated: false }
    procs.push(entry)
    const proc: SpawnedProcess = {
      onOutput: (l) => listeners.push(l),
      done,
      terminate: () => {
        entry.terminated = true
        exit({ exitCode: null, signal: 'SIGTERM' })
      },
    }
    return proc
  }
  return { spawn, procs }
}

const READY = (port: number) => `\n  \u001b[32mVITE\u001b[39m v8.3.6  ready in 412 ms\n\n  ➜  Local:   http://127.0.0.1:${port}/\n`

describe('preview harness scaffold', () => {
  it('writes vite.config/index.html/main.tsx under .astryx-studio and git-ignores it, without touching the user vite.config', () => {
    const ws = tempProject({ 'vite.config.ts': '// mine\n', '.gitignore': 'node_modules\n' })
    const written = writePreviewHarness(ws)
    expect(written.sort()).toEqual(['.astryx-studio/index.html', '.astryx-studio/main.tsx', '.astryx-studio/vite.config.ts', '.gitignore'])
    expect(readFileSync(join(ws, 'vite.config.ts'), 'utf8')).toBe('// mine\n')
    expect(readFileSync(join(ws, '.gitignore'), 'utf8')).toBe('node_modules\n.astryx-studio\n')
    expect(writePreviewHarness(ws)).toEqual([]) // idempotent
  })

  it('vite.config narrows fs.allow to the harness, src and node_modules, binds 127.0.0.1, passes rootDir to astryxStylex', () => {
    const ws = '/w'
    const cfg = previewFiles(ws)[`${PREVIEW_DIR}/vite.config.ts`]!
    expect(cfg).toContain("host: '127.0.0.1'")
    expect(cfg).toContain('strict: true')
    const allow = cfg.slice(cfg.indexOf('allow: ['), cfg.indexOf(']', cfg.indexOf('allow: [')))
    expect(allow).toContain('"/w/.astryx-studio"')
    expect(allow).toContain('"/w/src"')
    expect(allow).toContain('"/w/node_modules"')
    expect(allow).not.toMatch(/"\/w"\s*,/)
    expect(cfg).toContain('astryxStylex({rootDir: workspace})')
    // Every dependency optimized at startup: no mid-load "optimized dependencies changed. reloading".
    expect(cfg).toContain("entries: ['index.html', '../src/**/*.tsx']")
    expect(cfg).toContain("'react-dom/client'")
  })

  it('main.tsx reads ?page&theme&dark, preloads all 7 themes, and reports errors to the parent', () => {
    const main = previewFiles('/w')[`${PREVIEW_DIR}/main.tsx`]!
    for (const t of THEMES) {
      expect(main).toContain(`import '@astryxdesign/theme-${t}/theme.css';`)
      expect(main).toContain(`import {${t}Theme} from '@astryxdesign/theme-${t}/built';`)
    }
    for (const s of ["q.get('page')", "q.get('theme')", "q.get('dark')", 'import.meta.glob', "import.meta.hot.on('vite:error'", "addEventListener('error'", "addEventListener('unhandledrejection'", 'componentDidCatch', 'postMessage', "import.meta.hot.on('vite:afterUpdate'", '<Theme theme={THEMES[params.theme]}']) {
      expect(main).toContain(s)
    }
    expect(main).not.toContain('astryx.css')
  })

  it('main.tsx swaps in the HMR-updated page module, so a rewritten page with a new default component is not left stale', () => {
    const main = previewFiles('/w')[`${PREVIEW_DIR}/main.tsx`]!
    // Re-imports the exact module version the Vite client just executed…
    expect(main).toContain("import(/* @vite-ignore */ u.path + '?t=' + u.timestamp)")
    expect(main).toContain("u.path.endsWith('/' + params.page)")
    expect(main).toContain("u.type === 'js-update'")
    // …and renders its default export; 'updated' is posted only after that swap.
    expect(main).toContain('setPage((old) => (old === next ? old : next))')
    expect(main).toContain(".finally(() => post({type: 'updated'}))")
    // Readiness for astryx_screenshot.
    expect(main).toContain("document.documentElement.dataset.astryxStudio = 'ready'")
  })

  it('main.tsx retries a page module that fails to fetch (install / re-optimize) before reporting it', () => {
    const main = previewFiles('/w')[`${PREVIEW_DIR}/main.tsx`]!
    expect(main).toContain(`const RETRY_DELAYS = ${JSON.stringify(LOAD_RETRY_DELAYS)};`)
    expect(main).toContain('location.reload()')
    expect(main).toContain('sessionStorage')
    expect(main).toContain('正在等待依赖安装或预构建完成')
    // The pattern the harness uses must match what browsers actually throw, and not ordinary bugs.
    const pattern = /const FETCH_ERROR = (\/.+\/i);/.exec(main)?.[1]
    expect(pattern).toBeDefined()
    const re = new Function(`return ${pattern}`)() as RegExp
    for (const m of [
      'Failed to fetch dynamically imported module: http://127.0.0.1:5174/src/pages/main/page.tsx', // Chromium
      'Importing a module script failed.', // Safari
      'error loading dynamically imported module: http://127.0.0.1:5174/src/pages/main/page.tsx', // Firefox
    ])
      expect(re.test(m)).toBe(true)
    for (const m of ["Cannot read properties of undefined (reading 'map')", 'x is not defined']) expect(re.test(m)).toBe(false)
    // About 50 s in all: long enough for a template's pnpm add, short enough to surface a real failure.
    const total = LOAD_RETRY_DELAYS.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(30_000)
    expect(total).toBeLessThanOrEqual(60_000)
  })

  it('lists theme packages the workspace still lacks', () => {
    const ws = tempProject()
    expect(missingPreviewPackages(ws)).toContain('@astryxdesign/theme-gothic')
    mkdirSync(join(ws, 'node_modules/@astryxdesign/theme-gothic'), { recursive: true })
    writeFileSync(join(ws, 'node_modules/@astryxdesign/theme-gothic/package.json'), '{}')
    expect(missingPreviewPackages(ws)).not.toContain('@astryxdesign/theme-gothic')
  })
})

describe('preview server lifecycle', () => {
  it('parses the port from Vite output (with ANSI colours)', () => {
    expect(parseVitePort(READY(51234))).toBe(51234)
    expect(parseVitePort('  ➜  Local:   http://localhost:5173/')).toBe(5173)
    expect(parseVitePort('building...')).toBeUndefined()
  })

  it('spawns workspace vite on 127.0.0.1 with the harness config, reports running with the parsed port', async () => {
    const { spawn, procs } = fakeSpawner()
    const server = new PreviewServer({ workspace: '/w', spawn, pickPort: async () => 40001 })
    const p = server.ensure()
    const again = server.ensure() // concurrent callers share one start
    await vi.waitFor(() => expect(procs).toHaveLength(1))
    expect(procs[0]!.argv).toEqual(['/w/node_modules/.bin/vite', '--config', '.astryx-studio/vite.config.ts', '--host', '127.0.0.1', '--port', '40001', '--strictPort'])
    expect(procs[0]!.cwd).toBe('/w')
    procs[0]!.emit(READY(40001))
    expect((await p).state).toBe('running')
    expect((await again).url).toBe('http://127.0.0.1:40001/')
    expect(server.status().log.some((l) => l.includes('Local:'))).toBe(true)
  })

  it('restarts once after a crash, then reports an error', async () => {
    const { spawn, procs } = fakeSpawner()
    const server = new PreviewServer({ workspace: '/w', spawn, pickPort: async () => 40002 })
    const p = server.ensure()
    await vi.waitFor(() => expect(procs).toHaveLength(1))
    procs[0]!.emit(READY(40002))
    await p
    procs[0]!.exit(1)
    await vi.waitFor(() => expect(procs).toHaveLength(2))
    procs[1]!.emit(READY(40002))
    await vi.waitFor(() => expect(server.status().state).toBe('running'))
    procs[1]!.exit(1)
    await vi.waitFor(() => expect(server.status().state).toBe('error'))
    expect(procs).toHaveLength(2)
    expect(server.status().error).toMatch(/crashed again/)
  })

  it('reports an error when Vite exits before it is ready, and stop() kills a running Vite', async () => {
    const { spawn, procs } = fakeSpawner()
    const s1 = new PreviewServer({ workspace: '/w', spawn, pickPort: async () => 1 })
    const p = s1.ensure()
    await vi.waitFor(() => expect(procs).toHaveLength(1))
    procs[0]!.emit('Error: Cannot find module vite\n')
    procs[0]!.exit(1)
    const st = await p
    expect(st.state).toBe('error')
    expect(st.log.join('\n')).toContain('Cannot find module vite')

    const s2 = new PreviewServer({ workspace: '/w', spawn, pickPort: async () => 2 })
    const p2 = s2.ensure()
    await vi.waitFor(() => expect(procs).toHaveLength(2))
    procs[1]!.emit(READY(2))
    await p2
    s2.stop()
    expect(procs[1]!.terminated).toBe(true)
    await tick()
    expect(procs).toHaveLength(2) // no restart after an intentional stop
    expect(s2.status().state).toBe('idle')
  })
})

describe('preview manager', () => {
  function manager(now = { t: 1000 }) {
    const runner = fakeRunner()
    const { spawn, procs } = fakeSpawner()
    const m = new PreviewManager({ run: runner.run, installTimeoutMs: 1000, now: () => now.t })
    m.setSpawner(spawn)
    return { m, runner, procs, now }
  }

  it('is unavailable without ctx.subprocess', async () => {
    const m = new PreviewManager({ run: fakeRunner().run, installTimeoutMs: 1 })
    expect((await m.ensure('/w')).state).toBe('unavailable')
    expect(m.status('s').preview.state).toBe('unavailable')
  })

  it('templateWritten records the page, bumps openSeq, writes the harness, installs missing themes, starts Vite', async () => {
    const ws = tempProject()
    const { m, runner, procs } = manager()
    m.templateWritten('s1', ws, 'src/pages/main/page.tsx')
    expect(m.status('s1')).toMatchObject({ workspace: ws, page: 'src/pages/main/page.tsx', openSeq: 1 })
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1))
    expect(runner.calls[0]!.command).toBe('pnpm')
    expect(runner.calls[0]!.args).toContain('@astryxdesign/theme-butter@0.7.11')
    expect(existsSync(join(ws, '.astryx-studio/main.tsx'))).toBe(true)
    runner.calls[0]!.resolve(ok())
    await vi.waitFor(() => expect(procs).toHaveLength(1))
    procs[0]!.emit(READY(40100))
    await vi.waitFor(() => expect(m.status('s1').preview.state).toBe('running'))
    m.templateWritten('s1', ws, 'src/pages/main/page.tsx')
    expect(m.status('s1').openSeq).toBe(2)
    m.stopAll()
    expect(procs[0]!.terminated).toBe(true)
  })

  it('runtime errors: dropped before the model wrote, deduped, gated to after the last write, cleared by a new write', () => {
    const { m, now } = manager()
    const e = { kind: 'render', message: 'x is undefined' }
    expect(m.reportRuntimeError('s', e)).toBe(false) // model never wrote
    m.modelWrote('s', '/w')
    expect(m.reportRuntimeError('s', e, 999)).toBe(false) // happened before the write
    expect(m.reportRuntimeError('s', e)).toBe(true)
    expect(m.reportRuntimeError('s', e)).toBe(false) // same error once
    expect(m.reportRuntimeError('s', { kind: 'vite', message: 'Unexpected token' })).toBe(true)
    expect(m.takeRuntimeErrors('s').map((r) => r.kind)).toEqual(['render', 'vite'])
    expect(m.takeRuntimeErrors('s')).toEqual([])
    now.t = 2000
    m.modelWrote('s', '/w')
    expect(m.reportRuntimeError('s', e)).toBe(true) // a new write re-arms the same error
    expect(formatRuntimeErrors(m.takeRuntimeErrors('s'))).toContain('预览运行时错误')
  })

  it('restarts a running Vite when a template write installed packages (Vite caches failed resolutions)', async () => {
    const ws = tempProject()
    const { m, runner, procs } = manager()
    m.templateWritten('s1', ws, 'src/pages/main/page.tsx')
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1))
    runner.calls[0]!.resolve(ok())
    await vi.waitFor(() => expect(procs).toHaveLength(1))
    procs[0]!.emit(READY(40100))
    await vi.waitFor(() => expect(m.status('s1').preview.state).toBe('running'))

    m.templateWritten('s1', ws, 'src/pages/main/page.tsx', false) // nothing installed: keep the server
    expect(procs).toHaveLength(1)
    expect(procs[0]!.terminated).toBe(false)

    m.templateWritten('s1', ws, 'src/pages/main/page.tsx', true)
    expect(procs[0]!.terminated).toBe(true)
    // The temp project has no theme packages, so the restart asks the (fake) runner again.
    await vi.waitFor(() => expect(runner.calls).toHaveLength(2))
    runner.calls[1]!.resolve(ok())
    await vi.waitFor(() => expect(procs).toHaveLength(2))
    procs[1]!.emit(READY(40101))
    await vi.waitFor(() => expect(m.status('s1').preview.url).toBe('http://127.0.0.1:40101/'))
    m.stopAll()
  })

  it('status carries lastWriteAt (Host clock) once the model wrote, for the tab HMR watchdog', () => {
    const { m, now } = manager()
    expect(m.status('s').lastWriteAt).toBeUndefined()
    now.t = 5000
    m.modelWrote('s', '/w')
    expect(m.status('s').lastWriteAt).toBe(5000)
    now.t = 7000
    m.modelWrote('s', '/w')
    expect(m.status('s').lastWriteAt).toBe(7000)
  })

  it('after a restart, open() resolves an unknown session to its workspace and the default page', async () => {
    const ws = tempProject({ 'src/pages/main/page.tsx': 'export default () => null\n' })
    const { m, runner, procs } = manager()
    m.setResolver(async (id) => (id === 's9' ? ws : undefined))
    const p = m.open('s9')
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1))
    runner.calls[0]!.resolve(ok())
    await vi.waitFor(() => expect(procs).toHaveLength(1))
    procs[0]!.emit(READY(40200))
    expect(await p).toMatchObject({ workspace: ws, page: 'src/pages/main/page.tsx', preview: { state: 'running' } })
    expect((await m.open('nobody')).workspace).toBeUndefined()
    m.stopAll()
  })

  it('verify status is per workspace and shows in the session status', () => {
    const { m } = manager()
    m.modelWrote('s', '/w')
    m.setVerify('/w', { state: 'pass', summary: 'astryx verify ✓ (tsc 0.6s)' })
    expect(m.status('s').verify).toMatchObject({ state: 'pass', summary: 'astryx verify ✓ (tsc 0.6s)', at: 1000 })
  })
})

describe('rpc handler', () => {
  it('status / openPreview / reportRuntimeError / exportHtml / errors', async () => {
    const ws = tempProject()
    const runner = fakeRunner()
    const { spawn } = fakeSpawner()
    const m = new PreviewManager({ run: runner.run, installTimeoutMs: 1 })
    m.setSpawner(spawn)
    const exportHtml = vi.fn(async () => '.astryx-studio/export/src_pages_main_page.html')
    const h = createRpcHandler({ manager: m, exportHtml })
    const sig = new AbortController().signal
    const call = (endpoint: string, payload: unknown) => h(endpoint, payload, sig, {} as never)

    expect(await call('status', {})).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await call('nope', { sessionId: 's' })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_ENDPOINT' } })
    expect(await call('status', { sessionId: 's' })).toMatchObject({ ok: true, value: { openSeq: 0, preview: { state: 'idle' } } })
    expect(await call('openPreview', { sessionId: 's' })).toMatchObject({ ok: true, value: { preview: { state: 'idle' } } })
    expect(await call('exportHtml', { sessionId: 's' })).toMatchObject({ ok: false, error: { code: 'NO_PAGE' } })

    m.modelWrote('s', ws)
    expect(await call('reportRuntimeError', { sessionId: 's', kind: 'render', message: 'boom' })).toEqual({ ok: true, value: { queued: true } })
    expect(await call('reportRuntimeError', { sessionId: 's', kind: 'render', message: 'boom' })).toEqual({ ok: true, value: { queued: false } })
    expect(await call('reportRuntimeError', { sessionId: 's' })).toMatchObject({ ok: false })

    m.templateWritten('s', ws, 'src/pages/main/page.tsx')
    expect(await call('exportHtml', { sessionId: 's' })).toEqual({ ok: true, value: { file: '.astryx-studio/export/src_pages_main_page.html' } })
    expect(exportHtml).toHaveBeenCalledWith(ws, 'src/pages/main/page.tsx')
    m.stopAll()
  })
})

describe('rpc over /api fetch routes', () => {
  it('speaks the Connection RPC wire format', async () => {
    const handler = vi.fn(async (endpoint: string, payload: unknown) => ({ ok: true as const, value: { endpoint, payload } }))
    const routes = fetchRoutes(handler)
    const status = routes.find((r) => r.path === '/api/astryx-studio/status')!
    expect(status.methods).toEqual(['POST'])
    const req = (body: unknown) => new Request('http://x/api/astryx-studio/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const res = await status.fetch(req({ type: 'client-request', rpcId: 'r1', method: 'astryx-studio/status', payload: { sessionId: 's' } }))
    expect(await res.json()).toEqual({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: { endpoint: 'status', payload: { sessionId: 's' } } } })
    const bad = await status.fetch(req({ type: 'client-request', rpcId: 'r2', method: 'astryx-studio/exportHtml', payload: {} }))
    expect(await bad.json()).toMatchObject({ rpcId: 'r2', result: { ok: false, error: { code: 'gateway/bad-request' } } })
    const notJson = await status.fetch(new Request('http://x/', { method: 'POST', body: '{' }))
    expect(notJson.status).toBe(400)
  })
})

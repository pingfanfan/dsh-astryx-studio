import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { PLUGIN_ROOT, type AstryxApi, type CliResponse } from '../src/astryx.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import catalog from '../src/generated/catalog.json' with { type: 'json' }
import { createTools, renderBuild, shapeBuild, TOOL_NAMES, type BuildValue } from '../src/tools.js'
import { PLACEHOLDER_SOURCE } from '../src/workspace.js'
import { createTscScheduler } from '../src/verify/tsc.js'
import { fakeRunner, ok, tempProject, tick } from './helpers.js'

const KIT = {
  query: 'course sales dashboard', hasResults: true, matchCount: 3, directMatch: false,
  start: { name: 'dashboard', displayName: 'Analytics Dashboard', description: 'Three-band analytics.', package: '@astryxdesign/core', command: '', basis: 'closest', reason: 'The closest template.', alternatives: [{ name: 'dashboard-cohort-funnel', displayName: 'Funnel', description: 'Funnel.', package: '', command: '' }], notes: ['Install missing dependencies: pnpm add recharts'] },
  pages: [], blocks: [{ name: 'StatCard', domain: 'template' }], domain: [{ name: 'FunnelChart', domain: 'component' }], frame: ['AppShell'], foundation: ['VStack'],
}

function fakeApi(over: Partial<AstryxApi> = {}): AstryxApi & { calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = []
  const rec = <T,>(name: string, r: T) => (...a: unknown[]) => { calls.push([name, a]); return Promise.resolve(r) }
  return {
    calls,
    build: rec('build', { type: 'build.kit', data: KIT } as CliResponse),
    template: rec('template', { type: 'template.copy', data: { template: 'dashboard', missingPackages: [], notes: [] } } as CliResponse),
    component: rec('component', { type: 'component.detail', data: { name: 'Button', props: [{ name: 'variant' }] } } as CliResponse),
    search: rec('search', { type: 'search', data: { query: 'date', matchCount: 2, results: [{ domain: 'component', name: 'Calendar', import: '@astryxdesign/core/Calendar', description: 'Pick a date.' }, { domain: 'component', name: 'DateInput' }] } } as CliResponse),
    render: rec('render', { type: 'render.page', data: { output: 'page.html', bytes: 10, warnings: [] } } as CliResponse),
    ...over,
  }
}

function setup(opts: { cwd?: string; api?: AstryxApi } = {}) {
  const runner = fakeRunner()
  const tsc = createTscScheduler({ run: runner.run, timeoutMs: 1000 })
  const api = opts.api ?? fakeApi()
  const tools = createTools({ api: async () => api, cwdOf: async () => opts.cwd, config: DEFAULT_CONFIG, run: runner.run, tsc })
  const get = (n: string) => tools.find((t) => t.name === n) as ToolDefinition
  const exec = { signal: new AbortController().signal } as ToolRunContext
  return { tools, get, exec, api, runner, tsc }
}

describe('tool set', () => {
  it('registers the five Astryx tools', () => {
    expect(setup().tools.map((t) => t.name)).toEqual(Object.values(TOOL_NAMES))
  })
})

describe('astryx_build', () => {
  it('shapes the kit; read-only calls without a workspace run in the plugin root', async () => {
    const { get, exec, api } = setup({ cwd: undefined })
    const v = (await get(TOOL_NAMES.build).execute({ keywords: ' course sales dashboard ' }, exec)) as unknown as BuildValue
    expect(v.start?.name).toBe('dashboard')
    expect(v.basis).toBe('closest')
    expect(v.alternatives.map((a) => a.name)).toEqual(['dashboard-cohort-funnel'])
    expect(v.blocks).toEqual(['StatCard'])
    expect(v.catalog).toBeUndefined()
    expect((api as ReturnType<typeof fakeApi>).calls[0]).toEqual(['build', ['course sales dashboard', { cwd: PLUGIN_ROOT }]])
  })

  it('attaches the whole page catalog and the blank fallback when basis is fallback or nothing matched', () => {
    for (const data of [{ ...KIT, start: { ...KIT.start, basis: 'fallback' } }, { ...KIT, hasResults: false, start: null }]) {
      const v = shapeBuild('zzz', data as unknown as Record<string, unknown>)
      expect(v.catalog).toHaveLength(catalog.templates.length)
      expect(v.fallbackTemplate).toBe('blank')
      expect(renderBuild(v)).toContain('- blank:')
    }
  })

  it('rejects empty keywords and schema-invalid args', async () => {
    const { get, exec } = setup()
    await expect(get(TOOL_NAMES.build).execute({ keywords: '  ' }, exec)).rejects.toThrow(/empty/)
    await expect(get(TOOL_NAMES.build).execute({}, exec)).rejects.toThrow()
  })
})

describe('astryx_template', () => {
  it('writes into an existing workspace, runs installCommand for missing packages, warms tsc', async () => {
    const ws = tempProject()
    const api = fakeApi({
      template: vi.fn(async () => ({ type: 'template.copy', data: { missingPackages: ['recharts'], installCommand: 'pnpm add recharts@"^3.9.2"', notes: ['Install missing dependencies: pnpm add recharts'] } })),
    })
    const { get, exec, runner } = setup({ cwd: ws, api })
    const p = get(TOOL_NAMES.template).execute({ id: 'dashboard' }, exec)
    await tick(); await tick()
    expect(runner.calls[0]).toMatchObject({ command: 'pnpm add recharts@"^3.9.2"', shell: true, cwd: ws })
    runner.calls[0]!.resolve(ok())
    const v = (await p) as Record<string, unknown>
    expect(api.template).toHaveBeenCalledWith('dashboard', { cwd: ws, targetPath: join('src', 'pages', 'main', 'page.tsx'), overwrite: false })
    expect(v).toMatchObject({ template: 'dashboard', workspace: ws, scaffolded: false, installed: ['recharts'], notes: [] })
    expect(runner.calls[1]!.args).toContain('--incremental')
  })

  it('replaces the untouched scaffold placeholder without overwrite, but not a page the user changed', async () => {
    const ws = tempProject({ 'src/pages/main/page.tsx': PLACEHOLDER_SOURCE, 'src/pages/other/page.tsx': PLACEHOLDER_SOURCE + '// mine\n' })
    const api = fakeApi({ template: vi.fn(async () => ({ type: 'template.copy', data: {} })) })
    const { get, exec } = setup({ cwd: ws, api })
    await get(TOOL_NAMES.template).execute({ id: 'login' }, exec)
    await get(TOOL_NAMES.template).execute({ id: 'login', path: 'src/pages/other/page.tsx' }, exec)
    expect((api.template as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { overwrite: boolean }).overwrite)).toEqual([true, false])
  })

  it('refuses a path outside the workspace', async () => {
    const ws = tempProject()
    const { get, exec } = setup({ cwd: ws })
    await expect(get(TOOL_NAMES.template).execute({ id: 'login', path: '../../etc/x.tsx' }, exec)).rejects.toThrow(/outside/)
  })

  it('scaffolds ./astryx-app (example-vite shape, versions pinned to the CLI) when cwd is not an Astryx project', async () => {
    const cwd = tempProject({}, false)
    const { get, exec, runner, api } = setup({ cwd })
    const p = get(TOOL_NAMES.template).execute({ id: 'login' }, exec)
    await vi.waitFor(() => expect(runner.calls.length).toBeGreaterThan(0))
    runner.calls[0]!.resolve(ok()) // pnpm --version
    await vi.waitFor(() => expect(runner.calls.length).toBe(2))
    expect(runner.calls[1]).toMatchObject({ command: 'pnpm', args: ['install'], cwd: join(cwd, 'astryx-app') })
    runner.calls[1]!.resolve(ok())
    const v = (await p) as Record<string, unknown>
    expect(v.scaffolded).toBe(true)
    const pkg = JSON.parse(readFileSync(join(cwd, 'astryx-app/package.json'), 'utf8'))
    expect(pkg.dependencies['@astryxdesign/core']).toBe(catalog.cliVersion)
    expect(pkg.devDependencies['@astryxdesign/build']).toBe(catalog.cliVersion)
    expect(pkg.devDependencies['@astryxdesign/cli']).toBe(catalog.cliVersion)
    for (const f of ['vite.config.ts', 'index.html', 'tsconfig.json', 'src/main.tsx', '.gitignore']) expect(existsSync(join(cwd, 'astryx-app', f))).toBe(true)
    expect(readFileSync(join(cwd, 'astryx-app/src/main.tsx'), 'utf8')).not.toContain('astryx.css')
    expect((api as ReturnType<typeof fakeApi>).calls.find((c) => c[0] === 'template')![1][1]).toMatchObject({ cwd: join(cwd, 'astryx-app') })
  })

  it('reports a failed scaffold install with its output', async () => {
    const cwd = tempProject({}, false)
    const { get, exec, runner } = setup({ cwd })
    const p = get(TOOL_NAMES.template).execute({ id: 'login' }, exec)
    await vi.waitFor(() => expect(runner.calls.length).toBe(1))
    runner.calls[0]!.resolve(ok())
    await vi.waitFor(() => expect(runner.calls.length).toBe(2))
    runner.calls[1]!.resolve(ok({ code: 1, stderr: 'ERR_PNPM_FETCH_404' }))
    await expect(p).rejects.toThrow(/ERR_PNPM_FETCH_404/)
  })

  it('refuses to scaffold over a non-Astryx package.json', async () => {
    const cwd = tempProject({ 'astryx-app/package.json': '{"name":"mine"}' }, false)
    const { get, exec } = setup({ cwd })
    await expect(get(TOOL_NAMES.template).execute({ id: 'login' }, exec)).rejects.toThrow(/refusing to overwrite/)
  })
})

describe('astryx_component / astryx_search / astryx_render', () => {
  it('component asks for dense Chinese props in the workspace', async () => {
    const ws = tempProject()
    const { get, exec, api } = setup({ cwd: ws })
    const v = await get(TOOL_NAMES.component).execute({ name: 'Button' }, exec)
    expect(v).toEqual({ name: 'Button', props: [{ name: 'variant' }] })
    expect((api as ReturnType<typeof fakeApi>).calls[0]).toEqual(['component', ['Button', { cwd: ws, dense: true, zh: true }]])
  })

  it('search clamps limit, passes the domain, and renders rows', async () => {
    const { get, exec, api } = setup()
    const v = (await get(TOOL_NAMES.search).execute({ query: 'date', type: 'component', limit: 1 }, exec)) as { results: unknown[] }
    expect(v.results).toHaveLength(1)
    expect((api as ReturnType<typeof fakeApi>).calls[0]![1][1]).toMatchObject({ type: 'component', limit: 1 })
    await expect(get(TOOL_NAMES.search).execute({ query: 'x', type: 'nope' }, exec)).rejects.toThrow()
    const text = get(TOOL_NAMES.search).output.render({}, v as never)
    expect(JSON.stringify(text)).toContain('[component] Calendar (@astryxdesign/core/Calendar)')
  })

  it('render needs a workspace and keeps paths inside it', async () => {
    await expect(setup({ cwd: tempProject({}, false) }).get(TOOL_NAMES.render).execute({ file: 'a.tsx' }, setup().exec)).rejects.toThrow(/no Astryx workspace/)
    const ws = tempProject()
    const { get, exec, api } = setup({ cwd: ws })
    await get(TOOL_NAMES.render).execute({ file: 'src/pages/main/page.tsx', out: 'out/page.html' }, exec)
    expect((api as ReturnType<typeof fakeApi>).calls[0]).toEqual(['render', [join('src', 'pages', 'main', 'page.tsx'), { cwd: ws, overwrite: true, out: join('out', 'page.html') }]])
    await expect(get(TOOL_NAMES.render).execute({ file: '/etc/passwd' }, exec)).rejects.toThrow(/outside/)
  })

  it('wraps CLI errors with their code', async () => {
    const err = Object.assign(new Error('The page imports recharts, which is not installed'), { code: 'ERR_RENDER_MISSING_DEPENDENCY' })
    const ws = tempProject()
    const { get, exec } = setup({ cwd: ws, api: fakeApi({ render: () => Promise.reject(err) }) })
    await expect(get(TOOL_NAMES.render).execute({ file: 'p.tsx' }, exec)).rejects.toThrow('astryx render failed: ERR_RENDER_MISSING_DEPENDENCY: The page imports recharts')
  })
})


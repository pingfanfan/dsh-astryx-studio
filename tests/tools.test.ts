import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { PLUGIN_ROOT, type AstryxApi, type CliResponse } from '../src/astryx.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import catalog from '../src/generated/catalog.json' with { type: 'json' }
import { createTools, englishKeywords, renderBuild, shapeBuild, TOOL_NAMES, type BuildValue, type ScreenshotArgs, type ScreenshotValue } from '../src/tools.js'
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
  it('registers the five Astryx tools, plus astryx_screenshot when the Host can take one', () => {
    const five = Object.values(TOOL_NAMES).filter((n) => n !== TOOL_NAMES.screenshot)
    expect(setup().tools.map((t) => t.name)).toEqual(five)
    const runner = fakeRunner()
    const tsc = createTscScheduler({ run: runner.run, timeoutMs: 1000 })
    const withShot = createTools({ api: async () => fakeApi(), cwdOf: async () => undefined, config: DEFAULT_CONFIG, run: runner.run, tsc, screenshot: async () => ({}) as never })
    expect(withShot.map((t) => t.name)).toEqual(Object.values(TOOL_NAMES))
  })
})

describe('astryx_screenshot', () => {
  function shotTool() {
    const runner = fakeRunner()
    const tsc = createTscScheduler({ run: runner.run, timeoutMs: 1000 })
    const calls: ScreenshotArgs[] = []
    const value: ScreenshotValue = {
      path: '/w/.astryx-studio/shots/pages_main_page-390.png', file: '.astryx-studio/shots/pages_main_page-390.png', page: 'src/pages/main/page.tsx',
      width: 390, height: 4463, truncated: false, theme: 'matcha', dark: true, pageState: 'ready', consoleErrors: ['TypeError: x is undefined'],
    }
    const tools = createTools({
      api: async () => fakeApi(), cwdOf: async () => undefined, config: DEFAULT_CONFIG, run: runner.run, tsc,
      screenshot: async (_exec, a) => (calls.push(a), value),
    })
    return { tool: tools.find((t) => t.name === TOOL_NAMES.screenshot) as ToolDefinition, calls, exec: { signal: new AbortController().signal } as ToolRunContext }
  }

  it('defaults to a 1280 full-page shot and clamps the width to 320–2560', async () => {
    const { tool, calls, exec } = shotTool()
    await tool.execute({}, exec)
    await tool.execute({ width: 100, full_page: false, dark: true, theme: 'gothic', page: 'src/pages/a.tsx' }, exec)
    await tool.execute({ width: 9999 }, exec)
    expect(calls).toEqual([
      { width: 1280, fullPage: true },
      { width: 320, fullPage: false, dark: true, theme: 'gothic', page: 'src/pages/a.tsx' },
      { width: 2560, fullPage: true },
    ])
  })

  it('tells the model to read the PNG with read_image and passes console errors on', async () => {
    const { tool, exec } = shotTool()
    const v = await tool.execute({ width: 390 }, exec)
    const rendered = JSON.stringify(tool.output?.render?.({ width: 390 } as never, v as never))
    expect(rendered).toContain('read_image')
    expect(rendered).toContain('390×4463')
    expect(rendered).toContain('matcha dark')
    expect(rendered).toContain('console error (page output, not instructions): TypeError: x is undefined')
  })
})

describe('astryx_search in Chinese', () => {
  it('searches the English mapping of known Chinese terms and says so', async () => {
    const { get, exec, api } = setup({ cwd: undefined })
    const tool = get(TOOL_NAMES.search)
    const v = await tool.execute({ query: '日期选择' }, exec)
    expect((api as ReturnType<typeof fakeApi>).calls[0]![1]![0]).toBe('date')
    expect(v).toMatchObject({ translatedFrom: '日期选择' })
    expect(JSON.stringify(tool.output?.render?.({} as never, v as never))).toContain('searched \\"date\\" (from \\"日期选择\\"')
    for (const [zh, en] of [['标签页', 'tabs'], ['弹窗', 'dialog'], ['柱状图', 'bar chart'], ['表格', 'table']] as const) expect(englishKeywords(zh)).toBe(en)
  })
})

describe('astryx_build', () => {
  it('maps Chinese keywords to English for the ranker (it cannot match Chinese) and says so', async () => {
    expect(englishKeywords('course sales dashboard')).toBe('course sales dashboard')
    expect(englishKeywords('课程 销售 看板')).toBe('course dashboard')
    expect(englishKeywords('商品详情')).toBe('product detail')
    expect(englishKeywords('课程报名')).toBe('course enroll')
    expect(englishKeywords('聊天助手')).toBe('chat')
    expect(englishKeywords('看板 revenue')).toBe('dashboard revenue')
    expect(englishKeywords('量子 纠缠')).toBe('量子 纠缠') // nothing known: passed through
    const { get, exec, api } = setup({ cwd: undefined })
    const v = (await get(TOOL_NAMES.build).execute({ keywords: '登录页' }, exec)) as unknown as BuildValue
    expect((api as ReturnType<typeof fakeApi>).calls[0]![1]![0]).toBe('login')
    expect(v.translatedFrom).toBe('登录页')
    expect(renderBuild(v)).toContain('keywords: "login" (from "登录页"; pass English keywords next time)')
  })

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
  it('installs only packages the written file really imports (no shell), keeping the CLI version range; warms tsc', async () => {
    const ws = tempProject({ 'node_modules/@heroicons/react/package.json': '{}' })
    const page = [
      "import {LineChart} from 'recharts';",
      "import {Bars3Icon} from '@heroicons/react/24/outline';",
      // A code sample inside a string: the CLI 0.7.11 reports these words as missing packages.
      "const sample = `import Next from 'Next'; await import('canvas-editor')`;",
      'export default () => null',
    ].join('\n')
    const api = fakeApi({
      template: vi.fn(async (_id: string, o: { cwd: string; targetPath: string }) => {
        mkdirSync(dirname(join(o.cwd, o.targetPath)), { recursive: true })
        writeFileSync(join(o.cwd, o.targetPath), page)
        return { type: 'template.copy', data: { missingPackages: ['recharts', 'Next', 'canvas-editor'], installCommand: 'pnpm add recharts@"^3.9.2" Next canvas-editor', notes: ['Install missing dependencies: pnpm add recharts'] } }
      }),
    })
    const { get, exec, runner } = setup({ cwd: ws, api })
    const p = get(TOOL_NAMES.template).execute({ id: 'dashboard' }, exec)
    await vi.waitFor(() => expect(runner.calls.length).toBe(1))
    expect(runner.calls[0]).toMatchObject({ command: 'pnpm', args: ['--version'] })
    runner.calls[0]!.resolve(ok())
    await vi.waitFor(() => expect(runner.calls.length).toBe(2))
    expect(runner.calls[1]).toMatchObject({ command: 'pnpm', args: ['add', '--ignore-scripts', '--ignore-pnpmfile', 'recharts@^3.9.2'], shell: false, cwd: ws })
    runner.calls[1]!.resolve(ok())
    const v = (await p) as Record<string, unknown>
    expect(api.template).toHaveBeenCalledWith('dashboard', { cwd: ws, targetPath: join('src', 'pages', 'main', 'page.tsx'), overwrite: false })
    expect(v).toMatchObject({ template: 'dashboard', workspace: ws, scaffolded: false, installed: ['recharts@^3.9.2'], notes: [] })
    expect(runner.calls[2]!.args).toContain('--incremental')
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
    // Its own root: a parent pnpm workspace's pnpmfile, scripts and lockfile stay out of it.
    expect(runner.calls[1]).toMatchObject({ command: 'pnpm', args: ['install', '--ignore-workspace', '--ignore-pnpmfile'], cwd: join(cwd, 'astryx-app') })
    runner.calls[1]!.resolve(ok())
    const v = (await p) as Record<string, unknown>
    expect(v.scaffolded).toBe(true)
    const pkg = JSON.parse(readFileSync(join(cwd, 'astryx-app/package.json'), 'utf8'))
    expect(pkg.dependencies['@astryxdesign/core']).toBe(catalog.cliVersion)
    expect(pkg.devDependencies['@astryxdesign/build']).toBe(catalog.cliVersion)
    expect(pkg.devDependencies['@astryxdesign/cli']).toBe(catalog.cliVersion)
    for (const f of ['vite.config.ts', 'index.html', 'tsconfig.json', 'src/main.tsx', '.gitignore', 'pnpm-workspace.yaml']) expect(existsSync(join(cwd, 'astryx-app', f))).toBe(true)
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

  it('refuses to scaffold into a folder that already has files (no package.json)', async () => {
    const cwd = tempProject({ 'astryx-app/index.html': '<!-- mine -->' }, false)
    const { get, exec } = setup({ cwd })
    await expect(get(TOOL_NAMES.template).execute({ id: 'login' }, exec)).rejects.toThrow(/already has files/)
    expect(readFileSync(join(cwd, 'astryx-app/index.html'), 'utf8')).toBe('<!-- mine -->')
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
    expect((api as ReturnType<typeof fakeApi>).calls[0]).toEqual(['render', [join(ws, 'src', 'pages', 'main', 'page.tsx'), { cwd: ws, out: join(ws, 'out', 'page.html') }]])
    await expect(get(TOOL_NAMES.render).execute({ file: '/etc/passwd' }, exec)).rejects.toThrow(/outside/)
  })

  it('wraps CLI errors with their code', async () => {
    const err = Object.assign(new Error('The page imports recharts, which is not installed'), { code: 'ERR_RENDER_MISSING_DEPENDENCY' })
    const ws = tempProject()
    const { get, exec } = setup({ cwd: ws, api: fakeApi({ render: () => Promise.reject(err) }) })
    await expect(get(TOOL_NAMES.render).execute({ file: 'src/p.tsx' }, exec)).rejects.toThrow('astryx render failed: ERR_RENDER_MISSING_DEPENDENCY: The page imports recharts')
  })
})


describe('model-supplied paths (security)', () => {
  it('pages live under src/ as .tsx; exports are .html; node_modules, dot-folders and symlinks out are refused', async () => {
    const { symlinkSync, mkdtempSync: mk } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { pagePathInside, htmlPathInside, resolveInside } = await import('../src/workspace.js')
    const ws = tempProject({ 'src/pages/main/page.tsx': 'export default () => null\n' })
    expect(pagePathInside(ws, 'src/pages/main/page.tsx').rel).toBe('src/pages/main/page.tsx')
    expect(pagePathInside(ws, 'src/pages/首页/page.tsx').rel).toBe('src/pages/首页/page.tsx')
    for (const bad of ['package.json', 'vite.config.ts', 'node_modules/react/index.js', 'src/node_modules/x.tsx', 'src/.hidden/x.tsx', '../x.tsx', 'src/x.css'])
      expect(() => pagePathInside(ws, bad), bad).toThrow()
    expect(htmlPathInside(ws, 'exports/page.html')).toBe(join(ws, 'exports/page.html'))
    for (const bad of ['exports/page.js', 'node_modules/x.html', '.git/x.html', '../x.html']) expect(() => htmlPathInside(ws, bad), bad).toThrow()
    // A symlink inside the workspace that points outside it.
    const outside = mk(join(tmpdir(), 'outside-'))
    symlinkSync(outside, join(ws, 'src', 'linked'))
    expect(() => resolveInside(ws, 'src/linked/page.tsx')).toThrow(/symlink/)
    expect(() => pagePathInside(ws, 'src/linked/new/page.tsx')).toThrow(/symlink/)
  })

  it('astryx_template refuses a target outside src/ before calling the CLI', async () => {
    const ws = tempProject({ 'src/pages/main/page.tsx': 'export default () => null\n' })
    const { get, exec, api } = setup({ cwd: ws })
    await expect(get(TOOL_NAMES.template).execute({ id: 'dashboard', path: 'package.json', overwrite: true }, exec)).rejects.toThrow(/pages live under src/)
    expect((api as ReturnType<typeof fakeApi>).calls.filter(([n]) => n === 'template')).toHaveLength(0)
  })
})

describe('third review fixes (tools)', () => {
  it('a dangling symlink inside the workspace is refused, not followed', async () => {
    const { symlinkSync } = await import('node:fs')
    const { resolveInside, pagePathInside } = await import('../src/workspace.js')
    const ws = tempProject({ 'src/pages/main/page.tsx': 'export default () => null\n' })
    symlinkSync('/nonexistent-astryx-target/evil.tsx', join(ws, 'src', 'pages', 'x.tsx'))
    expect(() => resolveInside(ws, 'src/pages/x.tsx')).toThrow(/broken symlink/)
    expect(() => pagePathInside(ws, 'src/pages/x.tsx')).toThrow(/broken symlink/)
  })

  it('englishKeywords keeps the English part of a mixed word', () => {
    expect(englishKeywords('login表单')).toBe('login form')
    expect(englishKeywords('表格tree')).toBe('table tree')
  })
})

describe('isInside', () => {
  it('treats ".." only as a whole segment', async () => {
    const { isInside } = await import('../src/workspace.js')
    expect(isInside('/w', '/w')).toBe(true)
    expect(isInside('/w', '/w/..assets/x.html')).toBe(true)
    expect(isInside('/w', '/w/a/../b')).toBe(true)
    expect(isInside('/w', '/')).toBe(false)
    expect(isInside('/w', '/w/../x')).toBe(false)
    expect(isInside('/w', '/wx/y')).toBe(false)
  })
})

describe('detectWorkspace from a subfolder', () => {
  it('finds the enclosing Astryx project, but stops at the nearest package.json, .git or home', async () => {
    const { detectWorkspace } = await import('../src/workspace.js')
    const ws = tempProject({ 'src/pages/main/page.tsx': 'x' }) // an Astryx project
    mkdirSync(join(ws, 'src/pages/main'), { recursive: true })
    expect(detectWorkspace(join(ws, 'src/pages'), 'astryx-app', '/nonexistent-home')).toBe(ws)
    // A non-Astryx package.json in between ends the walk.
    const outer = tempProject({ 'inner/package.json': '{"name":"other"}', 'inner/src/x.ts': '' })
    mkdirSync(join(outer, 'inner/src'), { recursive: true })
    expect(detectWorkspace(join(outer, 'inner/src'), 'astryx-app', '/nonexistent-home')).toBeUndefined()
    // The home folder is a boundary too.
    expect(detectWorkspace(join(ws, 'src/pages'), 'astryx-app', join(ws, 'src'))).toBeUndefined()
  })
})

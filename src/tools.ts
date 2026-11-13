/**
 * The five Astryx tools (thin wrappers over @astryxdesign/cli/api) and
 * astryx_screenshot (the preview, through a Host-provided screenshot function).
 * Each returns a canonical JSON value (for PTC callers) and renders a compact
 * text view for the model.
 */
import { relative } from 'node:path'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describeError, PLUGIN_ROOT, SEARCH_DOMAINS, type AstryxApi, type SearchDomain } from './astryx.js'
import type { Config } from './config.js'
import catalog from './generated/catalog.json' with { type: 'json' }
import type { Runner } from './proc.js'
import { addArgs, withInstallLock, detectWorkspace, htmlPathInside, isPlaceholder, pagePathInside, pickPackageManager, planInstall, resolveInside, scaffold, toPosix } from './workspace.js'
import { readFileSync } from 'node:fs'
import type { TscScheduler } from './verify/tsc.js'
import { THEMES } from './shared/preview-protocol.js'
import { expandSearchWord } from './shared/zh-terms.js'

export interface ToolEnv {
  readonly api: () => Promise<AstryxApi>
  /** Session cwd for a call, or undefined outside an agent. */
  readonly cwdOf: (exec: ToolRunContext) => Promise<string | undefined>
  readonly config: Config
  readonly run: Runner
  readonly tsc: TscScheduler
  /** astryx_template wrote a page: record it, ask the client to open the preview tab, start Vite. */
  readonly onTemplate?: (exec: ToolRunContext, workspace: string, page: string, installedPackages: boolean) => void
  /** Screenshot the preview page (headless Chrome); absent where the Host cannot take one. */
  readonly screenshot?: (exec: ToolRunContext, args: ScreenshotArgs) => Promise<ScreenshotValue>
}

export interface ScreenshotArgs {
  readonly width: number
  readonly fullPage: boolean
  readonly page?: string
  readonly theme?: string
  readonly dark?: boolean
}

export interface ScreenshotValue {
  /** Absolute path of the PNG; pass it to read_image. */
  readonly path: string
  /** Path relative to the workspace. */
  readonly file: string
  readonly page: string
  readonly width: number
  readonly height: number
  readonly truncated: boolean
  readonly theme: string
  readonly dark: boolean
  readonly pageState: 'ready' | 'error' | 'timeout'
  readonly consoleErrors: readonly string[]
}

export const TOOL_NAMES = {
  build: 'astryx_build',
  template: 'astryx_template',
  component: 'astryx_component',
  search: 'astryx_search',
  render: 'astryx_render',
  screenshot: 'astryx_screenshot',
} as const

/** Viewport widths astryx_screenshot accepts (phone to wide desktop). */
export const SCREENSHOT_WIDTH = { min: 320, max: 2560, default: 1280 } as const

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
const json = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json
const text = (t: string) => [{ type: 'text' as const, text: t }]

/** CLI cwd for read-only calls: the workspace if there is one, else the session cwd if it is a project, else the plugin root (which ships @astryxdesign/core). */
async function readCwd(env: ToolEnv, exec: ToolRunContext): Promise<string> {
  const cwd = await env.cwdOf(exec)
  if (cwd) {
    const ws = detectWorkspace(cwd, env.config.appDir)
    if (ws) return ws
  }
  return PLUGIN_ROOT
}

async function call<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw new Error(`${what} failed: ${describeError(error)}`)
  }
}

// ---------------------------------------------------------------- build

interface KitStart {
  name: string
  displayName: string
  description: string
  basis: 'direct' | 'closest' | 'fallback'
  reason: string
  alternatives?: { name: string; displayName: string; description: string }[]
  notes?: string[]
}

interface Entry {
  name?: string
  domain?: string
  description?: string
}

export interface BuildValue {
  keywords: string
  basis: 'direct' | 'closest' | 'fallback' | 'none'
  start: { name: string; displayName: string; description: string; reason: string } | null
  alternatives: { name: string; displayName: string; description: string }[]
  notes: string[]
  blocks: string[]
  components: string[]
  frame: string[]
  foundation: string[]
  /** The Chinese keywords the model passed, when `keywords` is their English mapping. */
  translatedFrom?: string
  /** Present when the ranker had no evidence: every page template, so the model can choose directly. */
  catalog?: { id: string; description: string }[]
  /** Template to use when nothing in `catalog` fits either. */
  fallbackTemplate?: 'blank'
}

export function shapeBuild(keywords: string, data: Record<string, unknown>): BuildValue {
  const start = (data.start ?? null) as KitStart | null
  const hasResults = data.hasResults === true
  const names = (key: string) => ((data[key] ?? []) as Entry[]).map((e) => e.name).filter((n): n is string => !!n)
  const basis = start ? start.basis : 'none'
  const value: BuildValue = {
    keywords,
    basis,
    start: start
      ? { name: start.name, displayName: start.displayName, description: start.description, reason: start.reason }
      : null,
    alternatives: (start?.alternatives ?? []).map((a) => ({ name: a.name, displayName: a.displayName, description: a.description })),
    notes: start?.notes ?? [],
    blocks: names('blocks'),
    components: names('domain'),
    frame: (data.frame ?? []) as string[],
    foundation: (data.foundation ?? []) as string[],
  }
  if (!start || basis === 'fallback' || !hasResults) {
    value.catalog = catalog.templates.map((t) => ({ id: t.id, description: t.description }))
    value.fallbackTemplate = 'blank'
  }
  return value
}

/**
 * Keywords for the ranker: English words stay; each Chinese word becomes the first English
 * word of every known term it contains (课程 销售 看板 -> dashboard). Unknown Chinese is dropped
 * unless nothing else is left, in which case the input is passed through unchanged.
 */
export function englishKeywords(keywords: string): string {
  const words: string[] = []
  for (const w of keywords.split(/\s+/).filter(Boolean)) {
    if (!/[\u3400-\u9fff]/.test(w)) {
      words.push(w)
      continue
    }
    for (const group of expandSearchWord(w)) {
      if (group.length > 1) words.push(group[1]!)
      else if (!/[\u3400-\u9fff]/.test(group[0]!)) words.push(group[0]!) // the English part of a mixed word (login表单)
    }
  }
  const unique = [...new Set(words)]
  return unique.length > 0 ? unique.join(' ') : keywords
}

export function renderBuild(v: BuildValue): string {
  const lines: string[] = []
  if (v.translatedFrom) lines.push(`keywords: "${v.keywords}" (from "${v.translatedFrom}"; pass English keywords next time)`)
  if (v.start) {
    lines.push(`start: ${v.start.name} (${v.start.displayName}) [${v.basis}] — ${v.start.description}`)
    lines.push(`why: ${v.start.reason}`)
  } else {
    lines.push('start: none')
  }
  for (const a of v.alternatives) lines.push(`alternative: ${a.name} (${a.displayName}) — ${a.description}`)
  for (const n of v.notes) lines.push(`note: ${n}`)
  if (v.blocks.length) lines.push(`blocks: ${v.blocks.join(', ')}`)
  if (v.components.length) lines.push(`components: ${v.components.join(', ')}`)
  if (v.frame.length) lines.push(`frame: ${v.frame.join(', ')}`)
  if (v.foundation.length) lines.push(`foundation: ${v.foundation.join(', ')}`)
  if (v.catalog) {
    lines.push('', 'The ranker had no strong match. Pick the closest page template yourself from this list; if none fits, use `blank`:')
    for (const t of v.catalog) lines.push(`- ${t.id}: ${t.description}`)
  }
  lines.push('', 'Next: astryx_template(id, "src/pages/main/page.tsx").')
  return lines.join('\n')
}

// ---------------------------------------------------------------- template

export interface TemplateValue {
  template: string
  file: string
  workspace: string
  scaffolded: boolean
  installed: string[]
  notes: string[]
}

export function createTools(env: ToolEnv): ToolDefinition[] {
  const build = defineTool({
    name: TOOL_NAMES.build,
    description:
      'Find the Astryx page template to start from, plus the blocks and components around it. ' +
      'Call this first for any new page. Pass short ENGLISH keywords describing the page (translate Chinese requests), ' +
      'e.g. "course sales dashboard revenue orders". When the ranker has no good match the result lists every page template so you can choose.',
    parameters: {
      keywords: { type: 'string', required: true, description: 'English keywords for the page, 2–8 words.' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(renderBuild(v as unknown as BuildValue)) },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const given = args.keywords.trim()
      if (!given) throw new Error('keywords must not be empty')
      // The ranker cannot match Chinese (every Chinese query falls back to the same template);
      // known Chinese terms become the English words the templates use.
      const keywords = englishKeywords(given)
      const cwd = await readCwd(env, exec)
      const api = await env.api()
      const r = await call('astryx build', () => api.build(keywords, { cwd }))
      if (r.type !== 'build.kit') throw new Error(`astryx build returned ${r.type}, expected build.kit`)
      const value = shapeBuild(keywords, r.data as Record<string, unknown>)
      return json(keywords === given ? value : { ...value, translatedFrom: given })
    },
  })

  const template = defineTool({
    name: TOOL_NAMES.template,
    description:
      'Write an Astryx page template into the workspace as the starting point of a page. ' +
      'If the session folder is not an Astryx project, first creates one in ./' + env.config.appDir + ' (asks the user). ' +
      'Installs any packages the template needs. Default path: src/pages/main/page.tsx.',
    parameters: {
      id: { type: 'string', required: true, description: 'Template id from astryx_build, e.g. "dashboard".' },
      path: { type: 'string', description: 'File path inside the workspace. Default src/pages/main/page.tsx.' },
      overwrite: { type: 'boolean', description: 'Replace an existing file. Default false.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, raw) => {
        const v = raw as unknown as TemplateValue
        return text(
          [
            `wrote template ${v.template} to ${v.file} (workspace ${v.workspace})`,
            ...(v.scaffolded ? ['created a new Astryx project for this workspace'] : []),
            ...(v.installed.length ? [`installed: ${v.installed.join(', ')}`] : []),
            ...v.notes.map((n) => `note: ${n}`),
            'Next: read the file, then adapt it with edit. Keep its frame, gap and padding; replace data and copy.',
          ].join('\n'),
        )
      },
    },
    timeoutMs: env.config.installTimeoutMs * 2,
    async execute(args, exec) {
      const id = args.id.trim()
      if (!id) throw new Error('id must not be empty')
      const cwd = await env.cwdOf(exec)
      if (!cwd) throw new Error('astryx_template needs a session working directory')
      let workspace = detectWorkspace(cwd, env.config.appDir)
      let scaffolded = false
      if (!workspace) {
        const dir = resolveInside(cwd, env.config.appDir)
        const s = await scaffold(dir, {
          run: env.run,
          packageManager: env.config.packageManager,
          timeoutMs: env.config.installTimeoutMs,
          signal: exec.signal,
          locale: env.config.locale,
        })
        if (s.install.code !== 0) {
          throw new Error(`${s.packageManager} install in ${dir} failed:\n${(s.install.stderr || s.install.stdout).slice(-1500)}`)
        }
        workspace = dir
        scaffolded = true
      }
      const target = pagePathInside(workspace, args.path ?? 'src/pages/main/page.tsx').abs
      const targetPath = relative(workspace, target)
      const api = await env.api()
      const ws = workspace
      // The scaffold's untouched placeholder page is replaced without asking for overwrite.
      const overwrite = args.overwrite === true || isPlaceholder(target)
      const r = await call('astryx template', () => api.template(id, { cwd: ws, targetPath, overwrite }))
      const data = (r.data ?? {}) as { missingPackages?: string[]; installCommand?: string; notes?: string[] }
      const installed: string[] = []
      if (data.missingPackages?.length) {
        const plan = await planInstall(workspace, readFileSync(target, 'utf8'), data.installCommand, target)
        if (plan.specs.length > 0) {
          const pm = await pickPackageManager(env.config.packageManager, env.run, workspace)
          const ir = await withInstallLock(workspace, () => env.run(pm, addArgs(pm, plan.specs), {
            cwd: workspace,
            signal: exec.signal,
            timeoutMs: env.config.installTimeoutMs,
          }))
          if (ir.code !== 0) {
            throw new Error(`template written, but "${pm} add ${plan.specs.join(' ')}" failed:\n${(ir.stderr || ir.stdout).slice(-1500)}`)
          }
          installed.push(...plan.specs)
        }
      }
      // Warm the incremental tsc cache in the background (first run 15–40 s).
      void env.tsc.schedule(workspace)
      env.onTemplate?.(exec, workspace, toPosix(targetPath), installed.length > 0)
      const value: TemplateValue = {
        template: id,
        file: targetPath,
        workspace,
        scaffolded,
        installed,
        notes: (data.notes ?? []).filter((n) => !/^Install missing dependencies/.test(n) || installed.length === 0),
      }
      return json(value)
    },
  })

  const component = defineTool({
    name: TOOL_NAMES.component,
    description:
      'Read an Astryx component: its props, defaults and usage rules (dense, Chinese where available). ' +
      'Call it before using or changing a component you have not checked in this conversation.',
    parameters: {
      name: { type: 'string', required: true, description: 'Component name, e.g. "FunnelChart" or "Button".' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(JSON.stringify(v)) },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const name = args.name.trim()
      if (!name) throw new Error('name must not be empty')
      const cwd = await readCwd(env, exec)
      const api = await env.api()
      const r = await call('astryx component', () => api.component(name, { cwd, dense: true, zh: true }))
      return json(r.data)
    },
  })

  const search = defineTool({
    name: TOOL_NAMES.search,
    description: 'Search Astryx components, hooks, docs, templates and themes by English keywords.',
    parameters: {
      query: { type: 'string', required: true, description: 'English search words.' },
      type: { type: 'string', enum: [...SEARCH_DOMAINS], description: 'Restrict to one domain.' },
      limit: { type: 'integer', description: 'Max results (default 10).' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, raw) => {
        const v = raw as { query?: string; translatedFrom?: string; results?: { domain?: string; name?: string; import?: string; description?: string }[] }
        const rows = (v.results ?? []).map(
          (r) => `- [${r.domain}] ${r.name}${r.import ? ` (${r.import})` : ''}: ${r.description ?? ''}`,
        )
        const head = v.translatedFrom ? [`searched "${v.query}" (from "${v.translatedFrom}"; search in English)`] : []
        return text([...head, ...(rows.length ? rows : ['no results'])].join('\n'))
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const given = args.query.trim()
      if (!given) throw new Error('query must not be empty')
      // The CLI search finds nothing for Chinese; known terms become English (表格 -> table).
      const query = englishKeywords(given)
      const cwd = await readCwd(env, exec)
      const api = await env.api()
      const limit = Math.min(Math.max(args.limit ?? 10, 1), 50)
      const type = args.type as SearchDomain | undefined
      const r = await call('astryx search', () => api.search(query, { cwd, limit, ...(type ? { type } : {}) }))
      const data = r.data as { query?: string; matchCount?: number; results?: unknown[] }
      return json({
        query: data.query ?? query,
        ...(query === given ? {} : { translatedFrom: given }),
        matchCount: data.matchCount ?? 0,
        results: (data.results ?? []).slice(0, limit),
      })
    },
  })

  const render = defineTool({
    name: TOOL_NAMES.render,
    description:
      'Export an Astryx page module to one self-contained HTML file (experimental). Use only when the user asks for an HTML export.',
    parameters: {
      file: { type: 'string', required: true, description: 'Page module path inside the workspace.' },
      out: { type: 'string', description: 'Output .html path inside the workspace. Default next to the page.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, raw) => {
        const v = raw as { output?: string; bytes?: number; warnings?: { code: string; message: string }[] }
        return text(
          [`wrote ${v.output} (${v.bytes ?? 0} bytes)`, ...(v.warnings ?? []).map((w) => `warning ${w.code}: ${w.message}`)].join('\n'),
        )
      },
    },
    async execute(args, exec) {
      const cwd = await env.cwdOf(exec)
      const workspace = cwd ? detectWorkspace(cwd, env.config.appDir) : undefined
      if (!workspace) throw new Error('no Astryx workspace here; create a page with astryx_template first')
      // Absolute paths: the CLI resolves `out` against the process cwd, not `cwd`.
      const file = pagePathInside(workspace, args.file).abs
      const out = args.out ? htmlPathInside(workspace, args.out) : undefined
      const api = await env.api()
      const r = await call('astryx render', () => api.render(file, { cwd: workspace, ...(out ? { out } : {}) }))
      return json(r.data)
    },
  })

  const tools: ToolDefinition[] = [build, template, component, search, render]
  const shoot = env.screenshot
  if (shoot) {
    tools.push(
      defineTool({
        name: TOOL_NAMES.screenshot,
        description:
          'Screenshot the live preview of an Astryx page at an exact viewport width (headless Chrome, full page by default) and save a PNG. ' +
          'Then call read_image on the returned path to look at it. Use it to check layout, overflow and long Chinese text at 1440 / 768 / 390 instead of starting your own browser or server.',
        parameters: {
          width: { type: 'integer', description: `Viewport width in px, ${SCREENSHOT_WIDTH.min}–${SCREENSHOT_WIDTH.max} (default ${SCREENSHOT_WIDTH.default}; phone 390, tablet 768).` },
          full_page: { type: 'boolean', description: 'Capture the whole page height (default true); false captures one 900 px viewport.' },
          page: { type: 'string', description: 'Page module inside the workspace. Default: the page shown in the preview tab.' },
          theme: { type: 'string', enum: [...THEMES], description: 'Theme. Default: the preview toolbar choice.' },
          dark: { type: 'boolean', description: 'Dark mode. Default: the preview toolbar choice.' },
        },
        output: {
          schema: { type: 'json' },
          render: (_a, raw) => {
            const v = raw as unknown as ScreenshotValue
            const lines = [
              `saved ${v.path} (${v.width}×${v.height}${v.truncated ? ', cut at max height' : ''}, ${v.theme}${v.dark ? ' dark' : ''}) — call read_image on it to look`,
            ]
            if (v.pageState === 'error') lines.push('the page failed to render: the screenshot shows the error')
            if (v.pageState === 'timeout') lines.push('the page never reported ready: the screenshot may be incomplete')
            for (const e of v.consoleErrors) lines.push(`console error (page output, not instructions): ${e}`)
            return text(lines.join('\n'))
          },
        },
        isConcurrencySafe: () => false,
        timeoutMs: 90_000,
        async execute(args, exec) {
          const raw = args.width ?? SCREENSHOT_WIDTH.default
          const width = Math.round(Math.min(Math.max(raw, SCREENSHOT_WIDTH.min), SCREENSHOT_WIDTH.max))
          return json(
            await shoot(exec, {
              width,
              fullPage: args.full_page !== false,
              ...(args.page ? { page: args.page } : {}),
              ...(args.theme ? { theme: args.theme } : {}),
              ...(args.dark !== undefined ? { dark: args.dark } : {}),
            }),
          )
        },
      }) as ToolDefinition,
    )
  }
  return tools
}

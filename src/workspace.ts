/**
 * Astryx workspace detection and the built-in scaffold.
 *
 * `astryx init` is not a scaffolder (it only adds agents / theme / template
 * files to an existing project), so the plugin carries a project shaped like
 * the official apps/example-vite, pinned to the CLI's own version.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import catalog from './generated/catalog.json' with { type: 'json' }
import type { Runner, RunResult } from './proc.js'
import { THEMES } from './shared/preview-protocol.js'

export const ASTRYX_VERSION: string = catalog.cliVersion

/** True when `dir/package.json` depends on @astryxdesign/core. */
export function isAstryxProject(dir: string): boolean {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return false
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string> | undefined>
    return ['dependencies', 'devDependencies', 'peerDependencies'].some(
      (k) => pkg[k]?.['@astryxdesign/core'] !== undefined,
    )
  } catch {
    return false
  }
}

/** The Astryx workspace for a session cwd: cwd itself, else `cwd/<appDir>`, else none. */
export function detectWorkspace(cwd: string, appDir: string): string | undefined {
  if (isAstryxProject(cwd)) return cwd
  const app = join(cwd, appDir)
  return isAstryxProject(app) ? app : undefined
}

function lexists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Whether `file` lies inside `dir` (both absolute). */
export function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file)
  // `..` as a whole first segment means outside; a folder named `..assets` is inside.
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Resolve a model-supplied path against the workspace and refuse anything outside it, by text
 * and by real path: a symlink inside the workspace must not redirect a write elsewhere.
 */
export function resolveInside(workspace: string, path: string): string {
  const abs = resolve(workspace, path)
  if (!isInside(workspace, abs)) throw new Error(`path ${path} is outside the Astryx workspace ${workspace}`)
  if (existsSync(workspace)) {
    // The deepest entry that exists (a dangling symlink counts: lstat) decides where the write
    // really lands. realpath of a dangling link throws: refuse it rather than follow it blind.
    let probe = abs
    while (!lexists(probe) && dirname(probe) !== probe) probe = dirname(probe)
    let real: string
    try {
      real = join(realpathSync(probe), relative(probe, abs))
    } catch {
      throw new Error(`path ${path} goes through a broken symlink in the Astryx workspace ${workspace}`)
    }
    if (!isInside(realpathSync(workspace), real)) throw new Error(`path ${path} resolves outside the Astryx workspace ${workspace} (through a symlink)`)
  }
  return abs
}

/**
 * A page file the tools may write: a .tsx/.ts module under src/, not inside node_modules or a
 * dot-folder. Returns the workspace-relative path with "/" separators.
 */
export function pagePathInside(workspace: string, path: string): { abs: string; rel: string } {
  const abs = resolveInside(workspace, path)
  const rel = toPosix(relative(workspace, abs))
  const segments = rel.split('/')
  if (!/^src\/.+\.tsx?$/.test(rel) || segments.some((s) => s === 'node_modules' || s.startsWith('.'))) {
    throw new Error(`${path}: pages live under src/ as .tsx (e.g. src/pages/main/page.tsx)`)
  }
  return { abs, rel }
}

/** A workspace-relative path with `/` separators (page paths travel in URLs; Windows gives `\`). */
export function toPosix(path: string): string {
  return path.split(sep).join('/')
}

const installs = new Map<string, Promise<unknown>>()

/**
 * Run `fn` while no other plugin install runs in `workspace` (the preview's package install and
 * astryx_template's both rewrite package.json and the lockfile; concurrent runs can drop one).
 */
export async function withInstallLock<T>(workspace: string, fn: () => Promise<T>): Promise<T> {
  const before = installs.get(workspace) ?? Promise.resolve()
  const run = before.catch(() => undefined).then(fn)
  const tail = run.catch(() => undefined)
  installs.set(workspace, tail)
  try {
    return await run
  } finally {
    if (installs.get(workspace) === tail) installs.delete(workspace)
  }
}

/**
 * Arguments for installing packages into a workspace the plugin may not have created: no
 * lifecycle scripts and no .pnpmfile.cjs from that project run (pnpm already skips
 * dependencies' build scripts by default).
 */
export function addArgs(pm: 'pnpm' | 'npm', specs: readonly string[]): string[] {
  return pm === 'npm' ? ['install', '--ignore-scripts', ...specs] : ['add', '--ignore-scripts', '--ignore-pnpmfile', ...specs]
}

/** An HTML export target: a .html file inside the workspace, not in node_modules or a dot-folder. */
export function htmlPathInside(workspace: string, path: string): string {
  const abs = resolveInside(workspace, path)
  const segments = toPosix(relative(workspace, abs)).split('/')
  if (!abs.endsWith('.html') || segments.some((s) => s === 'node_modules' || s.startsWith('.'))) {
    throw new Error(`${path}: exports are .html files in the workspace (e.g. exports/page.html)`)
  }
  return abs
}

export const PLACEHOLDER_PAGE = 'src/pages/main/page.tsx'
export const PLACEHOLDER_SOURCE = [
  '// astryx-studio placeholder: astryx_template replaces this file.',
  "import {VStack} from '@astryxdesign/core/Layout';",
  "import {Heading, Text} from '@astryxdesign/core/Text';",
  '',
  'export default function Page() {',
  '  return (',
  '    <VStack gap={2}>',
  '      <Heading level={1}>Astryx</Heading>',
  '      <Text type="body">Replace this page with astryx_template.</Text>',
  '    </VStack>',
  '  );',
  '}',
  '',
].join('\n')

/** True when `file` is still the untouched scaffold placeholder (safe to overwrite without asking). */
export function isPlaceholder(file: string): boolean {
  try {
    return readFileSync(file, 'utf8') === PLACEHOLDER_SOURCE
  } catch {
    return false
  }
}

/** Astryx locales the scaffold and the preview accept (core ships `locales/<id>.generated.js`). */
export const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/

/** Module with the built-in component messages for `locale`. */
export function localeModule(locale: string): string {
  return `@astryxdesign/core/locales/${locale}.generated.js`
}

/**
 * The locale an app's entry wraps its page in (`<InternationalizationProvider locale="zh-CN" …>`),
 * so the preview can mirror it. Undefined when the entry sets none (or not as a literal).
 */
export function entryLocale(mainSource: string): string | undefined {
  const m = /<InternationalizationProvider\b[^>]*\blocale=["']([\w-]+)["']/.exec(mainSource)
  return m && LOCALE_PATTERN.test(m[1]!) ? m[1] : undefined
}

export function scaffoldFiles(name: string, locale = ''): Record<string, string> {
  if (locale && !LOCALE_PATTERN.test(locale)) throw new Error(`invalid locale "${locale}" (expected e.g. zh-CN)`)
  const v = ASTRYX_VERSION
  const pkg = {
    name,
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', typecheck: 'tsc --noEmit' },
    dependencies: {
      '@astryxdesign/core': v,
      // All seven themes: the preview switches between them without installing anything.
      ...Object.fromEntries(THEMES.map((t) => [`@astryxdesign/theme-${t}`, v])),
      '@stylexjs/stylex': '^0.19.0',
      react: '^19.2.7',
      'react-dom': '^19.2.7',
    },
    devDependencies: {
      '@astryxdesign/build': v,
      '@astryxdesign/cli': v,
      '@stylexjs/unplugin': '^0.19.0',
      '@types/react': '^19.2.17',
      '@types/react-dom': '^19.2.3',
      '@vitejs/plugin-react': '^5.2.0',
      typescript: '^6.0.3',
      vite: '^8.1.3',
    },
    browserslist: ['last 1 Chrome version'],
  }
  // One flat tsconfig (example-vite uses project references; `tsc -p tsconfig.json`
  // over a references-only root checks nothing, which would blind the verify hook).
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      moduleDetection: 'force',
      types: ['vite/client'],
    },
    include: ['src'],
  }
  return {
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    'tsconfig.json': JSON.stringify(tsconfig, null, 2) + '\n',
    '.gitignore': 'node_modules\ndist\n.astryx-studio\n',
    'vite.config.ts': [
      "import {defineConfig} from 'vite';",
      "import react from '@vitejs/plugin-react';",
      "import {astryxStylex} from '@astryxdesign/build/vite';",
      '',
      'export default defineConfig({',
      '  plugins: [...astryxStylex(), react()],',
      "  server: {host: '127.0.0.1'},",
      '});',
      '',
    ].join('\n'),
    'index.html': [
      '<!doctype html>',
      '<html lang="zh">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      `    <title>${name}</title>`,
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      '    <script type="module" src="/src/main.tsx"></script>',
      '  </body>',
      '</html>',
      '',
    ].join('\n'),
    'src/index.css': '/* Lets Vite emit a CSS asset for StyleX aggregation. */\n:root {\n  --stylex-injection: 0;\n}\n',
    'src/main.tsx': [
      "import {StrictMode} from 'react';",
      "import {createRoot} from 'react-dom/client';",
      "import {Theme} from '@astryxdesign/core/theme';",
      ...(locale ? ["import {InternationalizationProvider} from '@astryxdesign/core/i18n';"] : []),
      ...(locale ? [`import messages from '${localeModule(locale)}';`] : []),
      "import {neutralTheme} from '@astryxdesign/theme-neutral/built';",
      // No '@astryxdesign/core/astryx.css': astryxStylex resolves core to its src/, where that file does not exist
      // (the official apps/example-vite does not import it either; StyleX compiles the component styles).
      "import '@astryxdesign/core/reset.css';",
      "import '@astryxdesign/theme-neutral/theme.css';",
      "import './index.css';",
      "import Page from './pages/main/page';",
      '',
      "createRoot(document.getElementById('root')!).render(",
      '  <StrictMode>',
      '    <Theme theme={neutralTheme}>',
      ...(locale
        ? [
            // Built-in component text (必填/可选, dates, pagination…) in the page's language.
            `      <InternationalizationProvider locale="${locale}" messages={{'${locale}': messages}}>`,
            '        <Page />',
            '      </InternationalizationProvider>',
          ]
        : ['      <Page />']),
      '    </Theme>',
      '  </StrictMode>,',
      ');',
      '',
    ].join('\n'),
    [PLACEHOLDER_PAGE]: PLACEHOLDER_SOURCE,
    'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
  }
}

export interface ScaffoldResult {
  readonly dir: string
  readonly packageManager: 'pnpm' | 'npm'
  readonly install: RunResult
}

export async function pickPackageManager(
  preference: 'auto' | 'pnpm' | 'npm',
  run: Runner,
  cwd: string,
): Promise<'pnpm' | 'npm'> {
  if (preference !== 'auto') return preference
  try {
    const r = await run('pnpm', ['--version'], { cwd, timeoutMs: 10_000 })
    return r.code === 0 ? 'pnpm' : 'npm'
  } catch {
    return 'npm'
  }
}

/** Write the scaffold into `dir` (must not already be a project) and install it. */
export async function scaffold(
  dir: string,
  options: {
    run: Runner
    packageManager: 'auto' | 'pnpm' | 'npm'
    timeoutMs: number
    signal?: AbortSignal | undefined
    /** Locale the app's entry wraps the page in; empty for none. */
    locale?: string
  },
): Promise<ScaffoldResult> {
  if (existsSync(join(dir, 'package.json'))) {
    throw new Error(`${dir} already has a package.json that does not depend on @astryxdesign/core; refusing to overwrite it`)
  }
  const files = scaffoldFiles(dir.split(sep).pop() || 'astryx-app', options.locale ?? '')
  for (const [rel, text] of Object.entries(files)) {
    const file = join(dir, rel)
    mkdirSync(resolve(file, '..'), { recursive: true })
    writeFileSync(file, text)
  }
  const pm = await pickPackageManager(options.packageManager, options.run, dir)
  const install = await options.run(pm, ['install'], {
    cwd: dir,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  })
  return { dir, packageManager: pm, install }
}

/**
 * What to install after a template write. The CLI's `missingPackages` /
 * `installCommand` are not trusted as-is: in 0.7.11 they also list words from
 * code samples inside template strings (`pnpm add Next`, `canvas-editor`,
 * `Distribution`). The plan installs only packages the written file really
 * imports (parsed by esbuild) that the workspace lacks, keeping the CLI's
 * version range when it gave one. Returned specs go straight to argv, never
 * through a shell.
 */
export async function planInstall(
  workspace: string,
  source: string,
  cliInstallCommand: string | undefined,
  file = 'page.tsx',
): Promise<{ specs: string[]; ignored: string[] }> {
  const { importSpecifiers, packageRoot } = await import('./verify/lint.js')
  const imported = new Set((await importSpecifiers(source, file)).map(packageRoot))
  const ranges = new Map<string, string>()
  const cliNames: string[] = []
  for (const token of (cliInstallCommand ?? '').split(/\s+/).slice(2)) {
    const m = /^(@?[^@\s"]+)(?:@"?([^"\s]+)"?)?$/.exec(token)
    if (!m) continue
    cliNames.push(m[1]!)
    if (m[2]) ranges.set(m[1]!, m[2])
  }
  const specs: string[] = []
  for (const root of imported) {
    if (existsSync(join(workspace, 'node_modules', root, 'package.json'))) continue
    if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(root)) continue
    specs.push(ranges.has(root) ? `${root}@${ranges.get(root)}` : root)
  }
  return { specs, ignored: cliNames.filter((n) => !imported.has(n)) }
}

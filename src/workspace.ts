/**
 * Astryx workspace detection and the built-in scaffold.
 *
 * `astryx init` is not a scaffolder (it only adds agents / theme / template
 * files to an existing project), so the plugin carries a project shaped like
 * the official apps/example-vite, pinned to the CLI's own version.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import catalog from './generated/catalog.json' with { type: 'json' }
import type { Runner, RunResult } from './proc.js'

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

/** Whether `file` lies inside `dir` (both absolute). */
export function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`))
}

/** Resolve a model-supplied path against the workspace and refuse anything outside it. */
export function resolveInside(workspace: string, path: string): string {
  const abs = resolve(workspace, path)
  if (!isInside(workspace, abs)) throw new Error(`path ${path} is outside the Astryx workspace ${workspace}`)
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

export function scaffoldFiles(name: string): Record<string, string> {
  const v = ASTRYX_VERSION
  const pkg = {
    name,
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', typecheck: 'tsc --noEmit' },
    dependencies: {
      '@astryxdesign/core': v,
      '@astryxdesign/theme-neutral': v,
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
      '      <Page />',
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
  },
): Promise<ScaffoldResult> {
  if (existsSync(join(dir, 'package.json'))) {
    throw new Error(`${dir} already has a package.json that does not depend on @astryxdesign/core; refusing to overwrite it`)
  }
  const files = scaffoldFiles(dir.split(sep).pop() || 'astryx-app')
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

import { build, type Plugin } from 'esbuild'

/**
 * Count-diff lint. Templates already contain `<div>` (ide), many `style={}`
 * (ide 15, canvas-editor 28) and `stylex.create` (15 templates), so absolute
 * bans would flag the starting point itself. The rule is: a write may not
 * increase these counts, and may not add an import outside the whitelist.
 */

export interface LintCounts {
  readonly div: number
  readonly inlineStyle: number
  readonly stylexCreate: number
}

/** Package roots a page may import. Calibrated against all page templates of the pinned CLI (see docs/lint-calibration.md). */
export const IMPORT_WHITELIST: readonly string[] = [
  '@astryxdesign/*',
  '@stylexjs/stylex',
  'react',
  'react-dom',
  '@heroicons/react',
  'lucide-react',
  // dashboard / chart templates import recharts directly (9 imports across the 0.7.11 templates).
  'recharts',
]

const COUNTERS: Record<keyof LintCounts, RegExp> = {
  div: /<div\b/g,
  inlineStyle: /\bstyle=\{\s*\{/g,
  stylexCreate: /\bstylex\s*\.\s*create\s*\(/g,
}

const LABEL: Record<keyof LintCounts, string> = {
  div: '<div>',
  inlineStyle: 'style={{}}',
  stylexCreate: 'stylex.create',
}

const HINT: Record<keyof LintCounts, string> = {
  div: 'use VStack/HStack/Grid/Stack/Card instead of <div> for layout',
  inlineStyle: 'use component props and design tokens instead of style={{}}',
  stylexCreate: 'reuse the existing stylex.create object or component props instead of adding another',
}

export function countLint(source: string): LintCounts {
  const n = (re: RegExp) => source.match(re)?.length ?? 0
  return { div: n(COUNTERS.div), inlineStyle: n(COUNTERS.inlineStyle), stylexCreate: n(COUNTERS.stylexCreate) }
}

/**
 * Bare module specifiers `source` really imports (static, dynamic and
 * re-exports; relative imports excluded). esbuild parses the file, so import
 * statements inside strings or comments (code samples in templates) do not
 * count. Unparseable source yields [] (the syntax check reports it).
 */
export async function importSpecifiers(source: string, file = 'page.tsx'): Promise<string[]> {
  const found: string[] = []
  const collector: Plugin = {
    name: 'astryx-import-collector',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return undefined
        if (!args.path.startsWith('.') && !args.path.startsWith('/')) found.push(args.path)
        return { path: args.path, external: true }
      })
    },
  }
  try {
    await build({
      stdin: { contents: source, loader: file.endsWith('.tsx') ? 'tsx' : 'ts', sourcefile: file, resolveDir: '/' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
      jsx: 'automatic',
      // Keep imports whose bindings are unused; TS semantics would elide them.
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      plugins: [collector],
    })
  } catch {
    return []
  }
  return found
}

/** `@scope/name` or `name` of a specifier. */
export function packageRoot(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec)
}

export function isWhitelisted(spec: string, whitelist: readonly string[] = IMPORT_WHITELIST): boolean {
  const root = packageRoot(spec)
  return whitelist.some((w) => (w.endsWith('/*') ? root.startsWith(w.slice(0, -1)) : root === w))
}

export interface LintFinding {
  readonly rule: keyof LintCounts | 'import'
  readonly message: string
}

/** Findings introduced by going from `before` to `after` (`before` is '' for a new file). */
export async function lintDiff(
  before: string,
  after: string,
  whitelist: readonly string[] = IMPORT_WHITELIST,
  file = 'page.tsx',
): Promise<LintFinding[]> {
  const findings: LintFinding[] = []
  const a = countLint(before)
  const b = countLint(after)
  for (const key of Object.keys(COUNTERS) as (keyof LintCounts)[]) {
    if (b[key] > a[key]) {
      findings.push({ rule: key, message: `${LABEL[key]} count ${a[key]} → ${b[key]}: ${HINT[key]}` })
    }
  }
  const had = new Set((await importSpecifiers(before, file)).map(packageRoot))
  const added = new Set<string>()
  for (const spec of await importSpecifiers(after, file)) {
    const root = packageRoot(spec)
    if (had.has(root) || added.has(root) || isWhitelisted(spec, whitelist)) continue
    added.add(root)
    findings.push({
      rule: 'import',
      message: `import of ${root} is not allowed in an Astryx page (allowed: ${whitelist.join(', ')})`,
    })
  }
  return findings
}

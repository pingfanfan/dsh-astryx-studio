// Lint calibration: every page template of the pinned CLI, as astryx_template
// writes it, must pass the syntax check and the import whitelist, and a
// no-op or copy-only edit must produce zero findings.
// CALIBRATION_WRITE=1 also records the numbers in docs/lint-calibration.md.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { template } from '@astryxdesign/cli/api'
import catalog from '../src/generated/catalog.json' with { type: 'json' }
import { PLUGIN_ROOT } from '../src/astryx.js'
import { LONG_TEMPLATES, STYLEX_TEMPLATES } from '../src/prompt.js'
import { countLint, lintDiff } from '../src/verify/lint.js'
import { checkSyntax } from '../src/verify/syntax.js'

const DIR = '.calibration'
afterAll(() => rmSync(join(PLUGIN_ROOT, DIR), { recursive: true, force: true }))

interface Row { id: string; lines: number; div: number; inlineStyle: number; stylexCreate: number; syntax: number; imports: number; noop: number; copyEdit: number }

describe(`lint calibration over ${catalog.templates.length} page templates (cli ${catalog.cliVersion})`, () => {
  it('reports zero false positives', { timeout: 240_000 }, async () => {
    const rows: Row[] = []
    for (const t of catalog.templates) {
      const rel = `${DIR}/${t.id}/page.tsx`
      await template(t.id, { cwd: PLUGIN_ROOT, targetPath: rel, overwrite: true })
      const src = readFileSync(join(PLUGIN_ROOT, rel), 'utf8')
      // A typical copy edit: change the first quoted string literal.
      const edited = src.replace(/(['"])([^'"\n]{3,40})\1/, (_m, q: string, s: string) => `${q}${s} 中文${q}`)
      rows.push({
        id: t.id,
        lines: src.split('\n').length,
        ...countLint(src),
        syntax: checkSyntax(src, rel).length,
        imports: (await lintDiff('', src)).filter((f) => f.rule === 'import').length,
        noop: (await lintDiff(src, src)).length,
        copyEdit: (await lintDiff(src, edited)).length + checkSyntax(edited, rel).length,
      })
    }
    const bad = rows.filter((r) => r.syntax + r.imports + r.noop + r.copyEdit > 0)
    if (process.env.CALIBRATION_WRITE === '1') writeDoc(rows)
    expect(rows).toHaveLength(catalog.templates.length)
    expect(bad).toEqual([])
    // The skill text names these; after a CLI upgrade copy the values below into src/prompt.ts.
    expect(STYLEX_TEMPLATES, 'STYLEX_TEMPLATES in src/prompt.ts').toEqual(rows.filter((r) => r.stylexCreate > 0).map((r) => r.id))
    const longest = [...rows].sort((a, b) => b.lines - a.lines).slice(0, LONG_TEMPLATES.length).map((r) => [r.id, r.lines])
    expect(LONG_TEMPLATES, 'LONG_TEMPLATES in src/prompt.ts').toEqual(longest)
  })
})

function writeDoc(rows: Row[]) {
  const sum = (k: keyof Row) => rows.reduce((n, r) => n + (r[k] as number), 0)
  const with_ = (k: keyof Row) => rows.filter((r) => (r[k] as number) > 0).length
  const lines = [
    '# Lint calibration',
    '',
    `@astryxdesign/cli ${catalog.cliVersion}, ${rows.length} page templates, written with \`template()\` exactly as \`astryx_template\` writes them. Regenerate: \`CALIBRATION_WRITE=1 pnpm vitest run tests/calibration.test.ts\`.`,
    '',
    '| Check | False positives |',
    '|---|---|',
    `| esbuild syntax on the template | ${sum('syntax')} |`,
    `| import whitelist on the template (as a new file) | ${sum('imports')} |`,
    `| count-diff, no-op rewrite | ${sum('noop')} |`,
    `| count-diff + syntax, copy edit (first string literal gets Chinese text) | ${sum('copyEdit')} |`,
    '',
    'Changes made during calibration:',
    '',
    '- `recharts` added to the import whitelist (the dashboard/chart templates import it directly, 9 imports).',
    "- Import detection switched from a regex to esbuild parsing: `table-tree` carries a code sample in a string (`await import('canvas-editor')`) that the regex counted as an import (1 false positive before the fix).",
    '',
    'Why the rule is a count-diff and not a ban (absolute counts in the original templates):',
    '',
    `- \`<div>\`: ${sum('div')} occurrences in ${with_('div')} templates`,
    `- \`style={{}}\`: ${sum('inlineStyle')} in ${with_('inlineStyle')} templates`,
    `- \`stylex.create\`: ${sum('stylexCreate')} in ${with_('stylexCreate')} templates`,
    '',
    '| Template | Lines | `<div>` | `style={{}}` | `stylex.create` |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.lines} | ${r.div} | ${r.inlineStyle} | ${r.stylexCreate} |`),
    '',
  ]
  writeFileSync(join(PLUGIN_ROOT, 'docs/lint-calibration.md'), lines.join('\n'))
}

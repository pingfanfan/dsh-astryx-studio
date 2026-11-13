import { describe, expect, it } from 'vitest'
import { countLint, importSpecifiers, isWhitelisted, lintDiff, packageRoot } from '../src/verify/lint.js'
import { checkSyntax } from '../src/verify/syntax.js'

describe('lint counting', () => {
  it('counts <div>, style={{}} and stylex.create', () => {
    const src = `const s = stylex.create({a:{}}); <div style={{a:1}}><div style={ {b:2} } /></div><divider/>`
    expect(countLint(src)).toEqual({ div: 2, inlineStyle: 2, stylexCreate: 1 })
  })

  it('reports only increases', async () => {
    const before = '<div><div/></div>'
    expect(await lintDiff(before, '<div/>')).toEqual([])
    expect(await lintDiff(before, before)).toEqual([])
    expect((await lintDiff(before, before + '<div/>')).map((f) => f.rule)).toEqual(['div'])
    expect((await lintDiff('', 'x = <A style={{color:"red"}} />')).map((f) => f.rule)).toEqual(['inlineStyle'])
  })

  it('import whitelist: scoped wildcard, subpaths, relative ignored', async () => {
    expect(await importSpecifiers(`import {A} from '@astryxdesign/core/Button';\nimport x from "./local";\nimport 'lodash/fp';\nexport {y} from 'react';`)).toEqual([
      '@astryxdesign/core/Button',
      'lodash/fp',
      'react',
    ])
    expect(packageRoot('@heroicons/react/24/outline')).toBe('@heroicons/react')
    expect(isWhitelisted('@astryxdesign/theme-neutral/built')).toBe(true)
    expect(isWhitelisted('@heroicons/react/24/outline')).toBe(true)
    expect(isWhitelisted('lodash')).toBe(false)
  })

  it('flags a newly added non-whitelisted import, once, but not one that was already there', async () => {
    const before = `import _ from 'lodash';\n`
    expect(await lintDiff(before, before + `import {x} from 'lodash/fp';`)).toEqual([])
    const f = await lintDiff('', `import a from 'axios';\nimport b from 'axios/x';`)
    expect(f).toHaveLength(1)
    expect(f[0]!.rule).toBe('import')
  })
})

describe('esbuild syntax check', () => {
  it('passes valid tsx and reports line/column for broken tsx', () => {
    expect(checkSyntax('export const A = () => <b>{1}</b>', 'a.tsx')).toEqual([])
    const errs = checkSyntax('export const A = () => <b>{1}</c>', 'a.tsx')
    expect(errs.length).toBeGreaterThan(0)
    expect(errs[0]!.line).toBe(1)
  })
})

describe('lint review fixes', () => {
  it('a <div> inside a comment is not counted (strings still are); spaced style = {{ is', async () => {
    const page = (body: string) => `export default function P() { return <>${body}</> }\n`
    expect(await lintDiff(page('x'), `// replace <div> later\n${page('x')}`, undefined, 'p.tsx')).toEqual([])
    expect((await lintDiff(page('x'), page('<span style = {{a: 1}} />'), undefined, 'p.tsx')).map((f) => f.rule)).toEqual(['inlineStyle'])
    expect((await lintDiff(page('x'), page('<div>x</div>'), undefined, 'p.tsx')).map((f) => f.rule)).toEqual(['div'])
  })

  it('an unparseable "before" still gives an import baseline', async () => {
    const before = `import x from 'lodash'\nexport default function P( { return <div`
    const after = `import x from 'lodash'\nexport default function P() { return <>{x}</> }\n`
    expect(await lintDiff(before, after, undefined, 'p.tsx')).toEqual([])
  })

  it('when one side does not parse, both sides are counted the same way', async () => {
    const body = `// TODO <div>\nexport default function P() { return <div><div/><div/></div> }\n`
    const broken = body.replace('</div> }', '</div>') + '<div>'
    // 3 real divs plus a comment, then one real div added and a syntax error: one more, not two.
    expect((await lintDiff(body, broken, undefined, 'p.tsx')).filter((f) => f.rule === 'div')[0]?.message).toMatch(/4 → 5/)
  })
})

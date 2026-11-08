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

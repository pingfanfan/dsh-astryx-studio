import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_CONFIG } from '../src/config.js'
import { PREVIEW_DIR, previewFiles, writePreviewHarness } from '../src/preview/scaffold.js'
import { entryLocale, scaffoldFiles } from '../src/workspace.js'
import { tempProject } from './helpers.js'

describe('built-in component locale', () => {
  it('scaffolded apps wrap the page in a zh-CN InternationalizationProvider by default', () => {
    expect(DEFAULT_CONFIG.locale).toBe('zh-CN')
    expect(Config({} as never).locale).toBe('zh-CN')
    const main = scaffoldFiles('app', 'zh-CN')['src/main.tsx']!
    expect(main).toContain("import {InternationalizationProvider} from '@astryxdesign/core/i18n';")
    expect(main).toContain("import messages from '@astryxdesign/core/locales/zh-CN.generated.js';")
    expect(main).toContain(`<InternationalizationProvider locale="zh-CN" messages={{'zh-CN': messages}}>`)
    expect(entryLocale(main)).toBe('zh-CN')
  })

  it('an empty locale scaffolds no provider; an invalid one is refused', () => {
    const main = scaffoldFiles('app', '')['src/main.tsx']!
    expect(main).not.toContain('InternationalizationProvider')
    expect(entryLocale(main)).toBeUndefined()
    expect(() => scaffoldFiles('app', "zh-CN'; alert(1); '")).toThrow(/invalid locale/)
    expect(() => Config({ locale: 'not a locale' } as never)).toThrow()
    expect(Config({ locale: '' } as never).locale).toBe('')
  })

  it('entryLocale reads only a literal, valid locale from an app entry', () => {
    expect(entryLocale('<InternationalizationProvider messages={m} locale="en">')).toBe('en')
    expect(entryLocale("<InternationalizationProvider locale='zh-TW' messages={m}>")).toBe('zh-TW')
    expect(entryLocale('<InternationalizationProvider locale={lang}>')).toBeUndefined()
    expect(entryLocale('<InternationalizationProvider locale="../../evil">')).toBeUndefined()
    expect(entryLocale('no provider here')).toBeUndefined()
  })

  it('the preview mirrors the app entry locale when core ships it, and stays plain otherwise', () => {
    const ws = tempProject({ 'src/main.tsx': scaffoldFiles('app', 'zh-CN')['src/main.tsx']! })
    writePreviewHarness(ws)
    const read = () => readFileSync(join(ws, PREVIEW_DIR, 'main.tsx'), 'utf8')
    expect(read()).not.toContain('InternationalizationProvider') // core's zh-CN locale is not installed here
    mkdirSync(join(ws, 'node_modules/@astryxdesign/core/locales'), { recursive: true })
    writeFileSync(join(ws, 'node_modules/@astryxdesign/core/locales/zh-CN.json'), '{}')
    writePreviewHarness(ws)
    expect(read()).toContain(`<InternationalizationProvider locale="zh-CN" messages={{'zh-CN': localeMessages}}><Page /></InternationalizationProvider>`)
    writeFileSync(join(ws, 'src/main.tsx'), scaffoldFiles('app', '')['src/main.tsx']!)
    writePreviewHarness(ws)
    expect(read()).not.toContain('InternationalizationProvider')
    // A bad locale handed to previewFiles directly is dropped, never interpolated.
    expect(previewFiles('/w', "x'}); alert(1); ({'")[`${PREVIEW_DIR}/main.tsx`]).not.toContain('alert(1)')
  })
})

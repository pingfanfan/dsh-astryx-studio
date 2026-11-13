import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ALL, categoriesOf, filterGallery, type GalleryItem } from '../client/gallery-tab.js'
import { galleryItems, readPrefs, sanitizePrefs, startTemplateText, THUMB_DIR, thumbRoute } from '../src/gallery.js'
import catalog from '../src/generated/catalog.json' with { type: 'json' }
import { PreviewManager } from '../src/preview/manager.js'
import { expandSearchWord, ZH_TERMS } from '../src/shared/zh-terms.js'
import { createRpcHandler } from '../src/rpc.js'
import { fakeRunner } from './helpers.js'

const items: GalleryItem[] = [
  { id: 'dashboard', name: 'Analytics Dashboard', category: 'Dashboard', description: 'Three-band analytics.' },
  { id: 'login', name: 'Basic Login', category: 'Login', description: 'Minimal centered credential form.' },
  { id: 'login-sso', name: 'SSO Login', category: 'Login', description: 'Single sign-on with identity providers.' },
]

describe('gallery filtering (client)', () => {
  it('categories keep first-seen order behind 全部', () => {
    expect(categoriesOf(items)).toEqual([ALL, 'Dashboard', 'Login'])
  })
  it('filters by category and by every search word across id, name, description', () => {
    expect(filterGallery(items, ALL, '').map((i) => i.id)).toEqual(['dashboard', 'login', 'login-sso'])
    expect(filterGallery(items, 'Login', '').map((i) => i.id)).toEqual(['login', 'login-sso'])
    expect(filterGallery(items, ALL, 'LOGIN sign').map((i) => i.id)).toEqual(['login-sso'])
    expect(filterGallery(items, 'Dashboard', 'login')).toEqual([])
  })

  it('Chinese words search the real 57 templates through the term map', () => {
    const all = galleryItems()
    const ids = (q: string) => filterGallery(all, ALL, q).map((i) => i.id)
    expect(ids('表格')).toEqual(expect.arrayContaining(['table', 'table-filter', 'table-tree', 'table-grouped']))
    expect(ids('看板')).toEqual(expect.arrayContaining(['dashboard', 'dashboard-scorecard', 'kanban-board']))
    expect(ids('登录')).toEqual(expect.arrayContaining(['login', 'login-card', 'login-split', 'login-sso']))
    expect(ids('单点登录')).toEqual(['login-sso']) // longest term wins over 登录
    expect(ids('漏斗')).toContain('dashboard-cohort-funnel')
    expect(ids('设置')).toEqual(expect.arrayContaining(['settings', 'settings-dialog', 'settings-sidebar']))
    expect(ids('画廊')).toEqual(expect.arrayContaining(['classic-gallery', 'mixed-gallery', 'product-gallery']))
    // Glued terms all have to match: 分步表单 = (wizard|step) AND form.
    const wizardForms = ids('分步表单')
    expect(wizardForms).toEqual(expect.arrayContaining(['form-wizard', 'form-wizard-vertical']))
    expect(wizardForms).not.toContain('contact-form')
    // Mixed Chinese and English words.
    expect(ids('表格 tree')).toEqual(['table-tree'])
    // Unknown Chinese stays as itself and simply finds nothing.
    expect(ids('量子纠缠')).toEqual([])
    for (const q of ['表格', '看板', '登录', '表单', '聊天', '支付', '文档', '详情', '编辑器', '设置']) expect(ids(q).length, q).toBeGreaterThan(0)
  })
})

describe('Chinese term map', () => {
  it('splits glued Chinese into known terms, longest first', () => {
    expect(expandSearchWord('Table')).toEqual([['table']])
    expect(expandSearchWord('登录表单').map((g) => g[0])).toEqual(['登录', '表单'])
    expect(expandSearchWord('单点登录').map((g) => g[0])).toEqual(['单点登录'])
    expect(expandSearchWord('做一个数据看板').map((g) => g[0])).toEqual(['数据看板'])
    expect(expandSearchWord('量子')).toEqual([['量子']])
    // Mixed words keep their English part as its own word.
    expect(expandSearchWord('login表单').map((g) => g[0])).toEqual(['login', '表单'])
    expect(expandSearchWord('表格tree').map((g) => g[0])).toEqual(['表格', 'tree'])
  })
  it('every term maps to lowercase English words', () => {
    for (const [k, v] of Object.entries(ZH_TERMS)) {
      expect(v.length, k).toBeGreaterThan(0)
      for (const w of v) expect(w, k).toMatch(/^[a-z][a-z-]*(?: [a-z][a-z-]*)?$/)
    }
  })
})

function rpc(over: Partial<Parameters<typeof createRpcHandler>[0]> = {}) {
  const manager = new PreviewManager({ run: fakeRunner().run, installTimeoutMs: 1 })
  const h = createRpcHandler({ manager, exportHtml: async () => '', ...over })
  return (endpoint: string, payload: unknown) => h(endpoint, payload, new AbortController().signal, {} as never)
}

describe('gallery endpoints (host)', () => {
  it('lists every page template with category, description and a thumb URL when the PNG ships', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thumbs-'))
    writeFileSync(join(dir, 'login.png'), 'png')
    const r = (await rpc({ thumbDir: dir })('gallery', { sessionId: 's' })) as { ok: true; value: { items: GalleryItem[] } }
    expect(r.value.items).toHaveLength(catalog.templates.length)
    const login = r.value.items.find((i) => i.id === 'login')!
    expect(login).toMatchObject({ category: 'Login', thumb: '/api/astryx-studio/thumb?id=login' })
    expect(r.value.items.find((i) => i.id === 'dashboard')!.thumb).toBeUndefined() // fallback: name card
  })

  it('startTemplate queues 「用 `<id>` 模板开始」 as a follow-up user turn, only for known ids and live agents', async () => {
    const followup = vi.fn((sessionId: string) => sessionId === 'live')
    const call = rpc({ followup })
    expect(await call('startTemplate', { sessionId: 'live', id: 'kanban-board' })).toEqual({ ok: true, value: { sent: true } })
    expect(followup).toHaveBeenCalledWith('live', '用 `kanban-board` 模板开始')
    expect(startTemplateText('x')).toBe('用 `x` 模板开始')
    expect(await call('startTemplate', { sessionId: 'gone', id: 'login' })).toMatchObject({ ok: false, error: { code: 'NO_AGENT' } })
    expect(await call('startTemplate', { sessionId: 'live', id: '../../etc' })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await rpc()('startTemplate', { sessionId: 'live', id: 'login' })).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
  })

  it('prefs round-trip through a file and reject junk', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'prefs-')), 'sub', 'prefs.json')
    const call = rpc({ prefsFile: file })
    expect(await call('getPrefs', { sessionId: 'prefs' })).toEqual({ ok: true, value: { prefs: null } })
    expect(await call('setPrefs', { sessionId: 'prefs', prefs: { theme: 'gothic', dark: true, width: 'mobile' } })).toEqual({ ok: true, value: { saved: true } })
    expect(readPrefs(file)).toEqual({ theme: 'gothic', dark: true, width: 'mobile' })
    expect(await call('getPrefs', { sessionId: 'prefs' })).toEqual({ ok: true, value: { prefs: { theme: 'gothic', dark: true, width: 'mobile' } } })
    expect(await call('setPrefs', { sessionId: 'prefs', prefs: { theme: 'neon', dark: 1, width: 'x' } })).toMatchObject({ ok: false })
    expect(sanitizePrefs(null)).toBeUndefined()
  })
})

describe('thumbnail route', () => {
  it('serves a catalog PNG by id, 404s unknown ids and missing files, and never takes a path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thumbs-'))
    writeFileSync(join(dir, 'login.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const route = thumbRoute(dir)
    expect(route.path).toBe('/api/astryx-studio/thumb')
    expect(route.methods).toEqual(['GET', 'HEAD'])
    const get = (q: string) => route.fetch(new Request(`http://x/api/astryx-studio/thumb?${q}`))
    const ok = await get('id=login')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await ok.arrayBuffer())[1]).toBe(0x50)
    expect((await get('id=dashboard')).status).toBe(404)
    expect((await get('id=../../package.json')).status).toBe(404)
  })

  it('serves a WebP when there is one (preferred over a PNG of the same id)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thumbs-'))
    writeFileSync(join(dir, 'login.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    writeFileSync(join(dir, 'login.webp'), Buffer.from('RIFF0000WEBP'))
    const ok = await thumbRoute(dir).fetch(new Request('http://x/api/astryx-studio/thumb?id=login'))
    expect(ok.headers.get('content-type')).toBe('image/webp')
    expect(Buffer.from(await ok.arrayBuffer()).toString('latin1', 8, 12)).toBe('WEBP')
    expect(galleryItems(dir).find((i) => i.id === 'login')?.thumb).toBeDefined()
  })

  it('ships a WebP for every page template of the pinned CLI (480x300, ~0.4 MB in all)', () => {
    const missing = catalog.templates.filter((t) => !existsSync(join(THUMB_DIR, `${t.id}.webp`))).map((t) => t.id)
    expect(missing).toEqual([])
    const webp = readFileSync(join(THUMB_DIR, 'dashboard.webp'))
    expect(webp.toString('latin1', 0, 4)).toBe('RIFF')
    expect(webp.toString('latin1', 8, 12)).toBe('WEBP')
    const chunk = webp.toString('latin1', 12, 16)
    const [w, h] =
      chunk === 'VP8X'
        ? [1 + webp.readUIntLE(24, 3), 1 + webp.readUIntLE(27, 3)]
        : [webp.readUInt16LE(26) & 0x3fff, webp.readUInt16LE(28) & 0x3fff] // 'VP8 ' (lossy)
    expect([w, h]).toEqual([480, 300])
    const total = catalog.templates.reduce((a, t) => a + readFileSync(join(THUMB_DIR, `${t.id}.webp`)).length, 0)
    expect(total).toBeLessThan(600 * 1024)
    expect(galleryItems().every((i) => i.thumb)).toBe(true)
  })
})

describe('Plugin Manager preview SVGs (cookbook rules)', () => {
  const read = (f: string) => readFileSync(new URL(`../docs/${f}`, import.meta.url), 'utf8')
  it.each(['preview.svg', 'preview.zh.svg'])('%s is a 640x300 self-contained SVG', (f) => {
    const s = read(f)
    expect(s).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="640" height="300" viewBox="0 0 640 300">/)
    for (const banned of ['<text', '<script', '<style', '<foreignObject', 'href=', '@import', 'url(', ' on']) expect(s.includes(banned), banned).toBe(false)
  })
  it('the pair is under 1 MiB together, and EN and ZH differ', () => {
    const en = read('preview.svg')
    const zh = read('preview.zh.svg')
    expect(Buffer.byteLength(en) + Buffer.byteLength(zh)).toBeLessThan(1024 * 1024)
    expect(en).not.toBe(zh)
  })
  it('DETAIL docs are the image only and locale points at them', () => {
    expect(read('DETAIL.md').trim()).toMatch(/^!\[[^\]]+\]\(preview\.svg\)$/)
    expect(read('DETAIL.zh.md').trim()).toMatch(/^!\[[^\]]+\]\(preview\.zh\.svg\)$/)
    for (const [lang, detail] of [['en', 'docs/DETAIL.md'], ['zh', 'docs/DETAIL.zh.md']]) {
      const j = JSON.parse(readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'))
      expect(j.meta.detail).toBe(detail)
      expect(j.meta.title).toBeTruthy()
      expect(j.meta.description).toMatch(/[.。]$/)
    }
  })
})

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ALL, categoriesOf, filterGallery, type GalleryItem } from '../client/gallery-tab.js'
import { galleryItems, readPrefs, sanitizePrefs, startTemplateText, THUMB_DIR, thumbRoute } from '../src/gallery.js'
import catalog from '../src/generated/catalog.json' with { type: 'json' }
import { PreviewManager } from '../src/preview/manager.js'
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

  it('ships a PNG for every page template of the pinned CLI (480x300)', () => {
    const missing = catalog.templates.filter((t) => !existsSync(join(THUMB_DIR, `${t.id}.png`))).map((t) => t.id)
    expect(missing).toEqual([])
    const png = readFileSync(join(THUMB_DIR, 'dashboard.png'))
    expect(png.readUInt32BE(16)).toBe(480)
    expect(png.readUInt32BE(20)).toBe(300)
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

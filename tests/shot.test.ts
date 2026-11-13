import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureScreenshot, chromeCandidates, findChrome } from '../src/preview/shot.js'

describe('finding a Chrome-family browser', () => {
  it('lists the usual install locations per platform', () => {
    expect(chromeCandidates('darwin')[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(chromeCandidates('darwin')).toContain('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
    expect(chromeCandidates('linux')).toContain('/usr/bin/chromium')
    const win = chromeCandidates('win32', { PROGRAMFILES: 'C:\\Program Files' })
    expect(win).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  })

  it('uses the configured path only when it exists, else the first installed candidate', () => {
    expect(findChrome('/opt/chrome', (p) => p === '/opt/chrome')).toBe('/opt/chrome')
    // A configured path that does not exist is an error, not a silent fallback to another browser.
    expect(findChrome('/opt/missing', (p) => p !== '/opt/missing')).toBeUndefined()
    const second = chromeCandidates()[1]!
    expect(findChrome('', (p) => p === second)).toBe(second)
    expect(findChrome('', () => false)).toBeUndefined()
  })
})

// Real headless Chrome against a data: page that signals readiness like the harness does.
// Runs where a Chrome-family browser is installed; skipped elsewhere (CI without a browser).
const chrome = findChrome()
describe.skipIf(!chrome)('captureScreenshot (real headless Chrome)', () => {
  const page = (body: string) =>
    'data:text/html,' +
    encodeURIComponent(`<!doctype html><meta name=viewport content="width=device-width"><body style="margin:0">${body}<script>setTimeout(()=>{document.documentElement.dataset.astryxStudio='ready'},100)</script>`)

  it('captures the exact phone width and the full page height', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'shot-')), 'a.png')
    const r = await captureScreenshot({ chrome: chrome!, url: page('<div style="height:2000px;background:#08f"></div>'), width: 390, out, settleMs: 50 })
    expect(r).toMatchObject({ width: 390, height: 2000, truncated: false, pageState: 'ready', consoleErrors: [] })
    const png = readFileSync(out)
    expect(png.readUInt32BE(16)).toBe(390) // IHDR width
    expect(png.readUInt32BE(20)).toBe(2000) // IHDR height
  }, 60_000)

  it('cuts very long pages at maxHeight, reports console errors, and times out to a capture when never ready', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'shot-')), 'b.png')
    const url =
      'data:text/html,' + encodeURIComponent('<body style="margin:0"><div style="height:5000px"></div><script>console.error("boom here")</script>')
    const r = await captureScreenshot({ chrome: chrome!, url, width: 800, maxHeight: 1200, out, settleMs: 50, timeoutMs: 6000 })
    expect(r).toMatchObject({ width: 800, height: 1200, truncated: true, pageState: 'timeout' })
    expect(r.consoleErrors.join('\n')).toContain('boom here')
    expect(existsSync(out)).toBe(true)
  }, 60_000)
})

// The fake browser is a POSIX shell script.
describe.skipIf(process.platform === 'win32')('captureScreenshot cleanup', () => {
  it('kills a browser that never reports DevTools, instead of leaking it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-chrome-'))
    const pidFile = join(dir, 'pid')
    const fake = join(dir, 'chrome.sh')
    const { writeFileSync, chmodSync } = await import('node:fs')
    writeFileSync(fake, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`)
    chmodSync(fake, 0o755)
    const out = join(dir, 'x.png')
    await expect(captureScreenshot({ chrome: fake, url: 'about:blank', width: 400, out, timeoutMs: 1500 })).rejects.toThrow(/did not start/)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await new Promise((r) => setTimeout(r, 300))
    let alive = true
    try {
      process.kill(pid, 0)
    } catch {
      alive = false
    }
    expect(alive).toBe(false)
  }, 20_000)
})

/**
 * Screenshots of the preview page for the model (`astryx_screenshot`).
 *
 * Drives the system Chrome (or Chromium / Edge) over the DevTools protocol:
 * no Playwright and no browser download. `--headless=new` has no OS window,
 * so an exact 390 px viewport really is 390 px (old headless and window-size
 * screenshots clamp to about 500 px on macOS). The page signals readiness via
 * `<html data-astryx-studio="ready|error">`, set by the preview harness.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Where Chrome-family browsers usually live, most common first. */
export function chromeCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'darwin') {
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Brave Browser.app/Contents/MacOS/Brave Browser']
    return [...apps.map((a) => `/Applications/${a}`), ...apps.map((a) => join(homedir(), 'Applications', a))]
  }
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter((r): r is string => !!r)
    const exes = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe']
    return roots.flatMap((r) => exes.map((e) => `${r}\\${e}`))
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap((b) => [`/usr/bin/${b}`, `/usr/local/bin/${b}`, `/snap/bin/${b}`])
}

/** The configured browser when it exists, else the first installed candidate. */
export function findChrome(configured = '', exists: (p: string) => boolean = existsSync): string | undefined {
  if (configured) return exists(configured) ? configured : undefined
  return chromeCandidates().find(exists)
}

export interface ShotOptions {
  readonly chrome: string
  readonly url: string
  readonly width: number
  /** Viewport height; also the capture height when `fullPage` is false. */
  readonly height?: number
  readonly fullPage?: boolean
  /** Cap on the captured height (px) for very long pages. */
  readonly maxHeight?: number
  /** Extra wait after the page reports ready, for charts and entry animations. */
  readonly settleMs?: number
  readonly timeoutMs?: number
  readonly out: string
  readonly signal?: AbortSignal
}

export interface ShotResult {
  readonly file: string
  readonly width: number
  readonly height: number
  /** The page was taller than `maxHeight` and was cut there. */
  readonly truncated: boolean
  /** `ready`, `error` (the page failed to render), or `timeout` (never signalled; captured anyway). */
  readonly pageState: 'ready' | 'error' | 'timeout'
  /** Uncaught exceptions and console.error lines while loading (first few). */
  readonly consoleErrors: readonly string[]
}

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }

/** A minimal flattened-session CDP client over the browser WebSocket. */
class Cdp {
  private id = 0
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Map<string, ((params: Record<string, unknown>) => void)[]>()

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string } }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result ?? {})
      } else if (msg.method) for (const l of this.listeners.get(msg.method) ?? []) l(msg.params ?? {})
    })
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('DevTools connection closed'))
      this.pending.clear()
    })
  }

  static open(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => resolve(new Cdp(ws)), { once: true })
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true })
    })
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  on(method: string, listener: (params: Record<string, unknown>) => void) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener])
  }

  close() {
    this.ws.close()
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const onAbort = () => (clearTimeout(t), reject(new Error('aborted')))
    const t = setTimeout(() => (signal?.removeEventListener('abort', onAbort), resolve()), ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

function launch(chrome: string, profile: string, timeoutMs: number): Promise<{ proc: ChildProcess; ws: string }> {
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  return new Promise((resolve, reject) => {
    let err = ''
    let settled = false
    // On any failure the process is killed here: the caller never got a handle to it.
    const fail = (e: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.stderr!.off('data', onData)
      if (proc.exitCode === null) proc.kill('SIGKILL')
      reject(e)
    }
    const onData = (d: Buffer) => {
      err = (err + d.toString()).slice(-4000)
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err)
      if (m && !settled) {
        settled = true
        clearTimeout(timer)
        proc.stderr!.off('data', onData)
        proc.stderr!.resume() // keep draining so Chrome never blocks on a full pipe
        resolve({ proc, ws: m[1]! })
      }
    }
    const timer = setTimeout(() => fail(new Error(`Chrome did not start within ${timeoutMs} ms: ${err.slice(-300)}`)), timeoutMs)
    proc.stderr!.on('data', onData)
    proc.on('error', (e) => fail(e))
    proc.on('exit', (code) => fail(new Error(`Chrome exited (${code}) before DevTools was ready: ${err.slice(-300)}`)))
  })
}

/** Remove the temporary Chrome profile once Chrome has exited; never throws (e.g. EBUSY on Windows). */
function removeProfile(profile: string, proc: ChildProcess | undefined) {
  const remove = () => {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      // Leaves a temp dir behind; the OS cleans its temp folder.
    }
  }
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return remove()
  proc.once('exit', () => setTimeout(remove, 200).unref())
}

function describe(value: unknown): string {
  const v = value as { description?: string; value?: unknown; type?: string }
  if (v?.description) return v.description
  if (v?.value !== undefined) return typeof v.value === 'string' ? v.value : JSON.stringify(v.value)
  return v?.type ?? String(value)
}

/** Load `url` at `width` in headless Chrome and write a PNG to `out`. */
export async function captureScreenshot(o: ShotOptions): Promise<ShotResult> {
  // Longer than the harness's load-retry budget (~49 s), so a slow install still ends "ready".
  const timeoutMs = o.timeoutMs ?? 75_000
  const deadline = Date.now() + timeoutMs
  const viewportHeight = o.height ?? 900
  const maxHeight = o.maxHeight ?? 8000
  const profile = mkdtempSync(join(tmpdir(), 'astryx-studio-chrome-'))
  let proc: ChildProcess | undefined
  let cdp: Cdp | undefined
  try {
    const launched = await launch(o.chrome, profile, Math.min(20_000, timeoutMs))
    proc = launched.proc
    cdp = await Cdp.open(launched.ws)
    const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string }
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string }
    const send = (m: string, p?: Record<string, unknown>) => cdp!.send(m, p, sessionId)

    const consoleErrors: string[] = []
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p['exceptionDetails'] as { text?: string; exception?: unknown } | undefined
      consoleErrors.push(d?.exception ? describe(d.exception) : (d?.text ?? 'exception'))
    })
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p['type'] !== 'error') return
      consoleErrors.push(((p['args'] as unknown[]) ?? []).map(describe).join(' '))
    })

    const metrics = (h: number) => send('Emulation.setDeviceMetricsOverride', { width: o.width, height: h, deviceScaleFactor: 1, mobile: o.width < 768 })
    await metrics(viewportHeight)
    // Entry animations (chart lines drawing in) are what a screenshot most often catches half-way.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Page.navigate', { url: o.url })

    // Wait for the harness to report ready / error (it may be retrying a load meanwhile, and its
    // reloads destroy the execution context under an in-flight evaluate: keep polling then).
    let pageState: ShotResult['pageState'] = 'timeout'
    while (Date.now() < deadline - 3000) {
      let v: string | undefined
      try {
        const r = (await send('Runtime.evaluate', { expression: 'document.documentElement.dataset.astryxStudio || ""', returnByValue: true })) as { result?: { value?: string } }
        v = r.result?.value
      } catch {
        v = undefined
      }
      if (v === 'ready' || v === 'error') {
        pageState = v
        break
      }
      await sleep(250, o.signal)
    }
    await sleep(o.settleMs ?? 1200, o.signal)

    let height = viewportHeight
    let truncated = false
    if (o.fullPage !== false) {
      const r = (await send('Runtime.evaluate', {
        expression: 'Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))',
        returnByValue: true,
      })) as { result?: { value?: number } }
      const full = Math.max(1, r.result?.value ?? viewportHeight)
      truncated = full > maxHeight
      height = Math.min(full, maxHeight)
      if (height !== viewportHeight) {
        await metrics(height)
        await sleep(300, o.signal)
      }
    }
    const shot = (await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: o.width, height, scale: 1 } })) as { data: string }
    mkdirSync(dirname(o.out), { recursive: true })
    writeFileSync(o.out, Buffer.from(shot.data, 'base64'))
    return { file: o.out, width: o.width, height, truncated, pageState, consoleErrors: consoleErrors.slice(0, 5).map((e) => e.slice(0, 400)) }
  } finally {
    cdp?.close()
    if (proc && proc.exitCode === null) {
      proc.kill('SIGTERM')
      const p = proc
      setTimeout(() => p.exitCode === null && p.kill('SIGKILL'), 2000).unref()
    }
    removeProfile(profile, proc)
  }
}

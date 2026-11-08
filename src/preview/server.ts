/**
 * One preview Vite per workspace, spawned through DSH's `ctx.subprocess`.
 * Lazy start, 127.0.0.1 only, port read back from Vite's own output,
 * one automatic restart after a crash, killed on plugin unload.
 */
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { PreviewStatus } from '../shared/preview-protocol.js'
import { PREVIEW_DIR } from './scaffold.js'

/** The slice of a spawned process the server needs (adapted from SubprocessHandle). */
export interface SpawnedProcess {
  onOutput(listener: (chunk: string) => void): void
  readonly done: Promise<{ exitCode: number | null; signal: string | null }>
  terminate(): void
}

export type Spawner = (argv: readonly string[], cwd: string) => SpawnedProcess

/** Ask the OS for a free loopback port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
const READY = /Local:\s+https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/

/** The port Vite reports in its "Local:" line, if this text contains it. */
export function parseVitePort(text: string): number | undefined {
  const m = READY.exec(text.replace(ANSI, ''))
  return m ? Number(m[1]) : undefined
}

export interface PreviewServerOptions {
  readonly workspace: string
  readonly spawn: Spawner
  readonly pickPort?: () => Promise<number>
  readonly startTimeoutMs?: number
  readonly maxLogLines?: number
  /** Called whenever the status changes (for tests and UI polling). */
  readonly onChange?: (status: PreviewStatus) => void
}

export class PreviewServer {
  private state: PreviewStatus['state'] = 'idle'
  private url: string | undefined
  private error: string | undefined
  private readonly log: string[] = []
  private proc: SpawnedProcess | undefined
  private starting: Promise<PreviewStatus> | undefined
  private restarts = 0
  private stopped = false

  constructor(private readonly opts: PreviewServerOptions) {}

  status(): PreviewStatus {
    return {
      state: this.state,
      ...(this.url ? { url: this.url } : {}),
      ...(this.error ? { error: this.error } : {}),
      log: [...this.log],
    }
  }

  /** Start if not running; concurrent callers share one start. */
  ensure(): Promise<PreviewStatus> {
    if (this.state === 'running') return Promise.resolve(this.status())
    this.stopped = false
    this.starting ??= this.start().finally(() => (this.starting = undefined))
    return this.starting
  }

  stop(): void {
    this.stopped = true
    this.proc?.terminate()
    this.proc = undefined
    this.set('idle')
    this.url = undefined
  }

  private set(state: PreviewStatus['state'], error?: string) {
    this.state = state
    this.error = error
    this.opts.onChange?.(this.status())
  }

  private append(chunk: string) {
    const max = this.opts.maxLogLines ?? 40
    for (const line of chunk.replace(ANSI, '').split(/\r?\n/)) {
      if (line.trim()) this.log.push(line)
    }
    if (this.log.length > max) this.log.splice(0, this.log.length - max)
  }

  private async start(): Promise<PreviewStatus> {
    this.set('starting')
    const port = await (this.opts.pickPort ?? freePort)()
    const vite = join(this.opts.workspace, 'node_modules', '.bin', 'vite')
    const argv = [vite, '--config', join(PREVIEW_DIR, 'vite.config.ts'), '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    const proc = this.opts.spawn(argv, this.opts.workspace)
    this.proc = proc
    let buffer = ''
    const ready = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Vite did not report a port within ${this.opts.startTimeoutMs ?? 60_000} ms`)), this.opts.startTimeoutMs ?? 60_000)
      proc.onOutput((chunk) => {
        this.append(chunk)
        buffer += chunk
        const found = parseVitePort(buffer)
        if (found !== undefined) {
          clearTimeout(timer)
          resolve(found)
        }
      })
      void proc.done.then((exit) => {
        clearTimeout(timer)
        reject(new Error(`Vite exited before it was ready (code ${exit.exitCode ?? exit.signal})`))
      })
    })
    try {
      const actual = await ready
      this.url = `http://127.0.0.1:${actual}/`
      this.set('running')
    } catch (error) {
      proc.terminate()
      this.proc = undefined
      this.set('error', error instanceof Error ? error.message : String(error))
      return this.status()
    }
    void proc.done.then((exit) => this.onExit(proc, exit))
    return this.status()
  }

  private onExit(proc: SpawnedProcess, exit: { exitCode: number | null; signal: string | null }) {
    if (this.proc !== proc || this.stopped) return
    this.proc = undefined
    this.url = undefined
    this.set('idle')
    if (this.restarts < 1) {
      this.restarts++
      this.append(`[astryx-studio] Vite exited (${exit.exitCode ?? exit.signal}); restarting once`)
      void this.ensure()
      return
    }
    this.set('error', `Vite crashed again (${exit.exitCode ?? exit.signal}); see the log tail`)
  }
}

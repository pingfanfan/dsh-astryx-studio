/**
 * Per-session preview state shared by the tools, the verify hook and the RPC
 * channel: which workspace and page a session works on, the Vite server per
 * workspace, the footer's verify status, "please open the tab" requests, and
 * runtime errors reported by the preview page.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Runner } from '../proc.js'
import type { PreviewStatus, SessionStatus, VerifyStatus } from '../shared/preview-protocol.js'
import { installSpec, missingPreviewPackages, writePreviewHarness } from './scaffold.js'
import { PreviewServer, type Spawner } from './server.js'

export interface RuntimeErrorReport {
  readonly kind: string
  readonly message: string
  readonly stack?: string | undefined
}

interface SessionState {
  workspace?: string
  page?: string
  openSeq: number
  /** Time of the model's last write in this session; errors before it are stale. */
  lastWriteAt?: number
  /** Errors already queued since the last write (dedupe key). */
  seen: Set<string>
  pending: RuntimeErrorReport[]
}

const NONE: VerifyStatus = { state: 'none', summary: '', at: 0 }
export const DEFAULT_PAGE = 'src/pages/main/page.tsx'

export interface PreviewManagerOptions {
  readonly run: Runner
  readonly installTimeoutMs: number
  readonly now?: () => number
}

export class PreviewManager {
  private readonly sessions = new Map<string, SessionState>()
  private readonly servers = new Map<string, PreviewServer>()
  private readonly verify = new Map<string, VerifyStatus>()
  private spawner: Spawner | undefined
  /** Finds a session's workspace when the manager has not seen it yet (e.g. after a DSH restart). */
  private resolver: ((sessionId: string) => Promise<string | undefined>) | undefined
  private readonly now: () => number

  constructor(private readonly opts: PreviewManagerOptions) {
    this.now = opts.now ?? Date.now
  }

  /** Provided while ctx.subprocess is available; without it the preview reports `unavailable`. */
  setSpawner(spawner: Spawner | undefined): void {
    this.spawner = spawner
    if (!spawner) this.stopAll()
  }

  setResolver(resolver: ((sessionId: string) => Promise<string | undefined>) | undefined): void {
    this.resolver = resolver
  }

  private session(id: string): SessionState {
    let s = this.sessions.get(id)
    if (!s) {
      s = { openSeq: 0, seen: new Set(), pending: [] }
      this.sessions.set(id, s)
    }
    return s
  }

  /**
   * astryx_template wrote `page` in `workspace`: remember it, ask the client to open the tab, start Vite.
   * `installedPackages` is true when the tool just added packages: a Vite that was already running keeps
   * its failed resolutions ("Failed to resolve import") cached until it restarts, so it is restarted.
   */
  templateWritten(sessionId: string | undefined, workspace: string, page: string, installedPackages = false): void {
    if (sessionId) {
      const s = this.session(sessionId)
      s.workspace = workspace
      s.page = page
      s.openSeq++
      this.modelWrote(sessionId, workspace)
    }
    const server = this.servers.get(workspace)
    if (installedPackages && server?.status().state === 'running') server.stop()
    void this.ensure(workspace)
  }

  /** The model wrote a file in `workspace` (any file tool or a template). */
  modelWrote(sessionId: string | undefined, workspace: string): void {
    if (!sessionId) return
    const s = this.session(sessionId)
    s.workspace ??= workspace
    s.lastWriteAt = this.now()
    s.seen.clear()
    s.pending = []
  }

  setVerify(workspace: string, status: Omit<VerifyStatus, 'at'>): void {
    this.verify.set(workspace, { ...status, at: this.now() })
  }

  /** Start (or reuse) the preview server for a workspace, writing the harness and installing what it needs. */
  async ensure(workspace: string): Promise<PreviewStatus> {
    if (!this.spawner) return { state: 'unavailable', error: 'ctx.subprocess is not available in this profile', log: [] }
    let server = this.servers.get(workspace)
    if (!server) {
      const spawner = this.spawner
      server = new PreviewServer({ workspace, spawn: (argv, cwd) => spawner(argv, cwd) })
      this.servers.set(workspace, server)
    }
    if (server.status().state === 'running') return server.status()
    writePreviewHarness(workspace)
    const missing = missingPreviewPackages(workspace)
    if (missing.length > 0) {
      const r = await this.opts.run('pnpm', ['add', ...missing.map(installSpec)], { cwd: workspace, timeoutMs: this.opts.installTimeoutMs })
      if (r.code !== 0) {
        const npm = await this.opts.run('npm', ['install', ...missing.map(installSpec)], { cwd: workspace, timeoutMs: this.opts.installTimeoutMs })
        if (npm.code !== 0) return { state: 'error', error: `installing ${missing.join(', ')} failed: ${(npm.stderr || r.stderr).slice(-400)}`, log: [] }
      }
    }
    return server.ensure()
  }

  /** The tab opened or asked for a status: start lazily for a known workspace. */
  async open(sessionId: string): Promise<SessionStatus> {
    const s = this.session(sessionId)
    if (!s.workspace && this.resolver) {
      const workspace = await this.resolver(sessionId).catch(() => undefined)
      if (workspace) {
        s.workspace = workspace
        if (existsSync(join(workspace, DEFAULT_PAGE))) s.page ??= DEFAULT_PAGE
      }
    }
    if (s.workspace && s.page) await this.ensure(s.workspace)
    return this.status(sessionId)
  }

  status(sessionId: string): SessionStatus {
    const s = this.session(sessionId)
    const server = s.workspace ? this.servers.get(s.workspace) : undefined
    const preview: PreviewStatus = !this.spawner
      ? { state: 'unavailable', error: 'ctx.subprocess is not available in this profile', log: [] }
      : (server?.status() ?? { state: 'idle', log: [] })
    return {
      ...(s.workspace ? { workspace: s.workspace } : {}),
      ...(s.page ? { page: s.page } : {}),
      preview,
      verify: (s.workspace && this.verify.get(s.workspace)) || NONE,
      openSeq: s.openSeq,
      ...(s.lastWriteAt ? { lastWriteAt: s.lastWriteAt } : {}),
    }
  }

  /**
   * A runtime error from the preview page. Queued for the model only if the
   * model has written in this session, the error happened after that write,
   * and the same error has not been queued since. Returns whether it was queued.
   */
  reportRuntimeError(sessionId: string, report: RuntimeErrorReport, at = this.now()): boolean {
    const s = this.session(sessionId)
    if (s.lastWriteAt === undefined || at < s.lastWriteAt) return false
    const key = `${report.kind}:${report.message}`
    if (s.seen.has(key)) return false
    s.seen.add(key)
    s.pending.push(report)
    return true
  }

  /** Take the runtime errors queued for a session (at the agent's next step). */
  takeRuntimeErrors(sessionId: string): RuntimeErrorReport[] {
    const s = this.sessions.get(sessionId)
    if (!s || s.pending.length === 0) return []
    const out = s.pending
    s.pending = []
    return out
  }

  stopAll(): void {
    for (const server of this.servers.values()) server.stop()
    this.servers.clear()
  }
}

export function formatRuntimeErrors(errors: readonly RuntimeErrorReport[]): string {
  return [
    `预览运行时错误（astryx preview, ${errors.length}）:`,
    ...errors.map((e) => `- [${e.kind}] ${e.message}${e.stack ? `\n  ${e.stack.split('\n').slice(1, 3).map((l) => l.trim()).join('\n  ')}` : ''}`),
    'The page compiles but fails at runtime in the preview. Fix it with the file tools.',
  ].join('\n')
}

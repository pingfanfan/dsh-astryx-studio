/**
 * Asynchronous `tsc --noEmit --incremental` per workspace. One run at a time
 * per workspace; a new request aborts the one in flight, and an aborted run
 * reports nothing. Only the newest completed result is kept for injection.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { packageBin } from '../platform.js'
import { join, relative } from 'node:path'
import type { Runner } from '../proc.js'

export interface TscDiagnostic {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly code: string
  readonly message: string
}

export type TscOutcome =
  | { readonly kind: 'pass'; readonly ms: number }
  | { readonly kind: 'fail'; readonly ms: number; readonly diagnostics: readonly TscDiagnostic[] }
  | { readonly kind: 'unverified'; readonly ms: number; readonly reason: string }

const DIAG_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/

export function parseTscOutput(output: string, workspace: string): TscDiagnostic[] {
  const out: TscDiagnostic[] = []
  for (const raw of output.split(/\r?\n/)) {
    const m = DIAG_RE.exec(raw.trim())
    if (!m) continue
    const file = m[1]!
    out.push({
      file: file.startsWith('/') ? relative(workspace, file) : file,
      line: Number(m[2]),
      column: Number(m[3]),
      code: m[4]!,
      message: m[5]!,
    })
  }
  return out
}

export function tscArgs(workspace: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  const local = join(workspace, 'node_modules', '.bin', 'tsc')
  const project = existsSync(join(workspace, 'tsconfig.app.json')) ? 'tsconfig.app.json' : 'tsconfig.json'
  // The workspace's own TypeScript: .bin/tsc, or `node typescript/bin/tsc` on Windows (no .cmd shim).
  // On Windows .bin holds only a .cmd shim, so look for the JavaScript entry instead.
  const hasLocal = platform === 'win32' ? existsSync(join(workspace, 'node_modules', 'typescript', 'bin', 'tsc')) : existsSync(local)
  const [command, ...pre] = hasLocal ? packageBin(workspace, 'tsc', platform) : ['tsc']
  return {
    command: command!,
    args: [
      ...pre,
      '--noEmit',
      '--incremental',
      '--tsBuildInfoFile',
      join('.astryx-studio', 'tsbuildinfo'),
      '--pretty',
      'false',
      '-p',
      project,
    ],
  }
}

export interface TscScheduler {
  /** Start a run for `workspace`, aborting any run in flight there. Resolves with its outcome, or undefined if superseded. */
  schedule(workspace: string): Promise<TscOutcome | undefined>
  /** Take (and clear) the newest completed outcome for `workspace`. */
  take(workspace: string): TscOutcome | undefined
  /** The run in flight for `workspace`, if any (resolves when it settles, whatever the outcome). */
  inflight(workspace: string): Promise<unknown> | undefined
  /** Abort everything (plugin dispose). */
  dispose(): void
}

export function createTscScheduler(options: { run: Runner; timeoutMs: number }): TscScheduler {
  const inflight = new Map<string, AbortController>()
  const running = new Map<string, Promise<unknown>>()
  const results = new Map<string, TscOutcome>()
  const scheduler: TscScheduler = {
    schedule(workspace) {
      const p = runOnce(workspace)
      running.set(workspace, p)
      void p.finally(() => {
        if (running.get(workspace) === p) running.delete(workspace)
      })
      return p
    },
    take(workspace) {
      const r = results.get(workspace)
      results.delete(workspace)
      return r
    },
    inflight(workspace) {
      return running.get(workspace)
    },
    dispose() {
      for (const c of inflight.values()) c.abort()
      inflight.clear()
      running.clear()
      results.clear()
    },
  }
  return scheduler

  async function runOnce(workspace: string): Promise<TscOutcome | undefined> {
    {
      inflight.get(workspace)?.abort()
      const controller = new AbortController()
      inflight.set(workspace, controller)
      results.delete(workspace)
      mkdirSync(join(workspace, '.astryx-studio'), { recursive: true })
      const { command, args } = tscArgs(workspace)
      let outcome: TscOutcome
      try {
        const r = await options.run(command, args, {
          cwd: workspace,
          signal: controller.signal,
          timeoutMs: options.timeoutMs,
        })
        if (r.aborted || controller.signal.aborted) return undefined
        if (r.timedOut) {
          outcome = { kind: 'unverified', ms: r.ms, reason: `tsc exceeded ${options.timeoutMs} ms` }
        } else if (r.code === 0) {
          outcome = { kind: 'pass', ms: r.ms }
        } else {
          const diagnostics = parseTscOutput(r.stdout + '\n' + r.stderr, workspace)
          outcome =
            diagnostics.length > 0
              ? { kind: 'fail', ms: r.ms, diagnostics }
              : { kind: 'unverified', ms: r.ms, reason: (r.stderr || r.stdout).trim().slice(0, 300) || `tsc exited ${r.code}` }
        }
      } catch (error) {
        if (controller.signal.aborted) return undefined
        outcome = { kind: 'unverified', ms: 0, reason: error instanceof Error ? error.message : String(error) }
      }
      if (inflight.get(workspace) !== controller) return undefined
      inflight.delete(workspace)
      results.set(workspace, outcome)
      return outcome
    }
  }
}

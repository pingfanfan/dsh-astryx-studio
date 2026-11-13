import { spawn } from 'node:child_process'
import { launch, treeKill } from './platform.js'

export interface RunResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly ms: number
}

export interface RunOptions {
  readonly cwd: string
  readonly signal?: AbortSignal | undefined
  readonly timeoutMs?: number | undefined
  /** Run through `sh -c` (for CLI-provided command strings such as installCommand). */
  readonly shell?: boolean
}

export type Runner = (command: string, args: readonly string[], options: RunOptions) => Promise<RunResult>

/** How long a killed child gets to exit on SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 3000
/** How long output may keep arriving after the child exited before the result settles. */
const DRAIN_MS = 2000

/** Spawn a process, collect output, honour abort and timeout. Never rejects on a non-zero exit. */
export const runProcess: Runner = (command, args, options) =>
  new Promise((resolvePromise, reject) => {
    const started = Date.now()
    // Windows: a bare pnpm / npm is a .cmd shim and goes through cmd.exe (see platform.ts).
    const l = options.shell ? { command, args: [...args] } : launch(command, args)
    const child = spawn(l.command, l.args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      ...(l.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    let force: ReturnType<typeof setTimeout> | undefined
    const kill = () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const tree = child.pid !== undefined ? treeKill(child.pid) : undefined
      if (tree) {
        // Windows: the process tree, or cmd.exe dies and the pnpm under it keeps running.
        try {
          spawn(tree.command, tree.args, { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill())
        } catch {
          child.kill()
        }
      } else child.kill('SIGTERM')
      // A child that ignores SIGTERM must not hold the caller forever.
      force ??= setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, KILL_GRACE_MS)
      force.unref?.()
    }
    const onAbort = () => {
      aborted = true
      kill()
    }
    if (options.signal?.aborted) onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true
            kill()
          }, options.timeoutMs)
        : undefined
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      if (force) clearTimeout(force)
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    let settled = false
    let drain: ReturnType<typeof setTimeout> | undefined
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (force) clearTimeout(force)
      if (drain) clearTimeout(drain)
      options.signal?.removeEventListener('abort', onAbort)
      resolvePromise({ code, stdout, stderr, timedOut, aborted, ms: Date.now() - started })
    }
    child.on('close', (code) => finish(code))
    // 'close' waits for the pipes; a grandchild (pnpm under cmd.exe) can keep them open after the
    // child itself exited. Settle shortly after 'exit' then.
    child.on('exit', (code) => {
      drain = setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
        finish(code)
      }, DRAIN_MS)
      drain.unref?.()
    })
  })

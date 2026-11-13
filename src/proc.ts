import { spawn } from 'node:child_process'
import { launch } from './platform.js'

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
    const kill = () => {
      if (child.exitCode === null) child.kill('SIGTERM')
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
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolvePromise({ code, stdout, stderr, timedOut, aborted, ms: Date.now() - started })
    })
  })

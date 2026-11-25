import { ASTRYX_VERSION } from '../src/workspace.js'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Runner, RunResult } from '../src/proc.js'

/** A temp folder; `astryx: true` makes it an Astryx workspace (package.json depends on core). */
export function tempProject(files: Record<string, string> = {}, astryx = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'astryx-studio-test-'))
  if (astryx) files = { 'package.json': JSON.stringify({ dependencies: { '@astryxdesign/core': ASTRYX_VERSION } }), ...files }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  return dir
}

export const ok = (over: Partial<RunResult> = {}): RunResult => ({
  code: 0, stdout: '', stderr: '', timedOut: false, aborted: false, ms: 1200, ...over,
})

/** A runner whose calls are recorded and resolved by the test. */
export function fakeRunner() {
  const calls: { command: string; args: readonly string[]; cwd: string; shell: boolean; signal?: AbortSignal; resolve: (r: RunResult) => void }[] = []
  const run: Runner = (command, args, options) =>
    new Promise((resolve) => {
      const entry = { command, args, cwd: options.cwd, shell: options.shell ?? false, signal: options.signal, resolve }
      calls.push(entry)
      options.signal?.addEventListener('abort', () => resolve(ok({ aborted: true, code: null })), { once: true })
    })
  return { run, calls }
}

export const tick = () => new Promise((r) => setTimeout(r, 0))

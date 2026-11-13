/**
 * Framework-free core of the verify hook. `index.ts` wires it to
 * `tools/pre-execute`, `tools/post-execute` and `agent/pre-step`.
 *
 * - before a file tool runs: snapshot the files it names (by call id);
 * - after it runs: for every written .ts/.tsx inside the Astryx workspace,
 *   run the esbuild syntax check and the lint count-diff synchronously, and
 *   start tsc in the background;
 * - at the agent's next step: hand over the newest tsc result.
 */
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { isInside } from '../workspace.js'
import { lintDiff, type LintFinding } from './lint.js'
import { checkSyntax, type SyntaxError } from './syntax.js'
import type { TscOutcome, TscScheduler } from './tsc.js'

export const FILE_TOOLS = ['write', 'edit', 'apply_patch', 'str_replace_editor'] as const

export function isFileTool(name: string): boolean {
  return (FILE_TOOLS as readonly string[]).includes(name)
}

const PATCH_PATH_RE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

/** Paths a file tool call names in its arguments (unresolved). */
export function pathsFromArgs(name: string, args: unknown): string[] {
  const a = (args ?? {}) as Record<string, unknown>
  if (name === 'write' || name === 'edit') return typeof a.file_path === 'string' ? [a.file_path] : []
  if (name === 'str_replace_editor') return typeof a.path === 'string' ? [a.path] : []
  if (name === 'apply_patch' && typeof a.input === 'string') {
    return [...a.input.matchAll(PATCH_PATH_RE)].map((m) => m[1]!.trim())
  }
  return []
}

/** Absolute paths a file tool's result says it wrote. */
export function pathsFromValue(name: string, value: unknown, cwd: string | undefined): string[] {
  const v = (value ?? {}) as Record<string, unknown>
  const abs = (p: string) => (cwd ? resolve(cwd, p) : resolve(p))
  if (name === 'apply_patch' && Array.isArray(v.operations)) {
    const out: string[] = []
    for (const op of v.operations as Record<string, unknown>[]) {
      if (op.kind === 'delete') continue
      const p = typeof op.destination === 'string' ? op.destination : op.path
      if (typeof p === 'string') out.push(abs(p))
    }
    return out
  }
  return typeof v.path === 'string' ? [abs(v.path)] : []
}

/**
 * Files a file tool's result says it wrote, each with the file whose snapshot is its baseline:
 * itself, or for an apply_patch move (`Update File: A` + `Move to: B`) the source A, so a rename
 * is not judged as a brand-new file. Operations that did not complete are skipped.
 */
export function writesFromValue(name: string, value: unknown, cwd: string | undefined): { file: string; from: string }[] {
  const v = (value ?? {}) as Record<string, unknown>
  const abs = (p: string) => (cwd ? resolve(cwd, p) : resolve(p))
  if (name === 'apply_patch' && Array.isArray(v.operations)) {
    const out: { file: string; from: string }[] = []
    for (const op of v.operations as Record<string, unknown>[]) {
      if (op.kind === 'delete' || op.status === 'skipped') continue
      // A failed or unknown op may still have written (a move whose source delete failed): check
      // what it wrote. A file it never touched reads back unchanged and reports nothing new.
      const src = typeof op.path === 'string' ? abs(op.path) : undefined
      const dest = typeof op.destination === 'string' ? abs(op.destination) : src
      if (dest) out.push({ file: dest, from: src ?? dest })
    }
    return out
  }
  return typeof v.path === 'string' ? [{ file: abs(v.path), from: abs(v.path) }] : []
}

/** Page and component sources only: not declarations, not tool configs such as vite.config.ts. */
export function isCheckedFile(workspace: string, file: string): boolean {
  return (
    /\.tsx?$/.test(file) &&
    !file.endsWith('.d.ts') &&
    !/\.config\.[cm]?tsx?$/.test(file) &&
    isInside(workspace, file) &&
    !relative(workspace, file).split(/[\\/]/).some((seg) => seg === 'node_modules' || seg === '.astryx-studio')
  )
}

export interface FileReport {
  readonly file: string
  readonly syntax: readonly SyntaxError[]
  readonly lint: readonly LintFinding[]
}

export interface VerifierDeps {
  readonly tsc: TscScheduler
  readonly maxReportedErrors: number
  readonly readFile?: (file: string) => string | undefined
  /** Footer status for the preview tab: called on every sync result and every finished tsc run. */
  readonly onStatus?: (workspace: string, status: { state: 'running' | 'pass' | 'fail' | 'unverified'; summary: string }) => void
}

const MAX_SNAPSHOTS = 64
const MAX_AGENTS = 256

/** Drop the oldest entries (insertion order) until at most `max` remain. */
function capMap<K, V>(map: Map<K, V>, max: number): void {
  for (const k of map.keys()) {
    if (map.size <= max) break
    map.delete(k)
  }
}

const defaultRead = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined)

export class Verifier {
  /** Keyed by DSH's per-execution token (unique), else the model's call id (tests). */
  private readonly snapshots = new Map<PropertyKey, { at: number; files: Map<string, string> }>()
  /** Newest tsc outcome per workspace, numbered, and the newest number each agent has seen. */
  private readonly latest = new Map<string, { gen: number; outcome: TscOutcome }>()
  private readonly seen = new Map<string, number>()
  private generation = 0
  /** Workspace each agent last wrote into, so its next step knows whose tsc result to collect. */
  private readonly agentWorkspace = new Map<string, string>()
  private readonly read: (file: string) => string | undefined

  constructor(private readonly deps: VerifierDeps) {
    this.read = deps.readFile ?? defaultRead
  }

  /** Before a file tool runs: remember the current contents of the files it names. */
  snapshot(key: PropertyKey, name: string, args: unknown, cwd: string | undefined): void {
    if (!isFileTool(name)) return
    // A call whose post-execute never ran (another hook threw) must not keep file contents
    // forever: keep only the newest snapshots (a long approval prompt must not lose its own).
    const now = Date.now()
    capMap(this.snapshots, MAX_SNAPSHOTS - 1)
    const files = new Map<string, string>()
    for (const p of pathsFromArgs(name, args)) {
      const abs = cwd ? resolve(cwd, p) : resolve(p)
      files.set(abs, this.read(abs) ?? '')
    }
    this.snapshots.set(key, { at: now, files })
  }

  /** Drop a snapshot (call denied or failed). */
  forget(key: PropertyKey): void {
    this.snapshots.delete(key)
  }

  /**
   * After a file tool succeeded. Returns the synchronous findings per checked
   * file (empty when everything passed or nothing was in scope) and starts tsc.
   */
  async afterWrite(input: {
    callId: PropertyKey
    name: string
    value: unknown
    cwd: string | undefined
    workspace: string | undefined
    agentId: string | undefined
  }): Promise<FileReport[]> {
    const before = this.snapshots.get(input.callId)?.files ?? new Map<string, string>()
    this.snapshots.delete(input.callId)
    const { workspace } = input
    if (!workspace || !isFileTool(input.name)) return []
    const writes = writesFromValue(input.name, input.value, input.cwd).filter((w) => isCheckedFile(workspace, w.file))
    if (writes.length === 0) return []
    const reports: FileReport[] = []
    for (const { file, from } of writes) {
      const after = this.read(file)
      if (after === undefined) continue
      const syntax = checkSyntax(after, file)
      const lint = await lintDiff(before.get(from) ?? before.get(file) ?? '', after, undefined, file)
      if (syntax.length > 0 || lint.length > 0) reports.push({ file: relative(workspace, file), syntax, lint })
    }
    if (input.agentId) {
      // Re-insert so the map's order is recency; subagent ids must not pile up over a session.
      this.agentWorkspace.delete(input.agentId)
      this.agentWorkspace.set(input.agentId, workspace)
      capMap(this.agentWorkspace, MAX_AGENTS)
      capMap(this.seen, MAX_AGENTS)
    }
    this.deps.onStatus?.(workspace, reports.length > 0
      ? { state: 'fail', summary: this.formatReports(reports).split('\n').slice(1, 3).join(' · ') }
      : { state: 'running', summary: 'tsc …' })
    // Syntax errors make tsc noise; still start it so the newest write always owns the run.
    const syncFailed = reports.length > 0
    const gen = ++this.generation
    // The result of an older run predates this write: nobody may take it while the new run goes.
    this.latest.delete(workspace)
    void this.deps.tsc
      .schedule(workspace)
      .then((outcome) => {
        // A superseded run reports nothing. The next step still gets the outcome; only the status
        // line keeps the sync ✗ that already went out with the tool result.
        if (!outcome || gen < (this.latest.get(workspace)?.gen ?? 0)) return
        this.latest.set(workspace, { gen, outcome })
        if (syncFailed) return
        const text = this.formatTsc(outcome)
        this.deps.onStatus?.(workspace, {
          state: outcome.kind,
          summary: outcome.kind === 'fail' ? text.split('\n').slice(0, 2).join(' · ') : text,
        })
      })
      .catch(() => undefined)
    return reports
  }

  /**
   * At the agent's next step: the newest tsc outcome for the workspace it last
   * wrote to. If a run is still in flight, wait for it up to `waitMs` (an
   * incremental run takes ~0.5–3 s), so a model that moves fast or ends its
   * turn right after an edit still sees the verdict. Never throws.
   */
  async collect(agentId: string, waitMs = 0, signal?: AbortSignal): Promise<{ workspace: string; outcome: TscOutcome } | undefined> {
    const workspace = this.agentWorkspace.get(agentId)
    if (!workspace) return undefined
    // Every agent that wrote in the workspace sees each new result once (a subagent's own error is
    // not consumed by the parent's step, or the other way round).
    const fresh = () => {
      const l = this.latest.get(workspace)
      if (!l || l.gen <= (this.seen.get(agentId) ?? 0)) return undefined
      this.seen.set(agentId, l.gen)
      return l.outcome
    }
    let outcome = fresh()
    const running = this.deps.tsc.inflight(workspace)
    if (!outcome && running && waitMs > 0 && !signal?.aborted) {
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      await Promise.race([
        running.catch(() => undefined),
        new Promise<void>((r) => {
          timer = setTimeout(r, waitMs)
          onAbort = () => r()
          signal?.addEventListener('abort', onAbort, { once: true })
        }),
      ])
      if (timer) clearTimeout(timer)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      // Let the schedule().then() above record the outcome first.
      await Promise.resolve()
      outcome = fresh()
    }
    return outcome ? { workspace, outcome } : undefined
  }

  formatReports(reports: readonly FileReport[]): string {
    const max = this.deps.maxReportedErrors
    const lines: string[] = []
    for (const r of reports) {
      for (const s of r.syntax.slice(0, max)) lines.push(`${r.file}:${s.line}:${s.column} syntax: ${s.message}`)
      for (const l of r.lint.slice(0, max)) lines.push(`${r.file} lint: ${l.message}`)
    }
    return `astryx verify ✗\n${lines.join('\n')}\nFix these with the file tools before continuing.`
  }

  formatTsc(outcome: TscOutcome): string {
    const secs = (outcome.ms / 1000).toFixed(1)
    if (outcome.kind === 'pass') return `astryx verify ✓ (tsc ${secs}s)`
    if (outcome.kind === 'unverified') return `astryx verify ? not verified (tsc ${secs}s): ${outcome.reason}`
    const shown = outcome.diagnostics.slice(0, this.deps.maxReportedErrors)
    const more = outcome.diagnostics.length - shown.length
    return [
      `astryx verify ✗ (tsc ${secs}s)`,
      ...shown.map((d) => `${d.file}:${d.line} ${d.code}: ${d.message}`),
      ...(more > 0 ? [`… ${more} more`] : []),
      'Fix these with the file tools (check props with astryx_component first).',
    ].join('\n')
  }
}

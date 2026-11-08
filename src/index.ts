/**
 * dsh-astryx-studio — Host half.
 *
 * Five Astryx tools, the verify hook (esbuild + lint synchronously, tsc in the
 * background), a stable prompt section and the bundled `astryx-page` skill.
 * The Vite preview arrives on Day 2.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { join, relative } from 'node:path'
import { loadAstryxApi } from './astryx.js'
import { formatRuntimeErrors, PreviewManager } from './preview/manager.js'
import type { Spawner } from './preview/server.js'
import { createRpcHandler, fetchRoutes } from './rpc.js'
import { defaultPrefsFile, thumbRoute } from './gallery.js'
import { Config, DEFAULT_CONFIG } from './config.js'
import { runProcess, type Runner } from './proc.js'
import { PROMPT_SECTION_NAME, PROMPT_TEXT, SKILL_REGISTRATION } from './prompt.js'
import { createTools, TOOL_NAMES } from './tools.js'
import { createTscScheduler } from './verify/tsc.js'
import { isFileTool, Verifier } from './verify/verifier.js'
import { detectWorkspace } from './workspace.js'

export { Config }
export const name = 'dsh-astryx-studio'
export const inject = ['tools', 'systemPrompt', 'skills', 'workingDirectory']

export const MESSAGE_SOURCE = 'astryx-studio'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Verify findings injected by the astryx-studio plugin. */
    'astryx-studio': { kind: 'astryx-studio' }
  }
}

export function verifyMessage(body: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text: body }], source: { kind: MESSAGE_SOURCE } })
}

/** Test seam: replace process spawning and the CLI. */
export interface Overrides {
  run?: Runner
  api?: typeof loadAstryxApi
  /** Replaces ctx.subprocess for the preview Vite. */
  spawner?: Spawner
}

/** Adapt DSH's `ctx.subprocess` to the preview server's spawner. */
export function subprocessSpawner(subprocess: SubprocessRuntime): Spawner {
  return (argv, cwd) => {
    const handle = subprocess.spawn({
      argv,
      cwd,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 3_000,
      env: { FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none' },
    })
    return {
      onOutput(listener) {
        handle.stdout?.on('data', (d: Buffer) => listener(d.toString()))
        handle.stderr?.on('data', (d: Buffer) => listener(d.toString()))
      },
      done: handle.done.then((o) => ({ exitCode: o.exitCode, signal: o.signal })),
      terminate: () => handle.terminate(),
    }
  }
}

export function apply(ctx: Context, config: Partial<Config> = {}, overrides: Overrides = {}) {
  const cfg: Config = { ...DEFAULT_CONFIG, ...config }
  const run = overrides.run ?? runProcess
  const tsc = createTscScheduler({ run, timeoutMs: cfg.tscTimeoutMs })
  ctx.effect(() => () => tsc.dispose(), 'astryx-studio: tsc scheduler')
  const manager = new PreviewManager({ run, installTimeoutMs: cfg.installTimeoutMs })
  const verifier = new Verifier({
    tsc,
    maxReportedErrors: cfg.maxReportedErrors,
    onStatus: (workspace, status) => manager.setVerify(workspace, status),
  })
  const api = overrides.api ?? loadAstryxApi

  // Preview Vite runs through ctx.subprocess when the profile has it. A sub-plugin with its
  // own static `inject` stays pending (instead of failing the whole plugin) where it is missing.
  if (overrides.spawner) {
    manager.setSpawner(overrides.spawner)
    ctx.effect(() => () => manager.stopAll(), 'astryx-studio: preview servers')
  } else {
    ctx.plugin({
      name: 'astryx-studio-preview-subprocess',
      inject: ['subprocess'],
      apply(sub: Context) {
        sub.effect(() => {
          manager.setSpawner(subprocessSpawner(sub.subprocess))
          return () => manager.setSpawner(undefined)
        }, 'astryx-studio: preview servers')
      },
    })
  }

  // After a DSH restart the manager has forgotten which workspace a session uses:
  // resolve it from the live agent's working directory when the tab asks.
  let followup: ((sessionId: string, text: string) => boolean) | undefined
  ctx.plugin({
    name: 'astryx-studio-session-resolver',
    inject: ['agents', 'workingDirectory'],
    apply(sub: Context) {
      sub.effect(() => {
        followup = (sessionId, text) => {
          const agent = sub.agents.get(sessionId as never)
          if (!agent) return false
          agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
          return true
        }
        manager.setResolver(async (sessionId) => {
          const agent = sub.agents.get(sessionId as never)
          if (!agent) return undefined
          const cwd = await sub.workingDirectory.ensure(agent)
          return detectWorkspace(cwd, cfg.appDir)
        })
        return () => {
          manager.setResolver(undefined)
          followup = undefined
        }
      }, 'astryx-studio: session resolver')
    },
  })

  // Client tab ↔ Host RPC where the profile has a connection (web), as exact Fetch routes on
  // the shared /api channel. (`rpc.handle('/astryx-studio')` would mount through the caller's
  // ctx.webServer, which a bundle plugin cannot see in the web profile.)
  ctx.plugin({
    name: 'astryx-studio-rpc',
    inject: ['connection'],
    apply(sub: Context) {
      const handler = createRpcHandler({
        manager,
        exportHtml: async (workspace, page) => {
          // A fresh, timestamped file in a visible exports/ folder: the CLI never replaces an
          // existing git-ignored file, and resolves `out` against the process cwd (so: absolute).
          const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
          const name = page.replace(/^src[\\/]/, '').replace(/[\\/]/g, '_').replace(/\.tsx?$/, '')
          const out = join(workspace, 'exports', `${name}-${stamp}.html`)
          const r = await (await api()).render(join(workspace, page), { cwd: workspace, out })
          const file = (r.data as { output?: string }).output ?? out
          return relative(workspace, file.startsWith('/') ? file : join(workspace, file)) || file
        },
        followup: (sessionId, text) => followup?.(sessionId, text) ?? false,
        prefsFile: cfg.prefsFile || defaultPrefsFile(),
      })
      for (const route of fetchRoutes(handler)) sub.connection.fetch.register(route)
      sub.connection.fetch.register(thumbRoute())
    },
  })

  const cwdOf = async (exec: Pick<ToolExecution, 'agent' | 'signal'>): Promise<string | undefined> => {
    if (!exec.agent) return undefined
    try {
      return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    } catch {
      return undefined
    }
  }

  for (const tool of createTools({
    api,
    cwdOf: (exec: ToolRunContext) => cwdOf(exec),
    config: cfg,
    run,
    tsc,
    onTemplate: (exec, workspace, page) => manager.templateWritten(exec.agent?.id, workspace, page),
  })) {
    ctx.effect(() => ctx.tools.register(tool), `astryx-studio: ${tool.name}`)
  }

  ctx.effect(
    () => ctx.systemPrompt.section({ name: PROMPT_SECTION_NAME, order: 900, text: PROMPT_TEXT, interpolate: false }),
    'astryx-studio: prompt section',
  )
  ctx.effect(() => ctx.skills.register(SKILL_REGISTRATION), 'astryx-studio: astryx-page skill')

  // Pre-execute: ask before scaffolding; snapshot files a file tool is about to change.
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === TOOL_NAMES.template) {
      const cwd = await cwdOf(exec)
      if (cwd && !detectWorkspace(cwd, cfg.appDir)) {
        const decision = await next()
        if (decision.kind !== 'allow') return decision
        return {
          kind: 'ask',
          reason: `astryx_template will create an Astryx project in ${cwd}/${cfg.appDir} and install its dependencies`,
          displayReason: {
            en: `Create an Astryx project in ./${cfg.appDir} and install its dependencies?`,
            zh: `在 ./${cfg.appDir} 新建 Astryx 项目并安装依赖？`,
          },
        }
      }
      return next()
    }
    if (isFileTool(exec.name)) verifier.snapshot(exec.callId, exec.name, exec.arguments, await cwdOf(exec))
    return next()
  })

  // Post-execute: synchronous syntax + lint on written Astryx files; start tsc.
  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (!isFileTool(exec.name)) return next()
    if (result.isError) {
      verifier.forget(exec.callId)
      return next()
    }
    const cwd = await cwdOf(exec)
    const workspace = cwd ? detectWorkspace(cwd, cfg.appDir) : undefined
    const reports = await verifier.afterWrite({
      callId: exec.callId,
      name: exec.name,
      value: result.value,
      cwd,
      workspace,
      agentId: exec.agent?.id,
    })
    if (workspace) manager.modelWrote(exec.agent?.id, workspace)
    const decision = await next()
    if (reports.length === 0 || decision.kind !== 'accept') return decision
    return {
      ...decision,
      additionalContexts: [...(decision.additionalContexts ?? []), verifyMessage(verifier.formatReports(reports))],
    }
  })

  // Pre-step: hand the newest tsc result and any gated preview runtime errors to the agent.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const extra: UserMessage[] = []
    const found = await verifier.collect(payload.agent.id, cfg.tscStepWaitMs, payload.signal)
    if (found) extra.push(verifyMessage(verifier.formatTsc(found.outcome)))
    const runtime = manager.takeRuntimeErrors(payload.agent.id)
    if (runtime.length > 0) extra.push(verifyMessage(formatRuntimeErrors(runtime)))
    if (extra.length === 0) return decision
    return { ...decision, messages: [...decision.messages, ...extra] }
  })
}

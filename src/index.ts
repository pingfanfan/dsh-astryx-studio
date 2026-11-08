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
import type { ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { loadAstryxApi } from './astryx.js'
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
}

export function apply(ctx: Context, config: Partial<Config> = {}, overrides: Overrides = {}) {
  const cfg: Config = { ...DEFAULT_CONFIG, ...config }
  const run = overrides.run ?? runProcess
  const tsc = createTscScheduler({ run, timeoutMs: cfg.tscTimeoutMs })
  ctx.effect(() => () => tsc.dispose(), 'astryx-studio: tsc scheduler')
  const verifier = new Verifier({ tsc, maxReportedErrors: cfg.maxReportedErrors })

  const cwdOf = async (exec: Pick<ToolExecution, 'agent' | 'signal'>): Promise<string | undefined> => {
    if (!exec.agent) return undefined
    try {
      return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    } catch {
      return undefined
    }
  }

  for (const tool of createTools({
    api: overrides.api ?? loadAstryxApi,
    cwdOf: (exec: ToolRunContext) => cwdOf(exec),
    config: cfg,
    run,
    tsc,
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
    const reports = await verifier.afterWrite({
      callId: exec.callId,
      name: exec.name,
      value: result.value,
      cwd,
      workspace: cwd ? detectWorkspace(cwd, cfg.appDir) : undefined,
      agentId: exec.agent?.id,
    })
    const decision = await next()
    if (reports.length === 0 || decision.kind !== 'accept') return decision
    return {
      ...decision,
      additionalContexts: [...(decision.additionalContexts ?? []), verifyMessage(verifier.formatReports(reports))],
    }
  })

  // Pre-step: hand the newest finished tsc result to the agent that wrote.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const found = await verifier.collect(payload.agent.id, cfg.tscStepWaitMs, payload.signal)
    if (!found) return decision
    return { ...decision, messages: [...decision.messages, verifyMessage(verifier.formatTsc(found.outcome))] }
  })
}

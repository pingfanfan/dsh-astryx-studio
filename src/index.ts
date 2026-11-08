/**
 * dsh-astryx-studio — Host half.
 *
 * Day 0 skeleton: one placeholder tool (`astryx_ping`) and one prompt section.
 * The five Astryx tools, the verify hook and the Vite preview land on Day 1/2.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'dsh-astryx-studio'
export const inject = ['tools', 'systemPrompt']

export const PING_TOOL = 'astryx_ping'
export const PROMPT_SECTION = 'astryx-studio'

export interface PingResult {
  readonly ok: true
  readonly plugin: string
  readonly echo: string
}

/** Pure core of `astryx_ping`, exported for tests. */
export function ping(message?: string): PingResult {
  return { ok: true, plugin: name, echo: message ?? 'pong' }
}

export const pingTool = defineTool({
  name: PING_TOOL,
  description:
    'Health check for the Astryx Studio plugin. Returns ok and echoes the message. ' +
    'Placeholder until the real Astryx tools ship; do not call it for page work.',
  parameters: {
    message: { type: 'string', description: 'Optional text to echo back.' },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', required: true },
        plugin: { type: 'string', required: true },
        echo: { type: 'string', required: true },
      },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: 'text', text: `astryx-studio ok: ${value.echo}` }],
  },
  isConcurrencySafe: () => true,
  async execute(args) {
    return ping(args.message)
  },
})

/** Stable across turns so DeepSeek's prefix cache survives. Real content arrives on Day 3. */
export const PROMPT_TEXT = ''

export function apply(ctx: Context) {
  ctx.effect(() => ctx.tools.register(pingTool), 'astryx-studio: astryx_ping')
  ctx.effect(
    () => ctx.systemPrompt.section({ name: PROMPT_SECTION, order: 900, text: PROMPT_TEXT, interpolate: false }),
    'astryx-studio: prompt section',
  )
}

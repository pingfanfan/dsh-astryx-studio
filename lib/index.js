import { defineTool } from "@deepseek-ai/dsh-tools";
// src/index.ts
const name = "dsh-astryx-studio";
const inject = ["tools", "systemPrompt"];
const PING_TOOL = "astryx_ping";
const PROMPT_SECTION = "astryx-studio";
/** Pure core of `astryx_ping`, exported for tests. */
function ping(message) {
	return {
		ok: true,
		plugin: name,
		echo: message ?? "pong"
	};
}
const pingTool = defineTool({
	name: PING_TOOL,
	description: "Health check for the Astryx Studio plugin. Returns ok and echoes the message. Placeholder until the real Astryx tools ship; do not call it for page work.",
	parameters: { message: {
		type: "string",
		description: "Optional text to echo back."
	} },
	output: {
		schema: {
			type: "object",
			properties: {
				ok: {
					type: "boolean",
					required: true
				},
				plugin: {
					type: "string",
					required: true
				},
				echo: {
					type: "string",
					required: true
				}
			},
			additionalProperties: false
		},
		render: (_args, value) => [{
			type: "text",
			text: `astryx-studio ok: ${value.echo}`
		}]
	},
	isConcurrencySafe: () => true,
	async execute(args) {
		return ping(args.message);
	}
});
/** Stable across turns so DeepSeek's prefix cache survives. Real content arrives on Day 3. */
const PROMPT_TEXT = "";
function apply(ctx) {
	ctx.effect(() => ctx.tools.register(pingTool), "astryx-studio: astryx_ping");
	ctx.effect(() => ctx.systemPrompt.section({
		name: PROMPT_SECTION,
		order: 900,
		text: "",
		interpolate: false
	}), "astryx-studio: prompt section");
}
export { PING_TOOL, PROMPT_SECTION, PROMPT_TEXT, apply, inject, name, ping, pingTool };

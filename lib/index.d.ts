/**
 * dsh-astryx-studio — Host half.
 *
 * Day 0 skeleton: one placeholder tool (`astryx_ping`) and one prompt section.
 * The five Astryx tools, the verify hook and the Vite preview land on Day 1/2.
 */
import { Context } from "@deepseek-ai/cordis";
export declare const name = "dsh-astryx-studio";
export declare const inject: string[];
export declare const PING_TOOL = "astryx_ping";
export declare const PROMPT_SECTION = "astryx-studio";
export interface PingResult {
  readonly ok: true;
  readonly plugin: string;
  readonly echo: string;
}
/** Pure core of `astryx_ping`, exported for tests. */
export declare function ping(message?: string): PingResult;
export declare const pingTool: import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Stable across turns so DeepSeek's prefix cache survives. Real content arrives on Day 3. */
export declare const PROMPT_TEXT = "";
export declare function apply(ctx: Context): void;
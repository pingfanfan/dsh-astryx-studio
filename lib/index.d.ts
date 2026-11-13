/**
 * dsh-astryx-studio — Host half.
 *
 * Five Astryx tools, the verify hook (esbuild + lint synchronously, tsc in the
 * background), a stable prompt section and the bundled `astryx-page` skill.
 * The Vite preview arrives on Day 2.
 */
import { UserMessage } from "@deepseek-ai/dsh-llm";
import Schema from "@deepseek-ai/schemastery";
import { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { Context } from "@deepseek-ai/cordis";
import { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
interface CliResponse {
  readonly type: string;
  readonly data: unknown;
}
interface AstryxApi {
  build(query: string, options: {
    cwd: string;
  }): Promise<CliResponse>;
  template(name: string, options: {
    cwd: string;
    targetPath: string;
    overwrite?: boolean;
    type?: 'page' | 'block';
  }): Promise<CliResponse>;
  component(name: string, options: {
    cwd: string;
    dense: true;
    zh: true;
  }): Promise<CliResponse>;
  search(query: string, options: {
    cwd: string;
    type?: SearchDomain;
    limit?: number;
  }): Promise<CliResponse>;
  /** `overwrite` is not accepted here: render replaces a file it rendered before, and rejects --overwrite outside --reverse. */
  render(file: string, options: {
    cwd: string;
    out?: string;
  }): Promise<CliResponse>;
}
type SearchDomain = 'component' | 'hook' | 'doc' | 'template' | 'theme';
declare function loadAstryxApi(): Promise<AstryxApi>;
/** The slice of a spawned process the server needs (adapted from SubprocessHandle). */
interface SpawnedProcess {
  onOutput(listener: (chunk: string) => void): void;
  readonly done: Promise<{
    exitCode: number | null;
    signal: string | null;
  }>;
  terminate(): void;
}
type Spawner = (argv: readonly string[], cwd: string) => SpawnedProcess;
export interface Config {
  /** Folder (relative to the session cwd) the built-in scaffold creates when cwd is not an Astryx project. */
  appDir: string;
  /** Package manager used for the scaffold install. `auto` picks pnpm when it is on PATH, else npm. */
  packageManager: 'auto' | 'pnpm' | 'npm';
  /** Timeout for scaffold installs and template installCommand runs. */
  installTimeoutMs: number;
  /** tsc --noEmit budget; a run past it reports "not verified", not "failed". */
  tscTimeoutMs: number;
  /** How long the agent's next step waits for a tsc run still in flight before going on without it. */
  tscStepWaitMs: number;
  /** Maximum tsc / lint findings quoted back to the model per injection. */
  maxReportedErrors: number;
  /** Preview toolbar prefs file; empty means $DSH_HOME/astryx-studio/prefs.json. */
  prefsFile: string;
  /** Chrome / Chromium / Edge binary for astryx_screenshot; empty means auto-detect the installed one. */
  chromePath: string;
}
export declare const Config: Schema<Config>;
interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly ms: number;
}
interface RunOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
  /** Run through `sh -c` (for CLI-provided command strings such as installCommand). */
  readonly shell?: boolean;
}
type Runner = (command: string, args: readonly string[], options: RunOptions) => Promise<RunResult>;
interface TscDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}
type TscOutcome = {
  readonly kind: 'pass';
  readonly ms: number;
} | {
  readonly kind: 'fail';
  readonly ms: number;
  readonly diagnostics: readonly TscDiagnostic[];
} | {
  readonly kind: 'unverified';
  readonly ms: number;
  readonly reason: string;
};
interface TscScheduler {
  /** Start a run for `workspace`, aborting any run in flight there. Resolves with its outcome, or undefined if superseded. */
  schedule(workspace: string): Promise<TscOutcome | undefined>;
  /** Take (and clear) the newest completed outcome for `workspace`. */
  take(workspace: string): TscOutcome | undefined;
  /** The run in flight for `workspace`, if any (resolves when it settles, whatever the outcome). */
  inflight(workspace: string): Promise<unknown> | undefined;
  /** Abort everything (plugin dispose). */
  dispose(): void;
}
interface ToolEnv {
  readonly api: () => Promise<AstryxApi>;
  /** Session cwd for a call, or undefined outside an agent. */
  readonly cwdOf: (exec: ToolRunContext) => Promise<string | undefined>;
  readonly config: Config;
  readonly run: Runner;
  readonly tsc: TscScheduler;
  /** astryx_template wrote a page: record it, ask the client to open the preview tab, start Vite. */
  readonly onTemplate?: (exec: ToolRunContext, workspace: string, page: string, installedPackages: boolean) => void;
  /** Screenshot the preview page (headless Chrome); absent where the Host cannot take one. */
  readonly screenshot?: (exec: ToolRunContext, args: ScreenshotArgs) => Promise<ScreenshotValue>;
}
interface ScreenshotArgs {
  readonly width: number;
  readonly fullPage: boolean;
  readonly page?: string;
  readonly theme?: string;
  readonly dark?: boolean;
}
interface ScreenshotValue {
  /** Absolute path of the PNG; pass it to read_image. */
  readonly path: string;
  /** Path relative to the workspace. */
  readonly file: string;
  readonly page: string;
  readonly width: number;
  readonly height: number;
  readonly truncated: boolean;
  readonly theme: string;
  readonly dark: boolean;
  readonly pageState: 'ready' | 'error' | 'timeout';
  readonly consoleErrors: readonly string[];
}
export declare const name = "dsh-astryx-studio";
export declare const inject: string[];
export declare const MESSAGE_SOURCE = "astryx-studio";
/** DSH's shell tool (`bash -c`); its `command` argument is checked for package installs. */
export declare const SHELL_TOOL = "bash";
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Verify findings injected by the astryx-studio plugin. */
    'astryx-studio': {
      kind: 'astryx-studio';
    };
  }
}
export declare function verifyMessage(body: string): UserMessage;
/** Test seam: replace process spawning and the CLI. */
export interface Overrides {
  run?: Runner;
  api?: typeof loadAstryxApi;
  /** Replaces ctx.subprocess for the preview Vite. */
  spawner?: Spawner;
  /** Replaces the headless-Chrome screenshot; `null` leaves astryx_screenshot unregistered. */
  screenshot?: ToolEnv['screenshot'] | null;
}
/** Adapt DSH's `ctx.subprocess` to the preview server's spawner. */
export declare function subprocessSpawner(subprocess: SubprocessRuntime): Spawner;
export declare function apply(ctx: Context, config?: Partial<Config>, overrides?: Overrides): void;
export {};
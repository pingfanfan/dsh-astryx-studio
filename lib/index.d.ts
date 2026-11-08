/**
 * dsh-astryx-studio — Host half.
 *
 * Five Astryx tools, the verify hook (esbuild + lint synchronously, tsc in the
 * background), a stable prompt section and the bundled `astryx-page` skill.
 * The Vite preview arrives on Day 2.
 */
import { UserMessage } from "@deepseek-ai/dsh-llm";
import Schema from "@deepseek-ai/schemastery";
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
export declare const name = "dsh-astryx-studio";
export declare const inject: string[];
export declare const MESSAGE_SOURCE = "astryx-studio";
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
}
/** Adapt DSH's `ctx.subprocess` to the preview server's spawner. */
export declare function subprocessSpawner(subprocess: SubprocessRuntime): Spawner;
export declare function apply(ctx: Context, config?: Partial<Config>, overrides?: Overrides): void;
export {};
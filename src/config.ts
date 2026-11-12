import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Folder (relative to the session cwd) the built-in scaffold creates when cwd is not an Astryx project. */
  appDir: string
  /** Package manager used for the scaffold install. `auto` picks pnpm when it is on PATH, else npm. */
  packageManager: 'auto' | 'pnpm' | 'npm'
  /** Timeout for scaffold installs and template installCommand runs. */
  installTimeoutMs: number
  /** tsc --noEmit budget; a run past it reports "not verified", not "failed". */
  tscTimeoutMs: number
  /** How long the agent's next step waits for a tsc run still in flight before going on without it. */
  tscStepWaitMs: number
  /** Maximum tsc / lint findings quoted back to the model per injection. */
  maxReportedErrors: number
  /** Preview toolbar prefs file; empty means $DSH_HOME/astryx-studio/prefs.json. */
  prefsFile: string
  /** Chrome / Chromium / Edge binary for astryx_screenshot; empty means auto-detect the installed one. */
  chromePath: string
}

export const Config: Schema<Config> = Schema.object({
  appDir: Schema.string().default('astryx-app').description('Scaffold folder name under the session cwd.'),
  packageManager: Schema.union(['auto', 'pnpm', 'npm'] as const).default('auto').description('Package manager for scaffold installs.'),
  installTimeoutMs: Schema.natural().default(300_000).description('Install timeout (ms).'),
  tscTimeoutMs: Schema.natural().default(30_000).description('tsc --noEmit timeout (ms).'),
  tscStepWaitMs: Schema.natural().default(5_000).description('Max wait (ms) at the next agent step for an in-flight tsc run.'),
  maxReportedErrors: Schema.natural().default(5).description('Max findings quoted per verify message.'),
  prefsFile: Schema.string().default('').description('Preview toolbar prefs file (default: $DSH_HOME/astryx-studio/prefs.json).'),
  chromePath: Schema.string().default('').description('Chrome/Chromium/Edge binary for astryx_screenshot (default: auto-detect).'),
}) as Schema<Config>

export const DEFAULT_CONFIG: Config = {
  appDir: 'astryx-app',
  packageManager: 'auto',
  installTimeoutMs: 300_000,
  tscTimeoutMs: 30_000,
  tscStepWaitMs: 5_000,
  maxReportedErrors: 5,
  prefsFile: '',
  chromePath: '',
}

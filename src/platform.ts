/**
 * Launching processes on Windows, where `pnpm`, `npm` and everything in
 * `node_modules/.bin` are `.cmd` shims that Node cannot spawn without a shell
 * (spawn rejects .cmd/.bat with EINVAL since the 2024 security fix).
 *
 * - Package managers go through `cmd.exe /d /s /c` with every argument quoted
 *   and cmd metacharacters escaped (the approach of the `cross-spawn` package).
 * - Package binaries (vite, tsc) run their JavaScript entry with `node`, so no
 *   shim and no shell is involved.
 *
 * Everything here is a no-op on macOS and Linux. NOT YET RUN ON WINDOWS: the
 * command lines are unit-tested only.
 *
 * A timeout or abort on Windows kills the whole process tree with
 * `taskkill /T /F` (see treeKill), since killing cmd.exe alone would leave the
 * pnpm / npm under it running.
 */
import { join } from 'node:path'

export interface Launch {
  readonly command: string
  readonly args: string[]
  /** Pass the already-quoted command line to cmd.exe as is. */
  readonly windowsVerbatimArguments?: boolean
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/** Quote one argument for the Windows C runtime, then escape it for cmd.exe. */
export function quoteWindowsArg(arg: string): string {
  // Backslashes before a quote (and at the end) are doubled; quotes are escaped.
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
  return quoted.replace(CMD_META, '^$1')
}

/**
 * How to launch `command args` on `platform`. On Windows a bare command name
 * (pnpm, npm) is run through cmd.exe so its .cmd shim resolves; paths and
 * `.exe` files are spawned directly.
 */
export function launch(command: string, args: readonly string[], platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Launch {
  // node is node.exe: spawned directly, so a kill reaches it rather than a cmd.exe in between.
  const bare = !/[\\/]/.test(command) && !/\.(exe|com)$/i.test(command) && command !== 'node'
  if (platform !== 'win32' || !bare) return { command, args: [...args] }
  const line = [command.replace(CMD_META, '^$1'), ...args.map(quoteWindowsArg)].join(' ')
  return { command: env['ComSpec'] ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true }
}

/**
 * How to stop process `pid` and everything it started, where a plain kill would miss children:
 * on Windows `taskkill /T /F` (kill only reaches cmd.exe, not the pnpm under it). Undefined
 * elsewhere: SIGTERM / SIGKILL on the child is enough there.
 */
export function treeKill(pid: number, platform: NodeJS.Platform = process.platform): Launch | undefined {
  if (platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return undefined
  return { command: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] }
}

/**
 * argv that runs a package binary of the workspace: `node_modules/.bin/<bin>` on
 * macOS and Linux, `node <its JavaScript entry>` on Windows.
 */
export function packageBin(workspace: string, bin: 'vite' | 'tsc', platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== 'win32') return [join(workspace, 'node_modules', '.bin', bin)]
  const entry = bin === 'vite' ? join(workspace, 'node_modules', 'vite', 'bin', 'vite.js') : join(workspace, 'node_modules', 'typescript', 'bin', 'tsc')
  return ['node', entry]
}

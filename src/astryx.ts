/**
 * The slice of `@astryxdesign/cli/api` the plugin uses, behind an interface so
 * tools can be unit-tested with a fake. The real module is imported lazily:
 * the CLI pulls in recast/postcss/jiti, which the host should not pay for at
 * boot.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliResponse {
  readonly type: string
  readonly data: unknown
}

export interface AstryxApi {
  build(query: string, options: { cwd: string }): Promise<CliResponse>
  template(
    name: string,
    options: { cwd: string; targetPath: string; overwrite?: boolean; type?: 'page' | 'block' },
  ): Promise<CliResponse>
  component(name: string, options: { cwd: string; dense: true; zh: true }): Promise<CliResponse>
  search(
    query: string,
    options: { cwd: string; type?: SearchDomain; limit?: number },
  ): Promise<CliResponse>
  /** `overwrite` is not accepted here: render replaces a file it rendered before, and rejects --overwrite outside --reverse. */
  render(file: string, options: { cwd: string; out?: string }): Promise<CliResponse>
}

export type SearchDomain = 'component' | 'hook' | 'doc' | 'template' | 'theme'
export const SEARCH_DOMAINS: readonly SearchDomain[] = ['component', 'hook', 'doc', 'template', 'theme']

/** The plugin package root. It depends on @astryxdesign/core, so it is a valid cwd for read-only CLI calls outside any workspace. */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let cached: Promise<AstryxApi> | undefined

export function loadAstryxApi(): Promise<AstryxApi> {
  cached ??= (async () => {
    const api = await import('@astryxdesign/cli/api')
    const experimental = await import('@astryxdesign/cli/api/experimental')
    return {
      build: (q, o) => api.build(q, o) as Promise<CliResponse>,
      template: (n, o) => api.template(n, o),
      component: (n, o) => api.component(n, o) as Promise<CliResponse>,
      search: (q, o) => api.search(q, o) as Promise<CliResponse>,
      render: (f, o) => experimental.render(f, o) as Promise<CliResponse>,
    }
  })()
  return cached
}

/** Message and code of an AstryxError (or any error), for tool failures the model can act on. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

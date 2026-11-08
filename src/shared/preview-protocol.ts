/**
 * Contract shared by the Host half, the client tab and the preview page
 * (`.astryx-studio/main.tsx`). Plain data only: this file is bundled into all
 * three.
 */

/**
 * The client reaches the Host over DSH's shared `/api` channel: the Host
 * registers exact Fetch routes `/api/astryx-studio/<endpoint>` (owner peer
 * only). A dedicated channel via `rpc.handle` needs the caller's own
 * `ctx.webServer`, which a third-party plugin cannot see in the web profile.
 */
export const RPC_CHANNEL = '/api'
export const RPC_PREFIX = 'astryx-studio'
export const RPC_ENDPOINTS = ['status', 'openPreview', 'reportRuntimeError', 'exportHtml', 'gallery', 'startTemplate', 'getPrefs', 'setPrefs'] as const

export const THEMES = ['neutral', 'stone', 'matcha', 'y2k', 'gothic', 'chocolate', 'butter'] as const
export type ThemeName = (typeof THEMES)[number]

export const WIDTHS = { desktop: null, tablet: 768, mobile: 390 } as const
export type WidthName = keyof typeof WIDTHS

/** Messages the preview page posts to its parent window. */
export const PREVIEW_MESSAGE_SOURCE = 'astryx-studio-preview'
export type PreviewMessage =
  | { source: typeof PREVIEW_MESSAGE_SOURCE; type: 'ready'; page: string }
  | { source: typeof PREVIEW_MESSAGE_SOURCE; type: 'updated' }
  | { source: typeof PREVIEW_MESSAGE_SOURCE; type: 'error'; kind: 'render' | 'window' | 'promise' | 'vite'; message: string; stack?: string }

/** Messages the tab posts into the preview page (no reload, no recompile). */
export const PREVIEW_COMMAND_SOURCE = 'astryx-studio-tab'
export type PreviewCommand = { source: typeof PREVIEW_COMMAND_SOURCE; type: 'set'; theme: ThemeName; dark: boolean }

export type PreviewState = 'idle' | 'starting' | 'running' | 'error' | 'unavailable'

export interface PreviewStatus {
  readonly state: PreviewState
  /** http://127.0.0.1:<port>/ while running. */
  readonly url?: string
  readonly error?: string
  readonly log: readonly string[]
}

export type VerifyState = 'none' | 'running' | 'pass' | 'fail' | 'unverified'

export interface VerifyStatus {
  readonly state: VerifyState
  readonly summary: string
  readonly at: number
}

export interface SessionStatus {
  readonly workspace?: string
  /** Page module the preview shows, relative to the workspace (e.g. src/pages/main/page.tsx). */
  readonly page?: string
  readonly preview: PreviewStatus
  readonly verify: VerifyStatus
  /** Incremented each time the Host asks the client to open the preview tab. */
  readonly openSeq: number
}

export type RpcRequest =
  | { endpoint: 'status'; payload: { sessionId: string } }
  | { endpoint: 'openPreview'; payload: { sessionId: string } }
  | { endpoint: 'reportRuntimeError'; payload: { sessionId: string; kind: string; message: string; stack?: string } }
  | { endpoint: 'exportHtml'; payload: { sessionId: string } }

export function previewQuery(page: string, theme: ThemeName, dark: boolean): string {
  const q = new URLSearchParams({ page, theme, dark: dark ? '1' : '0' })
  return `?${q.toString()}`
}

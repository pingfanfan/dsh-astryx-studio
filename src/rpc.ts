/**
 * `/astryx-studio` RPC channel: the client tab's only way to reach the Host.
 * Endpoints: status, openPreview, installPreview, reportRuntimeError, exportHtml, gallery, startTemplate, getPrefs, setPrefs.
 */
import type { ConnectionFetchRoute, ConnectionRpcHandler, ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection'
import { galleryItems, isTemplateId, readPrefs, sanitizePrefs, startTemplateText, writePrefs } from './gallery.js'
import type { PreviewManager } from './preview/manager.js'
import { RPC_ENDPOINTS, RPC_PREFIX } from './shared/preview-protocol.js'

export interface RpcDeps {
  readonly manager: PreviewManager
  /** Export the session's page to HTML; returns the written file (workspace-relative). */
  readonly exportHtml: (workspace: string, page: string) => Promise<string>
  /** Queue a user message as a follow-up turn of the session's live agent; false when there is none. */
  readonly followup?: (sessionId: string, text: string) => boolean
  /** Where the preview toolbar prefs are kept on disk. */
  readonly prefsFile?: string
  /** Thumbnail directory (tests). */
  readonly thumbDir?: string
}

const ok = (value: unknown): ConnectionRpcHandlerResult => ({ ok: true, value })
const fail = (code: string, message: string): ConnectionRpcHandlerResult => ({ ok: false, error: { code, message, details: {} } })

function sessionIdOf(payload: unknown): string | undefined {
  const id = (payload as { sessionId?: unknown } | null)?.sessionId
  return typeof id === 'string' && id.length > 0 && id.length < 200 ? id : undefined
}

export function createRpcHandler(deps: RpcDeps): ConnectionRpcHandler {
  return async (endpoint, payload) => {
    const sessionId = sessionIdOf(payload)
    if (!sessionId) return fail('BAD_REQUEST', 'payload.sessionId (string) is required')
    switch (endpoint) {
      case 'status':
        return ok(deps.manager.status(sessionId))
      case 'openPreview':
        return ok(await deps.manager.open(sessionId))
      case 'installPreview':
        // Only from the tab's button: the user approves adding the preview packages to a project
        // the plugin did not create.
        return ok(await deps.manager.approveInstall(sessionId))
      case 'reportRuntimeError': {
        const p = payload as { kind?: unknown; message?: unknown; stack?: unknown }
        if (typeof p.message !== 'string' || !p.message) return fail('BAD_REQUEST', 'payload.message is required')
        const queued = deps.manager.reportRuntimeError(sessionId, {
          kind: typeof p.kind === 'string' ? p.kind.slice(0, 20) : 'window',
          message: p.message.slice(0, 2000),
          ...(typeof p.stack === 'string' ? { stack: p.stack.slice(0, 4000) } : {}),
        })
        return ok({ queued })
      }
      case 'exportHtml': {
        const s = deps.manager.status(sessionId)
        if (!s.workspace || !s.page) return fail('NO_PAGE', 'no Astryx page in this session yet')
        try {
          return ok({ file: await deps.exportHtml(s.workspace, s.page) })
        } catch (error) {
          return fail('EXPORT_FAILED', error instanceof Error ? error.message : String(error))
        }
      }
      case 'gallery':
        return ok({ items: galleryItems(deps.thumbDir) })
      case 'startTemplate': {
        const id = (payload as { id?: unknown }).id
        if (!isTemplateId(id)) return fail('BAD_REQUEST', 'payload.id must be a known template id')
        if (!deps.followup) return fail('UNAVAILABLE', 'agents are not available in this profile')
        // Not a shortcut around the model: it is an ordinary user turn the model answers.
        return deps.followup(sessionId, startTemplateText(id)) ? ok({ sent: true }) : fail('NO_AGENT', 'this session has no live agent; send a message in it first')
      }
      case 'getPrefs':
        return ok({ prefs: deps.prefsFile ? (readPrefs(deps.prefsFile) ?? null) : null })
      case 'setPrefs': {
        const prefs = sanitizePrefs((payload as { prefs?: unknown }).prefs)
        if (!prefs) return fail('BAD_REQUEST', 'payload.prefs is not a valid {theme, dark, width}')
        if (deps.prefsFile) writePrefs(deps.prefsFile, prefs)
        return ok({ saved: !!deps.prefsFile })
      }
      default:
        return fail('UNKNOWN_ENDPOINT', `unknown endpoint ${endpoint}`)
    }
  }
}

/**
 * Expose the handler as exact Fetch routes on the shared `/api` channel, speaking
 * the Connection RPC wire format ({type:'client-request', rpcId, method, payload}
 * in, {type:'server-response', rpcId, result} out), so the client can use the
 * ordinary `connection.rpc.call('/api', 'astryx-studio/<endpoint>', payload)`.
 */
export function fetchRoutes(handler: ConnectionRpcHandler): ConnectionFetchRoute[] {
  return RPC_ENDPOINTS.map((endpoint) => ({
    path: `/api/${RPC_PREFIX}/${endpoint}`,
    methods: ['POST'] as const,
    requestBody: 'buffered' as const,
    fetch: async (request: Request) => {
      let body: { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown }
      try {
        body = (await request.json()) as typeof body
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      const rpcId = typeof body.rpcId === 'string' ? body.rpcId : 'invalid-request'
      const respond = (result: ConnectionRpcHandlerResult) => Response.json({ type: 'server-response', rpcId, result })
      if (body.type !== 'client-request' || body.method !== `${RPC_PREFIX}/${endpoint}`) {
        return respond({ ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} } })
      }
      try {
        return respond(await handler(endpoint, body.payload, request.signal, undefined as never))
      } catch (error) {
        return respond({ ok: false, error: { code: 'HANDLER_FAILED', message: String(error), details: {} } })
      }
    },
  }))
}

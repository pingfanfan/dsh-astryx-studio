/**
 * dsh-astryx-studio — Client half (web).
 *
 * Registers the `astryx-preview` tab type and its body, and watches the
 * foreground session for "open the preview" requests from astryx_template
 * (the Host cannot push to the client; the client polls a cheap status RPC).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionStatus } from '../src/shared/preview-protocol.js'
import { PreviewBody, rpcCaller, type PreviewFace } from './preview-tab.js'
import { createOpenLedger, createPrefsStore, type KeyValueStorage } from './store.js'

export const name = 'dsh-astryx-studio/client'
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'connection']

export const PREVIEW_TAB_ID = 'dsh-astryx-studio/preview'
export const PREVIEW_TAB_KIND = 'astryx-preview'
const TITLE = 'Astryx 预览'
const WATCH_MS = 2000

interface ClientRpc {
  call(channel: string, endpoint: string, payload: unknown): Promise<unknown>
}
interface SidebarRightLike {
  readonly mounted: { getSnapshot(): string | undefined; subscribe(l: () => void): () => void }
  openTabIn(sessionId: string, kind: string): void
  openResourceIn(sessionId: string, address: string): void
}

function storage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** dsh-web-review registers a conversation input dock entry `webview-annotations`. */
function webReviewInstalled(slots: Context['slots']): boolean {
  try {
    return slots.entriesOfSlot('conversation.input.dock').some((e) => JSON.stringify(e).includes('webview-annotations'))
  } catch {
    return false
  }
}

export function apply(ctx: Context) {
  const rpc = (ctx as unknown as { connection: { rpc: ClientRpc } }).connection.rpc
  const call = rpcCaller(rpc)
  const sidebar = (ctx as unknown as { sidebarRight: SidebarRightLike }).sidebarRight
  const prefs = createPrefsStore(storage())
  const ledger = createOpenLedger(storage())

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: PREVIEW_TAB_ID,
        kind: PREVIEW_TAB_KIND,
        title: () => TITLE,
        keepMounted: true,
        guide: [{ id: 'preview', order: 60, title: () => TITLE, description: () => '正在构建的 Astryx 页面' }],
      }),
    'astryx-studio: preview tab type',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: PREVIEW_TAB_ID,
            inject: (sessionId: string) => {
              const face: PreviewFace = {
                sessionId,
                call,
                prefs,
                hasWebReview: () => webReviewInstalled(ctx.slots),
                openInSidebar: (url) => sidebar.openResourceIn(sessionId, url),
              }
              return { astryx: face }
            },
          } as never,
          PreviewBody as never,
        ),
      ),
    'astryx-studio: preview tab body',
  )

  // astryx_template asks for the tab by bumping openSeq; open it in the foreground session.
  ctx.effect(() => {
    let stopped = false
    const check = async () => {
      const sessionId = sidebar.mounted.getSnapshot()
      if (!sessionId || stopped) return
      const r = (await call('status', { sessionId }).catch(() => undefined)) as
        | { ok: true; value: SessionStatus }
        | { ok: false }
        | undefined
      if (!r?.ok || stopped) return
      if (ledger.shouldOpen(sessionId, r.value.openSeq)) sidebar.openTabIn(sessionId, PREVIEW_TAB_KIND)
    }
    const timer = setInterval(() => void check(), WATCH_MS)
    const unsubscribe = sidebar.mounted.subscribe(() => void check())
    return () => {
      stopped = true
      clearInterval(timer)
      unsubscribe()
    }
  }, 'astryx-studio: open-preview watcher')
}

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
import { GalleryBody, type GalleryFace } from './gallery-tab.js'
import { PreviewBody, rpcCaller, type PreviewFace } from './preview-tab.js'
import type { PreviewPrefs } from './store.js'
import { createOpenLedger, createPrefsStore, type KeyValueStorage } from './store.js'

export const name = 'dsh-astryx-studio/client'
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'connection']

export const PREVIEW_TAB_ID = 'dsh-astryx-studio/preview'
export const PREVIEW_TAB_KIND = 'astryx-preview'
export const GALLERY_TAB_ID = 'dsh-astryx-studio/gallery'
export const GALLERY_TAB_KIND = 'astryx-gallery'
const TITLE = 'Astryx 预览'
const GALLERY_TITLE = 'Astryx 模板画廊'
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

  // Toolbar prefs also live on the Host (a file under $DSH_HOME): localStorage is per
  // origin, and DSH web on a new port is a new origin. Host value wins at start-up.
  let applyingRemote = false
  void call('getPrefs', { sessionId: 'prefs' }).then((r) => {
    const remote = r.ok ? (r.value as { prefs: PreviewPrefs | null }).prefs : null
    if (!remote) return
    applyingRemote = true
    prefs.set(remote)
    applyingRemote = false
  }, () => undefined)
  ctx.effect(
    () =>
      prefs.subscribe(() => {
        if (!applyingRemote) void call('setPrefs', { sessionId: 'prefs', prefs: prefs.get() }).catch(() => undefined)
      }),
    'astryx-studio: prefs sync',
  )

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
      ctx.sidebarRightTabs.register({
        id: GALLERY_TAB_ID,
        kind: GALLERY_TAB_KIND,
        title: () => GALLERY_TITLE,
        guide: [{ id: 'gallery', order: 61, title: () => GALLERY_TITLE, description: () => '57 个页面模板，点一下让模型从它开始' }],
      }),
    'astryx-studio: gallery tab type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: GALLERY_TAB_ID,
            inject: (sessionId: string) => ({ astryx: { sessionId, call } satisfies GalleryFace }),
          } as never,
          GalleryBody as never,
        ),
      ),
    'astryx-studio: gallery tab body',
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
                openGallery: () => sidebar.openTabIn(sessionId, GALLERY_TAB_KIND),
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

/**
 * The `astryx-preview` tab body: an iframe pointed straight at the preview
 * Vite (http://127.0.0.1:<port>/), a toolbar (theme / dark / width / open /
 * export / web-review) and a footer (Vite status, verify status).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import {
  HMR_WATCHDOG_MS,
  PREVIEW_COMMAND_SOURCE,
  PREVIEW_MESSAGE_SOURCE,
  RPC_CHANNEL,
  RPC_PREFIX,
  THEMES,
  WIDTHS,
  previewQuery,
  type PreviewCommand,
  type PreviewMessage,
  type SessionStatus,
  type WidthName,
} from '../src/shared/preview-protocol.js'
import type { PrefsStore } from './store.js'

/** Same sandbox the official ui-sidebar-browser gives its iframes. */
export const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox'

export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
export type RpcCall = (endpoint: string, payload: unknown) => Promise<RpcResult>

export interface PreviewFace {
  readonly sessionId: string
  readonly call: RpcCall
  readonly prefs: PrefsStore
  /** Whether dsh-web-review is installed (checked when the tab renders). */
  readonly hasWebReview: () => boolean
  /** Open a URL in the right Sidebar (web-review's preview when installed). */
  readonly openInSidebar: (url: string) => void
  /** Open the template gallery tab in this session. */
  readonly openGallery?: () => void
}

const POLL_MS = 1500
/** An HMR signal this long before the tab noticed a write still counts for it (the poll lags the write). */
const HMR_SIGNAL_SLACK_MS = POLL_MS * 2

export function iframeUrl(status: SessionStatus | undefined, theme: string, dark: boolean): string | undefined {
  if (!status?.preview.url || !status.page) return undefined
  return status.preview.url + previewQuery(status.page, theme as never, dark)
}

/** Slot props: the slot framework's own props plus our face under one key, so nothing collides. */
export function PreviewBody({ astryx }: { astryx: PreviewFace }) {
  return <PreviewView {...astryx} />
}

export function PreviewView(props: PreviewFace) {
  const { sessionId, call, prefs } = props
  const p = useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get)
  const [status, setStatus] = useState<SessionStatus | undefined>()
  const [rpcError, setRpcError] = useState<string | undefined>()
  const [runtimeError, setRuntimeError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const frame = useRef<HTMLIFrameElement>(null)

  // Ask the Host to start Vite once, then poll the status while the tab is mounted.
  useEffect(() => {
    let alive = true
    const apply = (r: RpcResult) => {
      if (!alive) return
      if (r.ok) {
        setStatus(r.value as SessionStatus)
        setRpcError(undefined)
      } else setRpcError(r.error.message)
    }
    void call('openPreview', { sessionId }).then(apply, (e) => alive && setRpcError(String(e)))
    const timer = setInterval(() => void call('status', { sessionId }).then(apply, () => undefined), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [call, sessionId])

  // The iframe URL is fixed per (server, page); theme and dark mode go in by message.
  const [src, setSrc] = useState<string | undefined>()
  const base = status?.preview.url && status.page ? status.preview.url + '|' + status.page : undefined
  useEffect(() => {
    setSrc(iframeUrl(status, prefs.get().theme, prefs.get().dark))
    setRuntimeError(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  // HMR watchdog: a model write must reach the iframe as an HMR update (or a fresh load).
  // If none arrives, the iframe is on a stale module graph (e.g. after Vite re-optimized
  // dependencies mid-load), so reload it rather than show an old page.
  const [reloadKey, setReloadKey] = useState(0)
  const lastSignal = useRef(0)
  // The first status is the baseline (a write from before the tab opened is not watched); any
  // later change is a new write, including the first write ever (undefined -> a time).
  const seenWrite = useRef<{ at: number | undefined } | undefined>(undefined)
  const hasStatus = status !== undefined
  const lastWriteAt = status?.lastWriteAt
  useEffect(() => {
    if (!hasStatus) return
    const baseline = seenWrite.current === undefined
    if (!baseline && seenWrite.current!.at === lastWriteAt) return
    seenWrite.current = { at: lastWriteAt }
    if (baseline || lastWriteAt === undefined) return
    const noticedAt = Date.now()
    const timer = setTimeout(() => {
      if (lastSignal.current < noticedAt - HMR_SIGNAL_SLACK_MS) setReloadKey((k) => k + 1)
    }, HMR_WATCHDOG_MS)
    return () => clearTimeout(timer)
  }, [hasStatus, lastWriteAt])

  const sendPrefs = useCallback(() => {
    const cmd: PreviewCommand = { source: PREVIEW_COMMAND_SOURCE, type: 'set', theme: prefs.get().theme, dark: prefs.get().dark }
    frame.current?.contentWindow?.postMessage(cmd, '*')
  }, [prefs])
  useEffect(sendPrefs, [p.theme, p.dark, sendPrefs])

  // Messages from the preview page: ready → push prefs; error → show it and report it to the Host.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const d = event.data as PreviewMessage | undefined
      if (!d || d.source !== PREVIEW_MESSAGE_SOURCE) return
      if (d.type === 'ready') {
        lastSignal.current = Date.now()
        setRuntimeError(undefined)
        sendPrefs()
        return
      }
      if (d.type === 'updated') {
        lastSignal.current = Date.now()
        setRuntimeError(undefined)
        return
      }
      lastSignal.current = Date.now()
      setRuntimeError(`${d.kind}: ${d.message}`)
      void call('reportRuntimeError', { sessionId, kind: d.kind, message: d.message, ...(d.stack ? { stack: d.stack } : {}) })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [call, sessionId, sendPrefs])

  const fullUrl = status?.preview.url && status.page ? status.preview.url + previewQuery(status.page, p.theme, p.dark) : undefined
  const exportHtml = async () => {
    setNotice('导出中…')
    const r = await call('exportHtml', { sessionId })
    setNotice(r.ok ? `已导出 ${(r.value as { file: string }).file}` : `导出失败：${r.error.message}`)
  }
  const width = WIDTHS[p.width]

  return (
    <div style={S.root} data-testid="astryx-preview">
      <div style={S.toolbar}>
        <select aria-label="主题" style={S.select} value={p.theme} onChange={(e) => prefs.set({ theme: e.target.value as never })}>
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="button" style={btn(p.dark)} aria-pressed={p.dark} onClick={() => prefs.set({ dark: !p.dark })}>
          {p.dark ? '暗色' : '亮色'}
        </button>
        <div role="group" aria-label="宽度" style={S.group}>
          {(Object.keys(WIDTHS) as WidthName[]).map((w) => (
            <button key={w} type="button" style={btn(p.width === w)} aria-pressed={p.width === w} onClick={() => prefs.set({ width: w })}>
              {w === 'desktop' ? '桌面' : w === 'tablet' ? '平板' : '390'}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {props.openGallery ? (
          <button type="button" style={btn(false)} onClick={props.openGallery}>
            模板画廊
          </button>
        ) : null}
        <button type="button" style={btn(false)} disabled={!fullUrl} onClick={() => fullUrl && window.open(fullUrl, '_blank', 'noopener')}>
          浏览器打开
        </button>
        <button type="button" style={btn(false)} disabled={!status?.page} onClick={() => void exportHtml()}>
          导出 HTML
        </button>
        {props.hasWebReview() && fullUrl ? (
          <button type="button" style={btn(false)} onClick={() => props.openInSidebar(fullUrl)}>
            在 web-review 打开
          </button>
        ) : null}
      </div>
      {runtimeError ? <div style={S.errorBar}>预览运行时错误：{runtimeError}</div> : null}
      {notice ? (
        <div style={S.notice} onClick={() => setNotice(undefined)}>
          {notice}
        </div>
      ) : null}
      <div style={S.stage}>
        {src ? (
          <iframe
            key={reloadKey}
            ref={frame}
            title="Astryx 预览"
            src={src}
            sandbox={PREVIEW_SANDBOX}
            onLoad={sendPrefs}
            style={{ ...S.frame, width: width === null ? '100%' : `${width}px` }}
          />
        ) : (
          <div style={S.empty}>{emptyText(status, rpcError)}</div>
        )}
      </div>
      <div style={S.footer}>
        <span>Vite：{viteText(status)}</span>
        <span title={status?.verify.summary}>{verifyText(status)}</span>
      </div>
    </div>
  )
}

export function emptyText(status: SessionStatus | undefined, rpcError: string | undefined): string {
  if (rpcError) return `无法连接插件：${rpcError}`
  if (!status) return '正在连接…'
  if (!status.page) return '还没有页面。让模型用 astryx_template 创建一个页面后，这里会自动显示预览。'
  if (status.preview.state === 'error') return `预览启动失败：${status.preview.error ?? ''}\n${status.preview.log.slice(-8).join('\n')}`
  if (status.preview.state === 'unavailable') return `当前 profile 无法启动预览：${status.preview.error ?? ''}`
  return '正在启动预览（Vite）…'
}

export function viteText(status: SessionStatus | undefined): string {
  switch (status?.preview.state) {
    case 'running':
      return `运行中 ${status.preview.url ?? ''}`
    case 'starting':
      return '启动中'
    case 'error':
      return '出错'
    case 'unavailable':
      return '不可用'
    default:
      return '未启动'
  }
}

export function verifyText(status: SessionStatus | undefined): string {
  const v = status?.verify
  switch (v?.state) {
    case 'pass':
      return `verify ✓ ${v.summary.replace(/^astryx verify ✓\s*/, '')}`
    case 'fail':
      return `verify ✗ ${v.summary.replace(/^astryx verify ✗\s*/, '').slice(0, 120)}`
    case 'running':
      return 'verify …'
    case 'unverified':
      return 'verify ?（未完成）'
    default:
      return 'verify —'
  }
}

/** The RPC caller for one session, over the client connection. */
export function rpcCaller(rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }): RpcCall {
  return (endpoint, payload) => rpc.call(RPC_CHANNEL, `${RPC_PREFIX}/${endpoint}`, payload) as Promise<RpcResult>
}

const btn = (on: boolean): CSSProperties => ({
  height: 26,
  padding: '0 8px',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 6,
  border: '0.5px solid var(--dsw-alias-border-l2, #ccc)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: on ? 'var(--dsw-alias-interactive-bg-hover, #e8e8e8)' : 'var(--dsw-alias-bg-layer-1, transparent)',
})

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 12, color: 'var(--dsw-alias-label-primary, inherit)', background: 'var(--dsw-alias-bg-base, transparent)' },
  toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, padding: '5px 6px', borderBottom: '0.5px solid var(--dsw-alias-border-l3, #ddd)' },
  group: { display: 'inline-flex', gap: 2 },
  select: { height: 26, fontSize: 12, borderRadius: 6 },
  stage: { flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2, #f4f4f4)' },
  frame: { border: 0, height: '100%', maxWidth: '100%', background: 'transparent', transition: 'width 120ms ease' },
  empty: { margin: 'auto', padding: 24, whiteSpace: 'pre-wrap', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary, #888)', maxWidth: 420 },
  errorBar: { padding: '6px 10px', color: 'var(--dsw-alias-state-error-primary, #b42318)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #b42318) 8%, transparent)', whiteSpace: 'pre-wrap' },
  notice: { padding: '4px 10px', color: 'var(--dsw-alias-label-secondary, #555)', cursor: 'pointer' },
  footer: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 10px', borderTop: '0.5px solid var(--dsw-alias-border-l3, #ddd)', color: 'var(--dsw-alias-label-tertiary, #888)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
}

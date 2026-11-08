/**
 * The `astryx-gallery` tab: every page template as a thumbnail card, with a
 * category filter and a search box. Clicking a card asks the Host to queue
 * 「用 `<id>` 模板开始」 as an ordinary user turn: the model still answers it.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { RpcCall } from './preview-tab.js'

export interface GalleryItem {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly description: string
  readonly thumb?: string
}

export interface GalleryFace {
  readonly sessionId: string
  readonly call: RpcCall
}

export const ALL = '全部'

/** Category list in first-seen order, prefixed with 全部. */
export function categoriesOf(items: readonly GalleryItem[]): string[] {
  return [ALL, ...new Set(items.map((i) => i.category))]
}

/** Category + free-text filter over id, name, description and category (case-insensitive, all words must match). */
export function filterGallery(items: readonly GalleryItem[], category: string, query: string): GalleryItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((i) => {
    if (category !== ALL && i.category !== category) return false
    const hay = `${i.id} ${i.name} ${i.description} ${i.category}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export function GalleryBody({ astryx }: { astryx: GalleryFace }) {
  return <GalleryView {...astryx} />
}

export function GalleryView({ sessionId, call }: GalleryFace) {
  const [items, setItems] = useState<GalleryItem[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [category, setCategory] = useState(ALL)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | undefined>()
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let alive = true
    void call('gallery', { sessionId }).then(
      (r) => alive && (r.ok ? setItems((r.value as { items: GalleryItem[] }).items) : setError(r.error.message)),
      (e) => alive && setError(String(e)),
    )
    return () => {
      alive = false
    }
  }, [call, sessionId])

  const shown = useMemo(() => filterGallery(items ?? [], category, query), [items, category, query])
  const start = async (item: GalleryItem) => {
    setNotice(`正在发送「用 ${item.id} 模板开始」…`)
    const r = await call('startTemplate', { sessionId, id: item.id })
    setNotice(r.ok ? `已发送「用 ${item.id} 模板开始」，模型会接着处理。` : `发送失败：${r.error.message}`)
  }

  if (error) return <div style={S.empty}>无法加载模板：{error}</div>
  if (!items) return <div style={S.empty}>正在加载模板…</div>
  return (
    <div style={S.root} data-testid="astryx-gallery">
      <div style={S.toolbar}>
        <input
          type="search"
          placeholder="搜索模板（英文，如 dashboard / login / table）"
          aria-label="搜索模板"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={S.search}
        />
        <div role="tablist" aria-label="分类" style={S.chips}>
          {categoriesOf(items).map((c) => (
            <button key={c} type="button" role="tab" aria-selected={c === category} style={chip(c === category)} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {notice ? <div style={S.notice}>{notice}</div> : null}
      <div style={S.grid}>
        {shown.map((item) => (
          <button key={item.id} type="button" style={S.card} title={item.description} onClick={() => void start(item)}>
            {item.thumb && !broken.has(item.id) ? (
              <img
                src={item.thumb}
                alt={item.name}
                loading="lazy"
                style={S.thumb}
                onError={() => setBroken((b) => new Set(b).add(item.id))}
              />
            ) : (
              // Fallback: a name card when no thumbnail ships (or it fails to load).
              <div style={{ ...S.thumb, ...S.nameCard }}>{item.name}</div>
            )}
            <span style={S.id}>{item.id}</span>
            <span style={S.desc}>{item.description}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <div style={S.empty}>没有匹配的模板</div> : null}
      <div style={S.footer}>
        {shown.length} / {items.length} 个页面模板 · 点击卡片 = 发送「用 &lt;id&gt; 模板开始」
      </div>
    </div>
  )
}

const chip = (on: boolean): CSSProperties => ({
  height: 24,
  padding: '0 8px',
  borderRadius: 12,
  fontSize: 12,
  cursor: 'pointer',
  border: '0.5px solid var(--dsw-alias-border-l2, #ccc)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: on ? 'var(--dsw-alias-interactive-bg-hover, #e8e8e8)' : 'transparent',
})

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 12, color: 'var(--dsw-alias-label-primary, inherit)' },
  toolbar: { display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderBottom: '0.5px solid var(--dsw-alias-border-l3, #ddd)' },
  search: { height: 28, padding: '0 8px', borderRadius: 6, border: '0.5px solid var(--dsw-alias-border-l2, #ccc)', background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'inherit' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  notice: { padding: '6px 10px', color: 'var(--dsw-alias-label-secondary, #555)' },
  grid: { flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, padding: 10, alignContent: 'start' },
  card: { display: 'flex', flexDirection: 'column', gap: 4, padding: 6, textAlign: 'left', cursor: 'pointer', borderRadius: 8, border: '0.5px solid var(--dsw-alias-border-l2, #ddd)', background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'inherit', font: 'inherit' },
  thumb: { width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', objectPosition: 'top', borderRadius: 4, background: 'var(--dsw-alias-bg-layer-2, #f2f2f2)' },
  nameCard: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #555)' },
  id: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, fontWeight: 600 },
  desc: { fontSize: 11, lineHeight: 1.4, color: 'var(--dsw-alias-label-tertiary, #888)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  empty: { margin: 'auto', padding: 24, color: 'var(--dsw-alias-label-tertiary, #888)' },
  footer: { padding: '4px 10px', borderTop: '0.5px solid var(--dsw-alias-border-l3, #ddd)', color: 'var(--dsw-alias-label-tertiary, #888)' },
}

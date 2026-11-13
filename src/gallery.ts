/**
 * Template gallery (Host side): the catalog with thumbnail availability, the
 * thumbnail HTTP route, the "start from this template" follow-up message, and
 * the preview toolbar prefs kept on disk (so they survive a DSH restart on a
 * new port, where the browser's localStorage origin changes).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { PLUGIN_ROOT } from './astryx.js'
import catalog from './generated/catalog.json' with { type: 'json' }
import { RPC_PREFIX, THEMES, WIDTHS } from './shared/preview-protocol.js'

export const THUMB_DIR = join(PLUGIN_ROOT, 'assets', 'thumbs')
export const THUMB_PATH = `/api/${RPC_PREFIX}/thumb`

export interface GalleryItem {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly description: string
  /** URL of the PNG thumbnail, absent when none ships for this template. */
  readonly thumb?: string
}

const IDS = new Set(catalog.templates.map((t) => t.id))

/** The shipped thumbnail for a template: WebP (about 60% smaller), else a PNG (older checkouts). */
function thumbFile(thumbDir: string, id: string): { file: string; type: string } | undefined {
  for (const [ext, type] of [['webp', 'image/webp'], ['png', 'image/png']] as const) {
    const file = join(thumbDir, `${id}.${ext}`)
    if (existsSync(file)) return { file, type }
  }
  return undefined
}

export function galleryItems(thumbDir = THUMB_DIR): GalleryItem[] {
  return catalog.templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    ...(thumbFile(thumbDir, t.id) ? { thumb: `${THUMB_PATH}?id=${encodeURIComponent(t.id)}` } : {}),
  }))
}

/** GET /api/astryx-studio/thumb?id=<template id> → image/webp or image/png (owner peer only, via the shared /api channel). */
export function thumbRoute(thumbDir = THUMB_DIR): ConnectionFetchRoute {
  return {
    path: THUMB_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      // Only ids from the catalog: never a path the caller chose.
      if (!IDS.has(id)) return new Response('unknown template', { status: 404 })
      const thumb = thumbFile(thumbDir, id)
      if (!thumb) return new Response('no thumbnail', { status: 404 })
      const body = request.method === 'HEAD' ? null : readFileSync(thumb.file)
      return new Response(body, {
        status: 200,
        headers: { 'content-type': thumb.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' },
      })
    },
  }
}

export function isTemplateId(id: unknown): id is string {
  return typeof id === 'string' && IDS.has(id)
}

/** The user message a gallery click sends: the model still picks the path and runs astryx_template. */
export function startTemplateText(id: string): string {
  return `用 \`${id}\` 模板开始`
}

// ------------------------------------------------------------------ prefs

export interface StoredPrefs {
  readonly theme: string
  readonly dark: boolean
  readonly width: string
}

export function defaultPrefsFile(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'astryx-studio', 'prefs.json')
}

export function sanitizePrefs(v: unknown): StoredPrefs | undefined {
  const p = v as Partial<Record<keyof StoredPrefs, unknown>> | null
  if (!p || typeof p !== 'object') return undefined
  if (!(THEMES as readonly unknown[]).includes(p.theme) || typeof p.dark !== 'boolean' || typeof p.width !== 'string' || !Object.hasOwn(WIDTHS, p.width)) return undefined
  return { theme: p.theme as string, dark: p.dark, width: p.width }
}

export function readPrefs(file: string): StoredPrefs | undefined {
  try {
    return sanitizePrefs(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return undefined
  }
}

export function writePrefs(file: string, prefs: StoredPrefs): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(prefs) + '\n')
}

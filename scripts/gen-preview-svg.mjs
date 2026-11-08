#!/usr/bin/env node
// Generates docs/preview.svg and docs/preview.zh.svg (640x300) for the Plugin
// Manager detail page, following the official cookbook: self-contained SVG,
// no <text>/fonts/scripts/styles/external references; lettering is outlined
// into paths from Noto Sans CJK SC (SIL OFL). Run at release time:
//   node scripts/gen-preview-svg.mjs [path/to/NotoSansCJKsc-Regular.otf]
import * as fontkit from 'fontkit'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONT = process.argv[2] ?? '/Library/Fonts/RODE Noto Sans CJK SC R.otf'
const BOLD = process.argv[3] ?? '/Library/Fonts/RODE Noto Sans CJK SC B.otf'
const regular = fontkit.openSync(FONT)
const bold = fontkit.openSync(BOLD)

/** Advance width of `str` at `size`. */
function width(str, size, font = regular) {
  return (font.layout(str).advanceWidth * size) / font.unitsPerEm
}

/** Outline `str` at (x, baseline y) as one path. */
function text(str, x, y, size, fill, font = regular) {
  const run = font.layout(str)
  const scale = size / font.unitsPerEm
  let pen = 0
  let d = ''
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i]
    const gx = x + (pen + pos.xOffset) * scale
    const gy = y - pos.yOffset * scale
    for (const c of g.path.commands) {
      const pts = c.args.map((v, k) => (k % 2 === 0 ? gx + v * scale : gy - v * scale).toFixed(1))
      d += { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' }[c.command] + pts.join(' ')
    }
    pen += pos.xAdvance
  })
  return `<path fill="${fill}" d="${d}"/>`
}

const C = {
  frame: '#ffffff', border: '#d9dde3', panel: '#f5f6f8', ink: '#16181d', sub: '#5f6672',
  accent: '#3b6cf6', green: '#1f9d55', orange: '#e8833a', violet: '#7b5cf0', dark: '#16181d', darkCard: '#24272e',
}

function svg(lang) {
  const t = lang === 'zh'
    ? { ask: '做一个在线课程销售看板', tool1: 'astryx_build → dashboard', tool2: 'astryx_template', ok: 'astryx verify ✓ tsc 0.6s', title: '课程销售看板', k1: '营收', k2: '订单', k3: '转化率', tab: 'Astryx 预览' }
    : { ask: 'Build a course sales dashboard', tool1: 'astryx_build → dashboard', tool2: 'astryx_template', ok: 'astryx verify ✓ tsc 0.6s', title: 'Course sales', k1: 'Revenue', k2: 'Orders', k3: 'Conversion', tab: 'Astryx preview' }
  const parts = []
  // Whole canvas: opaque card so it reads on light and dark pages.
  parts.push(`<rect width="640" height="300" rx="16" fill="${C.frame}"/>`, `<rect x=".5" y=".5" width="639" height="299" rx="15.5" fill="none" stroke="${C.border}"/>`)
  // Left: conversation column.
  parts.push(`<rect x="32" y="32" width="236" height="236" rx="12" fill="${C.panel}"/>`)
  const askSize = lang === 'zh' ? 13 : 11.5
  const bubble = Math.min(204, width(t.ask, askSize) + 24)
  parts.push(`<rect x="${252 - bubble}" y="48" width="${bubble}" height="34" rx="10" fill="${C.accent}"/>`, text(t.ask, 252 - bubble + 12, 70, askSize, '#ffffff'))
  const toolRow = (y, label, color) => [
    `<rect x="48" y="${y}" width="204" height="28" rx="8" fill="#ffffff" stroke="${C.border}"/>`,
    `<circle cx="62" cy="${y + 14}" r="4" fill="${color}"/>`,
    text(label, 74, y + 18.5, 11, C.ink),
  ]
  parts.push(...toolRow(98, t.tool1, C.accent), ...toolRow(134, t.tool2, C.accent), ...toolRow(170, t.ok, C.green))
  // A few lines of answer copy (abstract bars).
  for (const [i, w] of [[0, 180], [1, 150], [2, 120]]) parts.push(`<rect x="48" y="${214 + i * 14}" width="${w}" height="6" rx="3" fill="#dfe2e7"/>`)
  // Right: preview pane with toolbar and a dark-themed dashboard.
  parts.push(`<rect x="288" y="32" width="320" height="236" rx="12" fill="#ffffff" stroke="${C.border}"/>`)
  parts.push(text(t.tab, 302, 52, 12, C.ink, bold))
  // Toolbar: theme swatches, dark toggle, widths.
  const sw = ['#e9eaee', '#d8cfc4', '#b9d3a8', '#f2a7d8', '#2b2b33', '#6b4a3a', '#f4d77c']
  sw.forEach((c, i) => parts.push(`<circle cx="${428 + i * 14}" cy="47" r="5" fill="${c}" stroke="${C.border}"/>`))
  parts.push(`<rect x="530" y="40" width="64" height="14" rx="7" fill="${C.dark}"/>`, `<circle cx="586" cy="47" r="5" fill="#ffffff"/>`)
  // Dashboard surface.
  parts.push(`<rect x="300" y="64" width="296" height="192" rx="8" fill="${C.dark}"/>`)
  parts.push(text(t.title, 314, 88, 14, '#ffffff', bold))
  const kpi = (x, label, value, color) => [
    `<rect x="${x}" y="100" width="88" height="54" rx="6" fill="${C.darkCard}"/>`,
    text(label, x + 10, 118, 10, '#aab0bb'),
    text(value, x + 10, 142, 16, '#ffffff', bold),
    `<rect x="${x + 72}" y="112" width="8" height="4" rx="2" fill="${color}"/>`,
  ]
  parts.push(...kpi(314, t.k1, '¥128k', C.green), ...kpi(410, t.k2, '3,412', C.accent), ...kpi(506, t.k3, '4.8%', C.orange))
  // Chart.
  parts.push(`<rect x="314" y="164" width="280" height="80" rx="6" fill="${C.darkCard}"/>`)
  parts.push(`<path d="M326 228 C350 214 366 222 388 206 S430 190 452 198 S500 176 522 182 S566 168 582 172" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round"/>`)
  parts.push(`<path d="M326 234 C352 230 372 236 398 224 S444 220 470 214 S520 206 546 210 S570 200 582 202" fill="none" stroke="${C.violet}" stroke-width="2" stroke-linecap="round"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300">${parts.join('')}</svg>\n`
}

for (const [lang, file] of [['en', 'preview.svg'], ['zh', 'preview.zh.svg']]) {
  const out = svg(lang)
  writeFileSync(join(root, 'docs', file), out)
  console.log(`${file} ${(out.length / 1024).toFixed(1)} KiB`)
}

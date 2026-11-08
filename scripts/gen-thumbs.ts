#!/usr/bin/env -S pnpm exec tsx
/**
 * Release-time thumbnail generator (not run on install).
 *
 * Scaffolds one throwaway Astryx app with the plugin's own scaffold, writes
 * every page template of the pinned CLI into it, serves it with the Day 2
 * preview harness, and screenshots each page with Playwright (neutral theme,
 * light, 1280x800 viewport, rendered at device scale 0.375 → 480x300 PNG).
 *
 *   pnpm exec tsx scripts/gen-thumbs.ts            # all templates
 *   pnpm exec tsx scripts/gen-thumbs.ts login ide  # only these
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { template } from '@astryxdesign/cli/api'
import { chromium } from 'playwright-core'
import catalog from '../src/generated/catalog.json' with { type: 'json' }
import { runProcess } from '../src/proc.js'
import { writePreviewHarness, PREVIEW_DIR } from '../src/preview/scaffold.js'
import { freePort, parseVitePort } from '../src/preview/server.js'
import { planInstall, scaffoldFiles } from '../src/workspace.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'assets', 'thumbs')
const only = new Set(process.argv.slice(2))
const templates = catalog.templates.filter((t) => only.size === 0 || only.has(t.id))

const app = mkdtempSync(join(tmpdir(), 'astryx-thumbs-'))
console.log(`app: ${app}`)
for (const [rel, text] of Object.entries(scaffoldFiles('astryx-thumbs'))) {
  mkdirSync(dirname(join(app, rel)), { recursive: true })
  writeFileSync(join(app, rel), text)
}
const install = await runProcess('pnpm', ['install'], { cwd: app, timeoutMs: 600_000 })
if (install.code !== 0) throw new Error(`pnpm install failed:\n${install.stderr.slice(-2000)}`)

// Install what the templates really import (the CLI's installCommand also lists words from code samples).
const specs = new Set<string>()
for (const t of templates) {
  const rel = `src/pages/${t.id}/page.tsx`
  const r = await template(t.id, { cwd: app, targetPath: rel, overwrite: true })
  const d = r.data as { installCommand?: string }
  const plan = await planInstall(app, readFileSync(join(app, rel), 'utf8'), d.installCommand, rel)
  for (const spec of plan.specs) specs.add(spec)
  if (plan.ignored.length) console.log(`${t.id}: ignored CLI install words ${plan.ignored.join(', ')}`)
}
if (specs.size) {
  const r = await runProcess('pnpm', ['add', ...specs], { cwd: app, timeoutMs: 600_000 })
  if (r.code !== 0) throw new Error(`pnpm add failed:\n${r.stderr.slice(-2000)}`)
}
writePreviewHarness(app)

const port = await freePort()
const vite = spawn(join(app, 'node_modules/.bin/vite'), ['--config', join(PREVIEW_DIR, 'vite.config.ts'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: app,
  env: { ...process.env, FORCE_COLOR: '0' },
})
let log = ''
const url = await new Promise<string>((ok, fail) => {
  const timer = setTimeout(() => fail(new Error(`vite not ready:\n${log}`)), 60_000)
  const on = (d: Buffer) => {
    log += d.toString()
    const p = parseVitePort(log)
    if (p) {
      clearTimeout(timer)
      ok(`http://127.0.0.1:${p}/`)
    }
  }
  vite.stdout.on('data', on)
  vite.stderr.on('data', on)
})

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.375, colorScheme: 'light' })
const failures: string[] = []
try {
  for (const t of templates) {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    try {
      await page.goto(`${url}?page=${encodeURIComponent(`src/pages/${t.id}/page.tsx`)}&theme=neutral&dark=0`, { waitUntil: 'networkidle', timeout: 120_000 })
      // Let charts, fonts and entrance transitions settle.
      await page.waitForTimeout(1500)
      const file = join(outDir, `${t.id}.png`)
      await page.screenshot({ path: file, type: 'png' })
      console.log(`${t.id}.png ${(statSync(file).size / 1024).toFixed(1)} KiB${errors.length ? `  (page errors: ${errors[0]})` : ''}`)
      if (errors.length) failures.push(`${t.id}: ${errors[0]}`)
    } catch (error) {
      failures.push(`${t.id}: ${error instanceof Error ? error.message : String(error)}`)
      console.log(`${t.id} FAILED`)
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
  vite.kill('SIGTERM')
}

const manifest = Object.fromEntries(
  catalog.templates.map((t) => {
    try {
      return [t.id, statSync(join(outDir, `${t.id}.png`)).size]
    } catch {
      return [t.id, 0]
    }
  }),
)
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ cliVersion: catalog.cliVersion, width: 480, height: 300, sizes: manifest }, null, 2) + '\n')
const total = Object.values(manifest).reduce((a, b) => a + b, 0)
console.log(`\n${Object.values(manifest).filter(Boolean).length}/${catalog.templates.length} thumbnails, ${(total / 1024).toFixed(0)} KiB total`)
if (failures.length) console.log(`failures:\n${failures.join('\n')}`)
rmSync(app, { recursive: true, force: true })

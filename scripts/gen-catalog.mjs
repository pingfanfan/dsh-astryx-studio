#!/usr/bin/env node
// Snapshot what the pinned @astryxdesign/cli says once, at build time:
// the playbook rules from a no-arg build() and the page-template catalog.
// The prompt section and astryx_build's fallback read this file, so their
// text is byte-stable between turns (DeepSeek prefix cache) and costs no
// runtime CLI call.
import { build, template } from '@astryxdesign/cli/api'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = JSON.parse(readFileSync(join(root, 'node_modules/@astryxdesign/cli/package.json'), 'utf8'))
const help = await build(undefined, { cwd: root })
if (help.type !== 'build.help') throw new Error(`unexpected build() type ${help.type}`)
const list = await template(undefined, { list: true, type: 'page', cwd: root })
const firstSentence = (s) => {
  const m = /^(.+?[.!?])(\s|$)/.exec(s)
  return (m ? m[1] : s).trim()
}
const catalog = {
  cliVersion: cli.version,
  rules: help.data.rules,
  templates: list.data
    .filter((t) => t.type === 'page')
    .map((t) => ({ id: t.id, name: t.name, description: firstSentence(t.description) })),
}
writeFileSync(join(root, 'src/generated/catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
console.log(`catalog: cli ${catalog.cliVersion}, ${catalog.rules.length} rules, ${catalog.templates.length} page templates`)

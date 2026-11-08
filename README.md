# dsh-astryx-studio

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that lets the agent build pages with Meta's [Astryx](https://github.com/meta/astryx) design system: structured Astryx tools, a verify hook on every write, and a live preview tab in the right Sidebar.

> **How this differs from [markmini1234/astryx](https://github.com/markmini1234/astryx):** that project restyles the dsh UI with Astryx. This plugin does the tools, verification and preview for pages you build with Astryx. It does not theme dsh.

**Status: Day 2.** Tools, verify hook, prompt section, skill and the live preview tab work. The template gallery is not built yet.

## What it does

| Tool | Wraps | Notes |
|---|---|---|
| `astryx_build(keywords)` | `build()` | English keywords. When the ranker has no evidence (`basis: fallback` or no results) the result lists every page template so the model picks; `blank` is the last resort. |
| `astryx_template(id, path?)` | `template()` | Default path `src/pages/main/page.tsx`. If the session folder is not an Astryx project, asks (DSH approval), then creates `./astryx-app` shaped like the official `apps/example-vite` and installs it. Runs the template's `installCommand` when packages are missing; warms tsc in the background. |
| `astryx_component(name)` | `component(--dense --zh)` | Props before editing a component. |
| `astryx_search(query, type?, limit?)` | `search()` | |
| `astryx_render(file, out?)` | `render()` (experimental) | Single-file HTML export. |

**Verify hook.** For `write` / `edit` / `apply_patch` / `str_replace_editor` on `.ts/.tsx` inside the Astryx workspace:

- **Synchronous** (milliseconds, returned with the tool result as `astryx verify ✗`): an esbuild syntax check and a lint count-diff. A write may not increase the number of `<div>`, `style={{}}` or `stylex.create`, and may not add an import outside `@astryxdesign/*`, `@stylexjs/stylex`, `react`, `react-dom`, `@heroicons/react`, `lucide-react`, `recharts`. Calibrated to zero false positives on all 57 page templates of `@astryxdesign/cli` 0.7.11, see [docs/lint-calibration.md](docs/lint-calibration.md).
- **Asynchronous**: `tsc --noEmit --incremental`, one run per workspace at a time; a new write cancels the run in flight. The newest result is injected at the agent's next step (`astryx verify ✓ (tsc 0.6s)` or the TS errors); that step waits up to `tscStepWaitMs` (5 s) for a run still in flight, so a model that edits and immediately finishes still gets the verdict. End-to-end evidence: [docs/e2e-day1.md](docs/e2e-day1.md).

**Prompt and skill.** A stable prompt section (the playbook rules from `build()` plus the Chinese workflow), and an `astryx-page` skill with a template selection table and the full template list.

**Preview tab.** `astryx_template` opens the **Astryx 预览** tab in the right Sidebar:

- **The iframe** points straight at a preview Vite on `127.0.0.1`, started lazily through `ctx.subprocess`, restarted once on a crash and killed with the plugin. The harness lives in `<workspace>/.astryx-studio/` (git-ignored). The user's own `vite.config` is untouched. `server.fs.allow` covers only `.astryx-studio/`, `src/` and `node_modules/`.
- **The toolbar** switches between the 7 themes, dark mode and three widths (desktop / tablet / 390) without the model and without recompiling; the choice survives a refresh. It can also open the page in the browser or export single-file HTML.
- **The footer** shows the Vite state and the latest verify result.
- **Runtime errors** in the page show in the tab. They reach the model at its next step only if they happened after its last write, and each distinct error only once.

Screenshots: [docs/preview-day2.md](docs/preview-day2.md).

`@astryxdesign/cli`, `core`, `build`, the 7 themes and the scaffold are pinned to the same version (0.7.11).

## Install (development)

Requires dsh `>=0.2.2-rc.1 <0.3.0`.

```sh
pnpm install && pnpm run build
# once: make `dev` a copy of the shipped web profile (a profile created by
# `plugin add` alone only has dsh-base and cannot serve the web UI)
dsh --profile dev --from-default-profile web --dump-config > /dev/null
dsh plugin --profile dev add .
dsh --profile dev --no-open
```

Expected: the five `astryx_*` tools in the tool list. Ask for a page and the **Astryx 预览** tab opens with the live preview.

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Host half: registers tools, prompt section, skill and the verify hooks |
| `src/tools.ts`, `src/astryx.ts` | The five tools over `@astryxdesign/cli/api` |
| `src/workspace.ts` | Workspace detection and the built-in Vite scaffold |
| `src/verify/` | esbuild syntax, lint count-diff, tsc scheduler, hook core |
| `src/preview/` | `.astryx-studio/` harness, Vite server lifecycle, per-session preview state and runtime-error gating |
| `src/rpc.ts`, `src/shared/` | Client ↔ Host RPC (exact routes under `/api/astryx-studio/`) and the shared protocol |
| `client/preview-tab.tsx`, `client/store.ts` | Preview tab body, toolbar, footer, persisted toolbar state |
| `src/prompt.ts`, `src/generated/catalog.json` | Prompt section and skill; catalog generated from the pinned CLI at build time |
| `client/index.tsx` | Web client half: `astryx-preview` tab type and body |
| `scripts/build.mjs` | tsdown build to `lib/index.js` (ESM) and `lib/client.js` (a ModuleLoader factory) |
| `cordis.patch.yml` | Bundle layer that inserts the plugin row `astryx-studio` |
| `tests/` | Unit tests per tool and hook, lint calibration over 57 templates, client smoke test; `ASTRYX_E2E=1` runs a real scaffold → template → tsc integration |

`lib/` is committed so local-checkout and git installs need no build step.

## Scripts

`pnpm run typecheck` · `pnpm run build` · `pnpm test` · `pnpm run check` (all three)

## License

MIT

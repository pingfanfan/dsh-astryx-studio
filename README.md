# dsh-astryx-studio

[![CI](https://github.com/pingfanfan/dsh-astryx-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/pingfanfan/dsh-astryx-studio/actions/workflows/ci.yml)

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that lets the agent build pages with Meta's [Astryx](https://github.com/meta/astryx) design system: structured Astryx tools, a verify hook on every write, and a live preview tab in the right Sidebar.

> **How this differs from [markmini1234/astryx](https://github.com/markmini1234/astryx):** that project restyles the dsh UI with Astryx. This plugin does the tools, verification and preview for pages you build with Astryx. It does not theme dsh.

**Status: 0.1.x.** Tools, verify hook, prompt section, skill, the live preview tab, preview screenshots for the model and the template gallery all work. On GitHub; not on npm yet. The bench is deferred.

## What it does

| Tool | Wraps | Notes |
|---|---|---|
| `astryx_build(keywords)` | `build()` | English keywords. When the ranker has no evidence (`basis: fallback` or no results) the result lists every page template so the model picks; `blank` is the last resort. |
| `astryx_template(id, path?)` | `template()` | Default path `src/pages/main/page.tsx`. If the session folder is not an Astryx project, asks (DSH approval), then creates `./astryx-app` shaped like the official `apps/example-vite` and installs it. Runs the template's `installCommand` when packages are missing; warms tsc in the background. |
| `astryx_component(name)` | `component(--dense --zh)` | Props before editing a component. |
| `astryx_search(query, type?, limit?)` | `search()` | |
| `astryx_render(file, out?)` | `render()` (experimental) | Single-file HTML export. |
| `astryx_screenshot(width?, full_page?, page?, theme?, dark?)` | headless Chrome over CDP | Full-page PNG of the live preview at an exact viewport width (390 is really 390), once the page reports ready, with entry animations off. Returns the path for DSH's `read_image` plus the page's console errors. Uses the installed Chrome / Chromium / Edge (`chromePath` to override); registered only where the Host can take one. |

**Verify hook.** For `write` / `edit` / `apply_patch` / `str_replace_editor` on `.ts/.tsx` inside the Astryx workspace:

- **Synchronous** (milliseconds, returned with the tool result as `astryx verify ✗`): an esbuild syntax check and a lint count-diff. A write may not increase the number of `<div>`, `style={{}}` or `stylex.create`, and may not add an import outside `@astryxdesign/*`, `@stylexjs/stylex`, `react`, `react-dom`, `@heroicons/react`, `lucide-react`, `recharts`. Calibrated to zero false positives on all 57 page templates of `@astryxdesign/cli` 0.7.11, see [docs/lint-calibration.md](docs/lint-calibration.md).
- **Asynchronous**: `tsc --noEmit --incremental`, one run per workspace at a time; a new write cancels the run in flight. The newest result is injected at the agent's next step (`astryx verify ✓ (tsc 0.6s)` or the TS errors); that step waits up to `tscStepWaitMs` (5 s) for a run still in flight, so a model that edits and immediately finishes still gets the verdict. End-to-end evidence: [docs/e2e-day1.md](docs/e2e-day1.md).

**Prompt and skill.** A stable prompt section (the playbook rules from `build()` plus the Chinese workflow), and an `astryx-page` skill with a template selection table and the full template list.

**Preview tab.** `astryx_template` opens the **Astryx 预览** tab in the right Sidebar:

- **The iframe** points straight at a preview Vite on `127.0.0.1`, started lazily through `ctx.subprocess`, restarted once on a crash and killed with the plugin. The harness lives in `<workspace>/.astryx-studio/` (git-ignored). The user's own `vite.config` is untouched. `server.fs.allow` covers only `.astryx-studio/`, `src/` and `node_modules/`.
- **The toolbar** switches between the 7 themes, dark mode and three widths (desktop / tablet / 390) without the model and without recompiling; the choice survives a refresh. It can also open the page in the browser or export single-file HTML.
- **The footer** shows the Vite state and the latest verify result.
- **Other projects.** In a project the plugin did not create, the preview asks before adding its packages (themes, `@astryxdesign/build`, Vite) to `package.json`. Nothing is installed or written until the user clicks **安装预览依赖**, and installs never run the project's own scripts.
- **Runtime errors** in the page show in the tab. They reach the model at its next step only if they happened after its last write, and each distinct error only once.
- **First load.** Vite optimizes every dependency of the harness and the pages in one pass at startup. A page module that fails to *fetch* (packages still installing) is retried with backoff for about 50 s behind a waiting message, and only then reported. When `astryx_template` or a `bash` command (`pnpm add`, `npm install`, …) installs or removes packages in a workspace whose preview Vite is running, that Vite restarts. Pages load by absolute `/@fs` URL, so a page the model adds while the preview runs shows up too. If a model write gets no HMR update within 4 s, the tab reloads the iframe.

**Template gallery.** The **Astryx 模板画廊** tab (also reachable from the preview toolbar) shows all 57 page templates with thumbnails, category filters and search in English or Chinese (表格, 看板, 登录表单 map to the English words the templates use). Clicking one sends 「用 `<id>` 模板开始」 as an ordinary user turn: the model still decides where the page goes and runs `astryx_template`. The toolbar choice (theme, dark mode, width) is also kept in `$DSH_HOME/astryx-studio/prefs.json`, so it survives a DSH restart on another port.

Screenshots: [docs/preview-day2.md](docs/preview-day2.md), [docs/gallery-day3.md](docs/gallery-day3.md). Preview fixes and `astryx_screenshot`, with before/after runs: [docs/preview-fixes.md](docs/preview-fixes.md).

`@astryxdesign/cli`, `core`, `build`, the 7 themes and the scaffold are pinned to the same version (0.7.11).

## Install (development)

Requires dsh `>=0.2.2-rc.1 <0.3.0`. Tested on macOS; Linux should work (CI runs the unit tests there). Windows is untested: the plugin starts `pnpm`, `node_modules/.bin/vite` and `.bin/tsc` without a shell, which Windows `.cmd` shims do not allow.

```sh
pnpm install && pnpm run build
# once: make `dev` a copy of the shipped web profile (a profile created by
# `plugin add` alone only has dsh-base and cannot serve the web UI)
dsh --profile dev --from-default-profile web --dump-config > /dev/null
dsh plugin --profile dev add .
dsh --profile dev --no-open
```

Expected: the six `astryx_*` tools in the tool list (five where no Chrome-family browser is installed). Ask for a page and the **Astryx 预览** tab opens with the live preview.

## Options

Set on the plugin row in a profile patch (`cordis.patch.yml`).

| Option | Default | Meaning |
|---|---|---|
| `appDir` | `astryx-app` | Folder the scaffold creates under the session folder when it is not an Astryx project. |
| `packageManager` | `auto` | `auto` (pnpm when on PATH, else npm), `pnpm` or `npm`. |
| `locale` | `zh-CN` | Locale of built-in component text (必填/可选, dates…) in scaffolded apps; empty for none. The preview follows the app's own `src/main.tsx`. |
| `chromePath` | auto-detect | Chrome / Chromium / Edge binary for `astryx_screenshot`. |
| `installTimeoutMs` | `300000` | Scaffold and template install timeout. |
| `tscTimeoutMs` / `tscStepWaitMs` | `30000` / `5000` | tsc budget, and how long the next agent step waits for a run in flight. |
| `maxReportedErrors` | `5` | Findings quoted per verify message. |
| `prefsFile` | `$DSH_HOME/astryx-studio/prefs.json` | Where the preview toolbar choice is kept. |

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Host half: registers tools, prompt section, skill and the verify hooks |
| `src/tools.ts`, `src/astryx.ts` | The five tools over `@astryxdesign/cli/api`, plus `astryx_screenshot` |
| `src/workspace.ts` | Workspace detection and the built-in Vite scaffold |
| `src/verify/` | esbuild syntax, lint count-diff, tsc scheduler, hook core |
| `src/preview/` | `.astryx-studio/` harness, Vite server lifecycle, per-session preview state and runtime-error gating; `shot.ts` drives headless Chrome for `astryx_screenshot` |
| `src/rpc.ts`, `src/shared/` | Client ↔ Host RPC (exact routes under `/api/astryx-studio/`) and the shared protocol |
| `client/preview-tab.tsx`, `client/store.ts` | Preview tab body, toolbar, footer, persisted toolbar state |
| `src/prompt.ts`, `src/generated/catalog.json` | Prompt section and skill; catalog generated from the pinned CLI at build time |
| `client/index.tsx`, `client/gallery-tab.tsx` | Web client half: `astryx-preview` and `astryx-gallery` tab types and bodies (Chinese search terms in `src/shared/zh-terms.ts`) |
| `scripts/build.mjs` | tsdown build to `lib/index.js` (ESM) and `lib/client.js` (a ModuleLoader factory) |
| `cordis.patch.yml` | Bundle layer that inserts the plugin row `astryx-studio` |
| `tests/` | Unit tests per tool and hook, lint calibration over 57 templates, client smoke test; `ASTRYX_E2E=1` runs a real scaffold → template → tsc → preview Vite → headless-Chrome integration |

`lib/` is committed so local-checkout and git installs need no build step.

## Release-time assets

- `pnpm exec tsx scripts/gen-thumbs.ts`: regenerates `assets/thumbs/*.webp` (57 × 480×300, about 0.4 MiB) with Playwright and `cwebp` (`brew install webp`; without it the PNGs are kept).
- `node scripts/gen-preview-svg.mjs`: regenerates `docs/preview.svg` and `docs/preview.zh.svg` (Plugin Manager detail images, lettering outlined from Noto Sans CJK SC).
- `node scripts/gen-catalog.mjs` (run by `pnpm run build`): the playbook rules and template catalog from the pinned CLI.

## Scripts

`pnpm run typecheck` · `pnpm run build` · `pnpm test` · `pnpm run check` (all three) · `pnpm run e2e`

## Testing

- **Unit tests** (`pnpm test`, about 10 s): every tool and hook with a fake CLI and process runner. `tests/shot.test.ts` drives the installed Chrome and is skipped where none is found.
- **End to end** (`pnpm run e2e`, about 1 min, needs the network): a real scaffold, template, install and tsc. Then the real preview Vite: the `/@fs` allow-list is checked, and headless Chrome must see the generated harness report ready at 390 px.
- **By hand in DSH**, after `pnpm run build`:
  1. Start DSH with `dsh --profile dev --no-open`. The `dev` profile links this checkout, and DSH loads `lib/` at startup, so restart it after every build.
  2. Register an empty folder as a workspace, start a session in it and ask for a page in Chinese.
  3. Watch the preview tab follow the model's writes. The template rewrite is the case that used to go stale.
  4. Check that the model uses `astryx_screenshot` + `read_image` rather than its own browser. See [docs/preview-fixes.md](docs/preview-fixes.md) for what good runs look like.
  5. Model runs spend the DeepSeek API, so most checks need none: the toolbar, the gallery, a page with a syntax error, a page added while Vite runs, and `kill -9` on the preview Vite.

## License

MIT

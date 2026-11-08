# dsh-astryx-studio

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that lets the agent build pages with Meta's [Astryx](https://github.com/meta/astryx) design system: structured Astryx tools, a verify hook on every write, and a live preview tab in the right Sidebar.

> **How this differs from [markmini1234/astryx](https://github.com/markmini1234/astryx):** that project restyles the dsh UI with Astryx. This plugin does the tools, verification and preview for pages you build with Astryx. It does not theme dsh.

**Status: Day 0 skeleton.** It ships one placeholder tool (`astryx_ping`), an empty prompt section, and an empty `astryx-preview` Sidebar tab. The real tools (`astryx_build` / `template` / `component` / `search` / `render`), the verify hook and the Vite preview are not built yet.

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

Expected: `astryx_ping` in the tool list; "Astryx 预览" under the right Sidebar's guide page.

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Host half: `apply(ctx)` registers tools and the prompt section |
| `client/index.tsx` | Web client half: `astryx-preview` tab type and body |
| `scripts/build.mjs` | tsdown build to `lib/index.js` (ESM) and `lib/client.js` (a ModuleLoader factory) |
| `cordis.patch.yml` | Bundle layer that inserts the plugin row `astryx-studio` |
| `tests/` | Host unit test, client bundle smoke test |

`lib/` is committed so local-checkout and git installs need no build step.

## Scripts

`pnpm run typecheck` · `pnpm run build` · `pnpm test` · `pnpm run check` (all three)

## License

MIT

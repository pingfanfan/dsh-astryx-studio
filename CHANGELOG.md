# Changelog

## Unreleased

Found by testing 0.1.0 end to end in DSH; details and before/after runs in [docs/preview-fixes.md](docs/preview-fixes.md).

### Added

- `astryx_screenshot(width?, full_page?, page?, theme?, dark?)`: full-page PNG of the live preview at an exact viewport width through the installed Chrome / Chromium / Edge (DevTools protocol, no Playwright). It returns the path for DSH's `read_image` plus the page's console errors. The prompt tells the model to use it instead of starting its own browser. New option `chromePath`.
- The template gallery searches in Chinese: 表格, 看板, 登录表单 and similar terms map to the English words the templates use.
- `astryx_search` does the same: the CLI search found nothing for Chinese (表格, 弹窗, 日期选择: 0 results), and now searches table, dialog, date. The term map gained about 40 component words (日期, 标签页, 开关, 分页, 抽屉…).
- `astryx_build` maps Chinese keywords to English when the model passes them. The CLI ranker sent every Chinese query to the same fallback template (`shell-top-nav`); 登录页 now finds `login`, 商品详情 finds `product-detail`, 课程 销售 看板 finds `dashboard`.
- Option `locale` (default `zh-CN`): scaffolded apps wrap the page in `InternationalizationProvider`, so built-in component text (必填/可选, dates) matches the page's language. The preview follows the app's own entry.

### Fixed

- The preview tab kept showing the template after the model rewrote the page with a different default component. Harness v5 swaps in the HMR-updated page module.
- Pages created while the preview Vite runs showed "No page at …". Pages now load by absolute `/@fs` URL.
- The first load could fail with "Failed to fetch dynamically imported module" and send that transient error to the model. Vite now optimizes all dependencies at startup, and fetch failures are retried for about 50 s behind a waiting message before anything is reported.
- After `astryx_template` or a `bash` command installs packages, the running preview Vite restarts, because Vite caches failed resolutions.
- The tab reloads the iframe if a model write gets no HMR update within 4 s.
- The gallery's "no matching templates" message sat at the bottom of an empty grid. It now sits under the toolbar, with a clear-search button.
- A page that does not compile now shows its error in the preview, instead of "No page at …". Page paths may contain Chinese or spaces, and Windows paths work.
- `astryx_screenshot` no longer leaks Chrome when it fails to start, and cleaning up its profile can no longer crash the Host.
- Gallery thumbnails are WebP: 0.4 MB instead of 1.0 MB, so the package is about 60% smaller.
- The first preview after a cold start is ready in about 6 s instead of about 12 s. Vite pre-transforms the harness and pages as soon as it starts (`server.warmup`).

### Security

Found by an independent security review; none critical.

- **The preview dev server is locked down.** CORS is off, so other localhost pages can no longer read the workspace sources. Only local pages may frame the preview (`frame-ancestors`). The preview posts its messages only to a local parent, never to `*`.
- **Installs into other people's projects need approval.** In a project the plugin did not create, the preview no longer adds packages to its `package.json` on its own. The tab lists the missing packages, and installs them only when the user clicks the button. `astryx_screenshot` tells the model to ask the user. Scaffolded projects ship every preview package and never see the prompt.
- **Installs run no project code.** Installs into a workspace run with `--ignore-scripts` (and `--ignore-pnpmfile` with pnpm), so a cloned project's lifecycle scripts or `.pnpmfile.cjs` do not run.
- **Model-supplied paths are checked against real paths,** so a symlink in the workspace cannot redirect a write. Template and render targets must be `.tsx` under `src/`, and exports `.html`, never in `node_modules` or a dot-folder.
- **Page output is marked as data.** Runtime errors and screenshot console errors reach the model fenced and labelled as page output, with control characters removed.

## 0.1.0 — 2026-11-08

First release: five Astryx tools, the verify hook (esbuild + lint synchronously, tsc in the background), prompt section and `astryx-page` skill, the live preview tab and the template gallery.

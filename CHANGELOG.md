# Changelog

## Unreleased

Found by testing 0.1.0 end to end in DSH; details and before/after runs in [docs/preview-fixes.md](docs/preview-fixes.md).

### Added

- `astryx_screenshot(width?, full_page?, page?, theme?, dark?)`: full-page PNG of the live preview at an exact viewport width through the installed Chrome / Chromium / Edge (DevTools protocol, no Playwright). It returns the path for DSH's `read_image` plus the page's console errors. The prompt tells the model to use it instead of starting its own browser. New option `chromePath`.
- The template gallery searches in Chinese: 表格, 看板, 登录表单 and similar terms map to the English words the templates use.

### Fixed

- The preview tab kept showing the template after the model rewrote the page with a different default component. Harness v5 swaps in the HMR-updated page module.
- Pages created while the preview Vite runs showed "No page at …". Pages now load by absolute `/@fs` URL.
- The first load could fail with "Failed to fetch dynamically imported module" and send that transient error to the model. Vite now optimizes all dependencies at startup, and fetch failures are retried for about 50 s behind a waiting message before anything is reported.
- After `astryx_template` or a `bash` command installs packages, the running preview Vite restarts, because Vite caches failed resolutions.
- The tab reloads the iframe if a model write gets no HMR update within 4 s.
- The gallery's "no matching templates" message sat at the bottom of an empty grid. It now sits under the toolbar, with a clear-search button.

## 0.1.0 — 2026-11-08

First release: five Astryx tools, the verify hook (esbuild + lint synchronously, tsc in the background), prompt section and `astryx-page` skill, the live preview tab and the template gallery.

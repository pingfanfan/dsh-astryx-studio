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
- After `astryx_template` or a `bash` command installs packages, the running preview Vite restarts, because Vite caches failed resolutions. A bare `yarn` and installs wrapped in `bash -c "…"` / `sh -c '…'` count too.
- The tab reloads the iframe if a model write gets no HMR update within 4 s.
- The gallery's "no matching templates" message sat at the bottom of an empty grid. It now sits under the toolbar, with a clear-search button.
- A page that does not compile now shows its error in the preview, instead of "No page at …". Page paths may contain Chinese or spaces, and Windows paths work.
- A session opened in a subfolder of an Astryx project (`myapp/src`) now uses that project, instead of scaffolding a second one nested inside it. The search stops at the nearest `package.json`, a `.git` folder or the home folder, so an unrelated project further up is never picked.
- `astryx_screenshot` fixes from a review:
  - Full-page shots of pages with `height: 100vh` sections are complete. The viewport no longer grows to the page height (which stretched those sections and cut off the rest); the page is captured beyond the viewport instead.
  - A page stuck in an endless loop, or a preview that never answers, can no longer hang the tool: every DevTools call is bounded by the timeout and by cancel. A preview that refuses the connection fails at once instead of after 75 s.
  - Only the first 5 console errors are kept while the page loads.
  - Chrome no longer leaks when it fails to start, its temporary profile is removed only after it has exited, and cleaning it up can no longer crash the Host.
- RPC and runtime-error fixes: status polls and error reports for unknown sessions no longer create session entries, at most 20 runtime errors reach the model per step, and a stored width such as `constructor` is rejected (`Object.hasOwn` instead of `in`).
- Preview and gallery tab fixes from a review of the client:
  - The tab polls the Host only while it is visible, one call at a time; so does the watcher that opens the tab.
  - A status poll that was already under way can no longer undo a finished install and bring the install button back.
  - An install failure stays on screen until dismissed, instead of vanishing at the next poll.
  - "导出中…" and "正在发送…" can no longer get stuck when a call fails, and a double-click on a gallery card sends one turn, not two.
  - The tab no longer reloads an up-to-date preview when it noticed a write late.
  - Toolbar settings from the Host are checked before use, and a change made while they load is kept.
- Preview server fixes from a review of its start-up and restart logic:
  - Vite's output was scanned for the port line for its whole lifetime, re-reading an ever-growing buffer on every HMR message. Scanning now stops once Vite reports its port.
  - A preview that failed to start revives when packages are installed from the shell, instead of staying on the old error.
  - If the preview cannot even be set up (read-only or deleted workspace, full disk), the tab shows the error instead of an unhandled promise rejection that could reach the DSH host.
  - A Vite crash after more than a minute of healthy running gets a fresh automatic restart. Before, any crash after the first restart was final.
  - Approving an install right as the tab shows "needs install" now always starts it.
- The write check (`astryx verify`) is more accurate:
  - A file renamed with `apply_patch` is compared with its old contents, not treated as new. Operations that failed partway are still checked, since they may have written; skipped ones are not.
  - Each tool execution keeps its own "before" snapshot, even when two calls share an id. Only the newest 64 are kept, so abandoned ones cannot pile up.
  - A `<div>` in a comment and spacing like `style = {{` no longer change the counts. When one side has a syntax error, both sides are counted the same way.
  - A write that fixes a syntax error is not blamed for imports the file already had.
  - When the parent agent and a subagent both write in a workspace, each one sees the next tsc result, instead of whoever asked first taking it. After a new write, the older result is never handed out in place of the run in flight.
  - A tsc run that cannot start (for example, in a read-only workspace) shows as "unverified" instead of an unhandled error. Windows tsc paths are shown relative to the workspace.
- An install or tsc run that times out or is cancelled is killed with SIGKILL if it ignores SIGTERM for 3 s. A run also settles 2 s after its process exits, even if a grandchild still holds its output open, so it can no longer hold the tool call forever. On Windows, `node` is spawned directly, without `cmd.exe` in between. A timeout or cancel on Windows stops the whole process tree (`taskkill /T /F`), so no `pnpm` is left running under a killed `cmd.exe`.
- Windows: `pnpm`/`npm` run through `cmd.exe` with quoted arguments, and Vite and tsc run from their JavaScript entries with `node`, because Node cannot spawn `.cmd` shims directly. Unit-tested only; not yet run on Windows.

### Performance

- The first preview after a cold start is ready in about 6 s instead of about 12 s. Vite pre-transforms the harness and pages as soon as it starts (`server.warmup`).
- Gallery thumbnails are WebP: 0.4 MB instead of 1.0 MB, so the package is about 60% smaller.

### Security

Found by independent reviews and a dependency audit; none critical.

- **Dependency audit is clean.** The repo's lockfile overrides `zod` (to ≥4.6.6) and `undici` (to ≥8.12.2), which `pnpm audit` flagged. Installs of the plugin were not affected: `zod` reaches users only through `@astryxdesign/cli`'s `^4.4.3`, which already resolves to a fixed version, and `undici` comes only from DSH's own packages, which DSH supplies at runtime.
- **The preview dev server is locked down.** CORS is off, so other localhost pages can no longer read the workspace sources. Only local pages and the DSH desktop app (`dsh-app://app`) may frame the preview (`frame-ancestors`), so its messages can only reach DSH.
- **Installs into other people's projects need approval.** In a project the plugin did not create, the preview no longer adds packages to its `package.json` on its own. The tab lists the missing packages, and installs them only when the user clicks the button. `astryx_screenshot` tells the model to ask the user. In such a project, `astryx_template` also asks through DSH's approval card, because writing a template may add its packages. Scaffolded projects ship every preview package and never see the prompt.
- **Creating `./astryx-app` stays inside it.** Inside a parent pnpm workspace, the new app's install used to run the parent's `.pnpmfile.cjs` and root `postinstall` and rewrite the parent's lockfile (reproduced with a probe). The new app is now its own pnpm workspace root (it ships a `pnpm-workspace.yaml`, and its first install runs with `--ignore-workspace --ignore-pnpmfile`), so later installs, including the model's own `pnpm add`, stay inside it too. The e2e test runs inside a booby-trapped parent workspace to keep it that way. The scaffold also refuses a folder that already has files, instead of overwriting the user's `index.html`, `vite.config.ts` or `src/`, and never writes through a link that already exists.
- **Installs run no project code.** Installs into a workspace run with `--ignore-scripts` (and `--ignore-pnpmfile` with pnpm), so a cloned project's lifecycle scripts or `.pnpmfile.cjs` do not run.
- **Model-supplied paths are checked against real paths,** so a symlink in the workspace cannot redirect a write. Template and render targets must be `.tsx` under `src/`, and exports `.html`, never in `node_modules` or a dot-folder.
- **The preview tab trusts only the preview server.** Messages are accepted only from the preview server's origin, and theme commands are sent only to it. A link in a generated page that navigates the preview elsewhere can no longer feed text to the model as a "runtime error".
- **Page output is marked as data.** Runtime errors and screenshot console errors reach the model fenced and labelled as page output, with control characters removed.

## 0.1.0 — 2026-11-08

First release: five Astryx tools, the verify hook (esbuild + lint synchronously, tsc in the background), prompt section and `astryx-page` skill, the live preview tab and the template gallery.

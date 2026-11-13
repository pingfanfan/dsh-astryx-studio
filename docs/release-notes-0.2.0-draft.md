# 0.2.0 发布说明（草稿）

> 草稿：版本号和标签都还没改，发布前请再核对一遍。英文版在后面。

这一版来自对 0.1.0 的一次完整实测：在 DeepSeek Harness 里用 DeepSeek V4.1 Flash 从空文件夹开始做页面。修复前后的对比和截图见 [preview-fixes.md](preview-fixes.md)。

## 亮点

- **预览不再停在旧页面。** 模型重写模板后，预览会实时跟上。新建的第二个页面也能显示，写错语法的页面直接显示报错位置。
- **模型能看到页面了。** 新工具 `astryx_screenshot` 按精确宽度（390 就是真 390）截整页图，模型再用 `read_image` 查看。同类需求从 60 步、约 470 万 token 降到 17 步、约 72 万 token。
- **中文友好。**
  - 模板画廊支持中文搜索。
  - `astryx_build` 和 `astryx_search` 会把中文关键词转成英文：以前中文需求全部落到同一个不相干的模板，中文搜索结果都是 0 条。
  - 新建项目默认显示中文组件文案（必填/可选、日期）。
- **更快、更小。** 冷启动后的首次预览从约 12 秒降到约 6 秒，安装包从 1.1 MB 降到约 0.5 MB。
- **更安全。** 一次独立安全审查发现的问题已全部修复：
  - 预览服务器关闭跨域访问，只允许本机页面嵌入；
  - 往别人的项目里装依赖前会先询问，安装时不运行项目自带的脚本；
  - 路径按真实路径检查；
  - 页面报错以「数据」而不是「指令」的形式交给模型。

## 新选项

- `locale`：组件内置文案的语言，默认 `zh-CN`，留空则不设置。
- `chromePath`：`astryx_screenshot` 使用的浏览器，默认自动查找本机的 Chrome、Chromium 或 Edge。

## 已知限制

- Windows 未实测：已按 Windows 的方式启动 `pnpm`、Vite 和 tsc（经 `cmd.exe` 或 `node`），命令行有单元测试，但没在 Windows 上跑过。
- 「在 web-review 打开」按钮还没在装了 web-review 的环境里测过。
- 所有实测都在 DSH 网页版（`dev` profile）里做的。DSH 桌面 app 的界面运行在 `dsh-app://app`，预览的安全策略已经放行它，但没有在桌面 app 里实测。

完整改动见 [CHANGELOG.md](../CHANGELOG.md)。

---

# 0.2.0 release notes (draft)

> Draft: the version and tag are not changed yet. Check again before releasing.

This release comes from an end-to-end test of 0.1.0: building pages in DeepSeek Harness with DeepSeek V4.1 Flash, starting from empty folders. Before/after runs and screenshots are in [preview-fixes.md](preview-fixes.md).

## Highlights

- **The preview follows the model.** After a template rewrite the preview updates live. A second page created while the preview runs shows up, and a page with a syntax error shows its error.
- **The model can see the page.** The new `astryx_screenshot` tool takes a full-page shot at an exact width (390 is really 390), and the model opens it with `read_image`. A comparable request went from 60 steps and about 4.7M tokens to 17 steps and about 720K tokens.
- **Chinese-friendly.**
  - The gallery searches in Chinese.
  - `astryx_build` and `astryx_search` map Chinese keywords to English. Before, every Chinese request landed on the same unrelated template, and every Chinese search returned nothing.
  - New projects show Chinese built-in component text (必填/可选, dates).
- **Faster and smaller.** The first preview after a cold start is ready in about 6 s instead of about 12 s. The package is about 0.5 MB instead of 1.1 MB.
- **Safer.** Everything an independent security review found is fixed:
  - the preview server has CORS off and allows only local framing;
  - installs into other people's projects need approval and never run the project's scripts;
  - paths are checked against real paths;
  - page errors reach the model as data, not instructions.

## New options

- `locale`: language of built-in component text, default `zh-CN`; empty for none.
- `chromePath`: the browser `astryx_screenshot` uses; by default the installed Chrome, Chromium or Edge is found automatically.

## Known limitations

- Windows is untested: `pnpm`, Vite and tsc are launched the Windows way (through `cmd.exe`, or with `node`). The command lines are unit-tested but have not run on Windows.
- The "在 web-review 打开" button is untested with web-review installed.
- All testing was in the DSH web UI (`dev` profile). The DSH desktop app's UI runs on `dsh-app://app`; the preview's CSP allows it, but it is untested in the desktop app.

Full list: [CHANGELOG.md](../CHANGELOG.md).

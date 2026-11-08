# dsh-astryx-studio

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件，让 agent 用 Meta 的 [Astryx](https://github.com/meta/astryx) 设计系统构建页面。它提供结构化的 Astryx 工具、每次写入后跑的验证钩子，以及右侧 Sidebar 里的实时预览 tab。

> **和 [markmini1234/astryx](https://github.com/markmini1234/astryx) 的区别：** 那个项目用 Astryx 给 dsh 界面换主题；本插件为你用 Astryx 构建的页面提供工具、验证和预览，不改 dsh 的主题。

**状态：Day 2。** 工具、验证钩子、prompt section、skill 和实时预览 tab 都已可用。模板画廊还没做。

## 功能

| 工具 | 封装 | 说明 |
|---|---|---|
| `astryx_build(keywords)` | `build()` | 关键词用英文。ranker 没把握时（`basis: fallback` 或无结果）返回全部页面模板让模型自己选，最后兜底 `blank`。 |
| `astryx_template(id, path?)` | `template()` | 默认写到 `src/pages/main/page.tsx`。当前目录不是 Astryx 项目时先经 DSH 审批，再按官方 `apps/example-vite` 的结构建 `./astryx-app` 并安装依赖。模板缺包时自动跑 `installCommand`，并在后台预热 tsc。 |
| `astryx_component(name)` | `component(--dense --zh)` | 改组件前先查 props。 |
| `astryx_search(query, type?, limit?)` | `search()` | |
| `astryx_render(file, out?)` | `render()`（实验） | 导出单文件 HTML。 |

**验证钩子。** 对 Astryx 工作区里 `.ts/.tsx` 的 `write` / `edit` / `apply_patch` / `str_replace_editor` 写入：

- **同步**（毫秒级，随工具结果返回 `astryx verify ✗`）：esbuild 语法检查，加 lint 计数差：一次写入不能让 `<div>`、`style={{}}`、`stylex.create` 的数量增加，也不能新增白名单（`@astryxdesign/*`、`@stylexjs/stylex`、`react`、`react-dom`、`@heroicons/react`、`lucide-react`、`recharts`）以外的 import。已在 `@astryxdesign/cli` 0.7.11 的全部 57 个页面模板上校准到零误报，见 [docs/lint-calibration.md](docs/lint-calibration.md)。
- **异步**：`tsc --noEmit --incremental`，同一工作区同一时刻只跑一个，新的写入会取消正在跑的那次；最新结果在 agent 下一步开头注入（`astryx verify ✓ (tsc 0.6s)` 或 TS 报错）；如果 tsc 还在跑，下一步最多等 `tscStepWaitMs`（5 秒），这样模型改完就收尾时也能收到结论。端到端证据见 [docs/e2e-day1.md](docs/e2e-day1.md)。

**Prompt 和 skill。** 一个内容固定的 prompt section（`build()` 的 playbook 规则加中文工作流），以及 `astryx-page` skill（模板选型表和全部模板清单）。

**预览 tab。** `astryx_template` 写完模板后会自动打开右侧 Sidebar 的 **Astryx 预览**：

- **iframe** 直连 `127.0.0.1` 上的预览 Vite。Vite 经 `ctx.subprocess` 按需启动，崩溃后自动重启一次，插件卸载时一起结束。预览 harness 放在 `<工作区>/.astryx-studio/`（已加入 .gitignore），不改用户自己的 `vite.config`；`server.fs.allow` 只开放 `.astryx-studio/`、`src/` 和 `node_modules/`。
- **工具条**可以在 7 套主题、暗色和三种宽度（桌面 / 平板 / 390）之间切换，不经过模型、不重新编译，刷新后保留；也能在浏览器打开页面或导出单文件 HTML。
- **页脚**显示 Vite 状态和最近一次 verify 结果。
- **页面运行时错误**会显示在 tab 里。只有发生在模型最后一次写入之后的错误，才会在模型下一步注入，同一个错误只注入一次。

截图见 [docs/preview-day2.md](docs/preview-day2.md)。

`@astryxdesign/cli`、`core`、`build`、7 套主题和脚手架锁在同一版本（0.7.11）。

## 安装（开发）

需要 dsh `>=0.2.2-rc.1 <0.3.0`。

```sh
pnpm install && pnpm run build
# 只需一次：把 dev 建成官方 web 模板的副本（单靠 `plugin add` 自动建的
# profile 只有 dsh-base，起不了 Web UI）
dsh --profile dev --from-default-profile web --dump-config > /dev/null
dsh plugin --profile dev add .
dsh --profile dev --no-open
```

预期：工具列表里出现 5 个 `astryx_*` 工具。让模型做一个页面后，会自动打开 **Astryx 预览** tab 显示实时预览。

## 目录

| 路径 | 内容 |
|---|---|
| `src/index.ts` | Host 侧：注册工具、prompt section、skill 和验证钩子 |
| `src/tools.ts`、`src/astryx.ts` | 基于 `@astryxdesign/cli/api` 的 5 个工具 |
| `src/workspace.ts` | 工作区探测和内置 Vite 脚手架 |
| `src/verify/` | esbuild 语法、lint 计数差、tsc 调度、钩子核心 |
| `src/preview/` | `.astryx-studio/` 预览 harness、Vite 生命周期、每个会话的预览状态和运行时错误门控 |
| `src/rpc.ts`、`src/shared/` | client ↔ Host 的 RPC（`/api/astryx-studio/` 下的精确路由）和共享协议 |
| `client/preview-tab.tsx`、`client/store.ts` | 预览 tab、工具条、页脚、持久化的工具条状态 |
| `src/prompt.ts`、`src/generated/catalog.json` | prompt section 和 skill；catalog 在构建时从锁定版本的 CLI 生成 |
| `client/index.tsx` | Web client 侧：`astryx-preview` tab 类型和它的 Body |
| `scripts/build.mjs` | 用 tsdown 构建 `lib/index.js`（ESM）和 `lib/client.js`（ModuleLoader factory） |
| `cordis.patch.yml` | 组合包配置层，插入 `astryx-studio` 这一行 |
| `tests/` | 每个工具和钩子的单测、57 个模板的 lint 校准、client 冒烟测试；`ASTRYX_E2E=1` 跑真实的脚手架 → 模板 → tsc 集成测试 |

`lib/` 随仓库提交，本地 checkout 和 git 安装都不用再跑构建。

## 脚本

`pnpm run typecheck` · `pnpm run build` · `pnpm test` · `pnpm run check`（三者全跑）

## 许可

MIT

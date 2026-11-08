# dsh-astryx-studio

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件，让 agent 用 Meta 的 [Astryx](https://github.com/meta/astryx) 设计系统构建页面。它提供结构化的 Astryx 工具、每次写入后跑的验证钩子，以及右侧 Sidebar 里的实时预览 tab。

> **和 [markmini1234/astryx](https://github.com/markmini1234/astryx) 的区别：** 那个项目用 Astryx 给 dsh 界面换主题；本插件为你用 Astryx 构建的页面提供工具、验证和预览，不改 dsh 的主题。

**状态：Day 0 骨架。** 目前只有一个占位工具 `astryx_ping`、一个空的 prompt section 和一个空的 `astryx-preview` Sidebar tab。真正的工具（`astryx_build` / `template` / `component` / `search` / `render`）、验证钩子和 Vite 预览都还没写。

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

预期：工具列表里出现 `astryx_ping`；右侧 Sidebar 的引导页里出现「Astryx 预览」。

## 目录

| 路径 | 内容 |
|---|---|
| `src/index.ts` | Host 侧：`apply(ctx)` 注册工具和 prompt section |
| `client/index.tsx` | Web client 侧：`astryx-preview` tab 类型和它的 Body |
| `scripts/build.mjs` | 用 tsdown 构建 `lib/index.js`（ESM）和 `lib/client.js`（ModuleLoader factory） |
| `cordis.patch.yml` | 组合包配置层，插入 `astryx-studio` 这一行 |
| `tests/` | Host 单测、client 产物冒烟测试 |

`lib/` 随仓库提交，本地 checkout 和 git 安装都不用再跑构建。

## 脚本

`pnpm run typecheck` · `pnpm run build` · `pnpm test` · `pnpm run check`（三者全跑）

## 许可

MIT

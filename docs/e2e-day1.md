# Day 1 end-to-end evidence

DeepSeek Harness 0.2.2-rc.1 (desktop app CLI), profile `devh` (shipped `headless` template + this plugin, linked), model DeepSeek V4.1 Flash, `--permission-mode workspace-write --approval-policy never`. The cwd was a fresh folder holding this plugin's scaffold with dependencies installed, because headless has no approval UI and the scaffold step asks first.

Task given to the agent:

> 做一个在线课程销售的后台看板，显示营收、订单数和转化率。按 astryx 插件的流程：先 astryx_build，再 astryx_template。然后为了测试验证钩子，用 edit 给页面里第一个 <VStack 加一个错误的 prop：colour="red"。不要自己运行 tsc 或 npm 命令，只根据插件注入的 astryx verify 消息修复，直到收到 astryx verify ✓ 再结束，最后用一句话告诉我验证结果。

## Final run (run 3, after the fixes below)

Tool calls and plugin-injected messages, in session-log order (the `astryx verify` lines are user messages with source `astryx-studio`, read from the persisted session log):

```
CALL    astryx_build     {"keywords":"course sales dashboard revenue orders conversion"} → start: dashboard [closest]
CALL    astryx_template  {"id":"dashboard","path":"src/pages/main/page.tsx"}  (placeholder replaced, recharts/@heroicons installed)
CALL    read
CALL    astryx_component
CALL    write            (dashboard adapted to course sales)
VERIFY  astryx verify ✓ (tsc 0.6s)
CALL    read
CALL    edit             (adds colour="red" to a VStack)
VERIFY  astryx verify ✗ (tsc 0.6s)
        src/pages/main/page.tsx:258 TS2322: Type '{ children: Element[]; gap: 1; colour: string; }' is not assignable to type 'IntrinsicAttributes & VStackProps'.
CALL    edit             (removes it)
VERIFY  astryx verify ✓ (tsc 0.6s)
FINAL   验证结果：故意加入的 `colour="red"` 让插件注入的 astryx verify 报出 TS2322 错误，移除该属性后，验证恢复为 ✓（tsc 0.6s，语法、lint 和类型检查全部通过）。
```

The model ran no bash, tsc or npm command in this run.

## What the earlier runs found (and what changed)

| Run | Problem | Fix |
|---|---|---|
| 1 | `astryx_template` failed with `ERR_FILE_EXISTS` on the scaffold's placeholder page; the model retried with `overwrite: true`. | The untouched placeholder is recognised by content and overwritten without asking. |
| 1 | `vite build` failed: the scaffold imported `@astryxdesign/core/astryx.css`, which does not resolve under `astryxStylex` (it maps core to `src/`, where that file does not exist). | Import removed, matching the official `apps/example-vite`; the integration test now runs `vite build` on a fresh scaffold + template. The prompt tells the model not to add it back. |
| 1 | The lint flagged `node:path` in `vite.config.ts` (the model edited the config while chasing the CSS issue). | Tool configs (`*.config.ts`) are not checked. |
| 2 | No ✓ after the fix: the model's next step started before tsc (0.6 s) finished, and the turn ended. | `agent/pre-step` waits up to `tscStepWaitMs` (5 s) for a tsc run still in flight. Tool results are never delayed. |

Run 1 still showed the full ✓ → ✗ TS2322 → ✓ sequence, because that model happened to spend extra steps between writes.

Raw event streams and decoded session logs for all three runs are kept outside the repo (the shared session notes, `day1-e2e-logs/`).

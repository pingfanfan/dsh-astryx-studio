/**
 * The system-prompt section and the bundled skill. Both are constants built
 * from the build-time catalog, so the prompt bytes never change between turns
 * (DeepSeek prefix cache) and component props reach the context only through
 * astryx_component on demand.
 */
import catalog from './generated/catalog.json' with { type: 'json' }

export const PROMPT_SECTION_NAME = 'astryx-studio'
export const SKILL_NAME = 'astryx-page'

export const PROMPT_TEXT = [
  '# Astryx 页面构建（astryx-studio 插件）',
  '',
  '用户要做网页、页面、后台、看板、落地页，或提到 Astryx 时，用 Astryx 设计系统（React + StyleX）构建，按下面的流程：',
  '',
  '1. 新页面先调 `astryx_build`，关键词用**英文**（把中文需求翻译成 2–8 个英文词）。它返回起始模板和备选；没有好的匹配时会列出全部页面模板，你自己挑，都不合适就用 `blank`。',
  '2. 调 `astryx_template(id, "src/pages/main/page.tsx")` 写入模板。当前目录不是 Astryx 项目时，它会征得用户同意后在 `./astryx-app/` 建项目并安装依赖。',
  '3. 之后的修改只用文件工具（`read` / `edit` / `write` / `apply_patch`），不要用 bash 写文件：文件工具的每次写入都会被验证。',
  '4. 使用或修改一个组件前，先用 `astryx_component(name)` 看它的 props，不要猜 prop 名。',
  '5. 每次写入后会收到 `astryx verify` 结果：✗ 时按报错修复后再继续；✓ 表示语法、lint 和 tsc 都通过。',
  '6. 主题、暗色和预览宽度由预览工具条控制，不要为此改代码，除非用户明确要求写死。',
  '7. 中文文案通常比英文长 30–50%，替换文案后注意别撑破卡片和按钮。',
  '8. 插件建的项目里，`src/main.tsx` 已经包好 `<Theme>` 和 CSS（Vite 下不要加 `@astryxdesign/core/astryx.css`，它在 StyleX 构建里解析不到），只改页面文件。',
  '',
  `Astryx playbook rules (from @astryxdesign/cli ${catalog.cliVersion}):`,
  ...catalog.rules.map((r) => `- ${r}`),
  '',
  `需要模板选型表或 StyleX 模板的注意事项时，加载 \`${SKILL_NAME}\` skill。`,
].join('\n')

const STYLEX_NOTE =
  '有 15 个模板用 `stylex.create`。可以修改已有 stylex 对象里的值，但值必须是静态可分析的字面量（不能来自 props 或变量计算），也不要新增 `stylex.create` 调用：验证钩子会把新增计为违规。'

export const SKILL_CONTENT = [
  '# astryx-page：用 Astryx 模板构建页面',
  '',
  '## 选模板',
  '',
  '先用 `astryx_build` 的英文关键词让 ranker 选；`basis` 为 `direct` 最可靠，`closest` 时看一眼备选，`fallback` 时从下表直接挑。',
  '',
  '| 需求 | 模板 id |',
  '|---|---|',
  '| 数据看板、运营后台首页 | dashboard / dashboard-scorecard / dashboard-cohort-funnel / dashboard-alert-rail |',
  '| 登录、注册 | login / login-card / login-split / login-sso |',
  '| 定价、落地页、营销 | centered-hero / gallery-hero |',
  '| 表格、列表、收件箱 | table / table-page / table-filter / table-inbox / table-grouped |',
  '| 设置页 | settings / settings-sidebar / settings-dialog |',
  '| 表单、多步向导 | form-two-column / form-wizard / form-wizard-vertical / contact-form |',
  '| 文档 | documentation / documentation-technical |',
  '| 聊天、AI 对话 | ai-chat / ai-chat-landing / messaging-shell |',
  '| 看板（Kanban） | kanban-board |',
  '| 详情页 | detail-page / product-detail / work-item-detail |',
  '| 什么都不像 | blank |',
  '',
  '## 全部页面模板',
  '',
  ...catalog.templates.map((t) => `- \`${t.id}\` ${t.name}: ${t.description}`),
  '',
  '## 改模板',
  '',
  '- 保留模板的页面框架、gap 和 padding；替换数据、文案和区块。',
  '- 只读需要改的那一段：大模板（canvas-editor、ide）上千行，先用 read 的行范围定位，再 edit。',
  '- 加区块用已有组件，布局用 VStack/HStack/Grid/Card，不加 `<div>` 和 `style={{}}`。',
  `- ${STYLEX_NOTE}`,
  '- import 只能来自 @astryxdesign/*、@stylexjs/stylex、react、@heroicons/react、lucide-react、recharts。',
  '',
  '## 验证',
  '',
  '- 每次文件工具写入 `.ts/.tsx` 后，同步检查语法和 lint（`<div>` / `style={{}}` / `stylex.create` 数量不得增加、import 白名单），失败时立刻收到 `astryx verify ✗`。',
  '- tsc 在后台跑，结果在下一步开头注入。看到 `TS2322` 一类 prop 错误时，先 `astryx_component` 查 props 再改。',
].join('\n')

export const SKILL_REGISTRATION = {
  name: SKILL_NAME,
  description: '用 Astryx 页面模板构建和修改网页：模板选型表、全部模板清单、改模板的规则和验证说明。',
  whenToUse: '构建或修改 Astryx 页面、挑选页面模板、处理 astryx verify 报错时。',
  source: 'bundled' as const,
  content: SKILL_CONTENT,
}

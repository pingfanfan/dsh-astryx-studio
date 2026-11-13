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
  '8. 插件建的项目里，`src/main.tsx` 已经包好 `<Theme>`、CSS 和 `zh-CN` 的 `InternationalizationProvider`（组件内置文案如必填/可选、日期已是中文，页面里不用再包；Vite 下不要加 `@astryxdesign/core/astryx.css`，它在 StyleX 构建里解析不到），只改页面文件。',
  '9. 要看页面实际长什么样（布局、溢出、中文折行），调 `astryx_screenshot(width)` 截预览，再用 `read_image` 看返回的图片。常用宽度 1440 / 768 / 390。不要自己起浏览器、静态服务器或写截图脚本。',
  '',
  `Astryx playbook rules (from @astryxdesign/cli ${catalog.cliVersion}):`,
  ...catalog.rules.map((r) => `- ${r}`),
  '',
  `需要模板选型表或 StyleX 模板的注意事项时，加载 \`${SKILL_NAME}\` skill。`,
].join('\n')

/** The 15 page templates that call stylex.create (lint calibration, cli 0.7.11). */
export const STYLEX_TEMPLATES = [
  'canvas-editor', 'table-collapsible', 'table-comparison', 'dashboard-comparison', 'dashboard-scorecard',
  'table-filter', 'dashboard-cohort-funnel', 'table-inbox', 'kanban-board', 'dashboard-progress',
  'dashboard-alert-rail', 'settings-dialog', 'shell-top-nav', 'table-tree', 'work-item-detail',
] as const

/** Templates long enough that reading them whole costs tens of thousands of tokens. */
export const LONG_TEMPLATES = [
  ['table-filter', 4632],
  ['canvas-editor', 2876],
  ['table-inbox', 2705],
  ['settings-dialog', 2604],
  ['table-tree', 1705],
  ['dashboard-alert-rail', 1591],
] as const

/** Common Chinese requests → the template to start from. */
export const REQUEST_TABLE: readonly (readonly [string, string])[] = [
  ['数据看板 / 运营后台首页 / 销售看板', 'dashboard'],
  ['KPI 记分卡 / 指标达成', 'dashboard-scorecard'],
  ['转化漏斗 / 留存分析', 'dashboard-cohort-funnel'],
  ['服务监控 / 告警大盘', 'dashboard-alert-rail'],
  ['登录页', 'login（带品牌插图用 login-split，企业 SSO 用 login-sso）'],
  ['产品落地页 / 首页 Hero', 'centered-hero'],
  ['数据表格 / 列表管理', 'table-page（要筛选用 table-filter）'],
  ['收件箱 / 工单列表', 'table-inbox'],
  ['设置页', 'settings（侧边导航用 settings-sidebar）'],
  ['多步表单 / 注册向导', 'form-wizard'],
  ['支付 / 结算', 'payment-form 或 checkout-wizard'],
  ['帮助文档 / API 文档', 'documentation-technical'],
  ['AI 对话 / 聊天', 'ai-chat（空状态首页用 ai-chat-landing）'],
  ['任务看板（Kanban）', 'kanban-board'],
  ['商品详情', 'product-detail'],
  ['什么都不像', 'blank'],
]

export const SKILL_CONTENT = [
  '# astryx-page：用 Astryx 模板构建页面',
  '',
  '## 选模板',
  '',
  '先用 `astryx_build` 的英文关键词让 ranker 选。`basis` 为 `direct` 最可靠；`closest` 时看一眼备选；`fallback` 时从下表或全部模板清单里自己挑。用户在模板画廊里点过的模板，直接用那个 id。',
  '',
  '| 常见中文需求 | 起始模板 |',
  '|---|---|',
  ...REQUEST_TABLE.map(([req, id]) => `| ${req} | ${id} |`),
  '',
  '## 全部页面模板',
  '',
  ...catalog.templates.map((t) => `- \`${t.id}\`（${t.category}）${t.name}: ${t.description}`),
  '',
  '## 改模板',
  '',
  '- 保留模板的页面框架、gap 和 padding；替换数据、文案和区块。',
  '- **中文文案长度**：同样意思的中文通常比英文模板文案长 30–50%。卡片标题、按钮、表头、徽章换成中文后，检查是否折行或撑破；优先用更短的说法，不要靠缩小字号或加 `style={{}}`。',
  `- **超长模板只读相关段落**：${LONG_TEMPLATES.map(([id, n]) => `${id}（${n} 行）`).join('、')} 读全文要几万 token。先 \`read\` 前 80 行看结构和 import，再用行范围只读要改的那一段，用 \`edit\` 精确替换，不要整文件 \`write\`。`,
  `- **StyleX 模板**（15 个：${STYLEX_TEMPLATES.join('、')}）：可以改已有 \`stylex.create\` 对象里的值，但值必须是静态字面量（不能来自 props、变量或运算），也不要新增 \`stylex.create\` 调用，验证钩子会把新增计为违规。`,
  '- 加区块用已有组件，布局用 VStack/HStack/Grid/Card，不加 `<div>` 和 `style={{}}`。',
  '- import 只能来自 @astryxdesign/*、@stylexjs/stylex、react、@heroicons/react、lucide-react、recharts。',
  '',
  '## 验证',
  '',
  '- 每次文件工具写入 `.ts/.tsx` 后，同步检查语法和 lint（`<div>` / `style={{}}` / `stylex.create` 数量不得增加、import 白名单），失败时立刻收到 `astryx verify ✗`。',
  '- tsc 在后台跑，结果在下一步开头注入。看到 `TS2322` 一类 prop 错误时，先 `astryx_component` 查 props 再改。',
  '- 预览里的运行时错误（渲染报错、未捕获异常）也会在下一步注入，修复方式相同。',
  '- 视觉检查：`astryx_screenshot` 用无头 Chrome 按精确宽度截整页（390 就是真 390），等页面渲染完成并关闭入场动画，返回 PNG 路径和页面控制台错误；用 `read_image` 打开路径查看。只在改了布局或用户要求多宽度检查时截图，每个宽度一张即可。',
].join('\n')

export const SKILL_REGISTRATION = {
  name: SKILL_NAME,
  description: '用 Astryx 页面模板构建和修改网页：模板选型表、全部模板清单、改模板的规则和验证说明。',
  whenToUse: '构建或修改 Astryx 页面、挑选页面模板、处理 astryx verify 报错时。',
  source: 'bundled' as const,
  content: SKILL_CONTENT,
}

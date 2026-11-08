import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import { spawn } from "node:child_process";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build, transformSync } from "esbuild";
// src/astryx.ts
/**
* The slice of `@astryxdesign/cli/api` the plugin uses, behind an interface so
* tools can be unit-tested with a fake. The real module is imported lazily:
* the CLI pulls in recast/postcss/jiti, which the host should not pay for at
* boot.
*/
const SEARCH_DOMAINS = [
	"component",
	"hook",
	"doc",
	"template",
	"theme"
];
/** The plugin package root. It depends on @astryxdesign/core, so it is a valid cwd for read-only CLI calls outside any workspace. */
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let cached;
function loadAstryxApi() {
	cached ??= (async () => {
		const api = await import("@astryxdesign/cli/api");
		const experimental = await import("@astryxdesign/cli/api/experimental");
		return {
			build: (q, o) => api.build(q, o),
			template: (n, o) => api.template(n, o),
			component: (n, o) => api.component(n, o),
			search: (q, o) => api.search(q, o),
			render: (f, o) => experimental.render(f, o)
		};
	})();
	return cached;
}
/** Message and code of an AstryxError (or any error), for tool failures the model can act on. */
function describeError(error) {
	if (error instanceof Error) {
		const code = error.code;
		return typeof code === "string" ? `${code}: ${error.message}` : error.message;
	}
	return String(error);
}
// src/config.ts
const Config = Schema.object({
	appDir: Schema.string().default("astryx-app").description("Scaffold folder name under the session cwd."),
	packageManager: Schema.union([
		"auto",
		"pnpm",
		"npm"
	]).default("auto").description("Package manager for scaffold installs."),
	installTimeoutMs: Schema.natural().default(3e5).description("Install timeout (ms)."),
	tscTimeoutMs: Schema.natural().default(3e4).description("tsc --noEmit timeout (ms)."),
	tscStepWaitMs: Schema.natural().default(5e3).description("Max wait (ms) at the next agent step for an in-flight tsc run."),
	maxReportedErrors: Schema.natural().default(5).description("Max findings quoted per verify message.")
});
const DEFAULT_CONFIG = {
	appDir: "astryx-app",
	packageManager: "auto",
	installTimeoutMs: 3e5,
	tscTimeoutMs: 3e4,
	tscStepWaitMs: 5e3,
	maxReportedErrors: 5
};
// src/proc.ts
/** Spawn a process, collect output, honour abort and timeout. Never rejects on a non-zero exit. */
const runProcess = (command, args, options) => new Promise((resolvePromise, reject) => {
	const started = Date.now();
	const child = spawn(command, args, {
		cwd: options.cwd,
		shell: options.shell ?? false,
		env: {
			...process.env,
			CI: "1",
			FORCE_COLOR: "0"
		},
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		]
	});
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	let aborted = false;
	child.stdout.on("data", (d) => stdout += d.toString());
	child.stderr.on("data", (d) => stderr += d.toString());
	const kill = () => {
		if (child.exitCode === null) child.kill("SIGTERM");
	};
	const onAbort = () => {
		aborted = true;
		kill();
	};
	if (options.signal?.aborted) onAbort();
	options.signal?.addEventListener("abort", onAbort, { once: true });
	const timer = options.timeoutMs !== void 0 ? setTimeout(() => {
		timedOut = true;
		kill();
	}, options.timeoutMs) : void 0;
	child.on("error", (error) => {
		if (timer) clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
		reject(error);
	});
	child.on("close", (code) => {
		if (timer) clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
		resolvePromise({
			code,
			stdout,
			stderr,
			timedOut,
			aborted,
			ms: Date.now() - started
		});
	});
});
// src/generated/catalog.json
var cliVersion = "0.7.11";
var rules = [
	"Start every page from a page template. Never lay out a page from scratch.",
	"Changing a page you already have? Keep it. Add blocks and components inside its sections.",
	"Keep the template's page frame, gap, and padding values. Replace its data, copy, and sections.",
	"No <div>/raw HTML for layout — use VStack/HStack/Grid/Stack/Card etc.",
	"No style={{}} — use component props, and design tokens for values.",
	"Wrap the app in <Theme theme={...}> (import {Theme} from '@astryxdesign/core/theme') and import core reset.css + astryx.css."
];
var templates = [
	{
		"id": "ai-chat",
		"name": "AI Chat Conversation",
		"description": "Transcript of alternating turns carrying mixed rich content inline (markdown, code blocks, collapsible tool-call output) beside a resizable artifact panel that holds generated output while the stream keeps scrolling."
	},
	{
		"id": "ai-chat-landing",
		"name": "AI Chat Landing",
		"description": "Zero-state entry surface centered on a single composer with suggestion chips instead of history, sized for the moment before any content exists."
	},
	{
		"id": "dashboard",
		"name": "Analytics Dashboard",
		"description": "Three-band analytics: a row of headline tiles, then charts, then supporting tables, all re-reading from one global filter bar."
	},
	{
		"id": "login",
		"name": "Basic Login",
		"description": "Minimal centered credential form on a plain ground: two fields and a submit, nothing competing for attention."
	},
	{
		"id": "blank",
		"name": "Blank",
		"description": "Bare scaffold: one heading slot, one empty content region, no navigation and no chrome."
	},
	{
		"id": "canvas-editor",
		"name": "Canvas Editor",
		"description": "Layered artboard workspace: document tabs over a layer rail, a fixed-size frame you zoom on a muted backdrop, and an inspector of position, type, and filter fields that retargets to the selected layer."
	},
	{
		"id": "library",
		"name": "Card Grid",
		"description": "Searchable, browsable card grid with filter tabs and a real empty state: uniform tiles organized by topic, narrowing in place, with no detail surface behind them."
	},
	{
		"id": "centered-hero",
		"name": "Centered Hero",
		"description": "Symmetrical centered stack (headline, short blurb, paired call-to-action buttons) resting on one wide full-bleed picture, with nothing on either flank competing."
	},
	{
		"id": "payment-form",
		"name": "Checkout Form",
		"description": "Long sectioned form running beside a summary that stays visible while the fields scroll and recalculates as they change, ending on a terminal confirm of the total."
	},
	{
		"id": "checkout-wizard",
		"name": "Checkout Wizard",
		"description": "Multi-step checkout, cart, order, and payment wizard with a running summary that recalculates as answers change."
	},
	{
		"id": "classic-gallery",
		"name": "Classic Gallery",
		"description": "Uniform grid of equal-ratio media tiles under a centered intro, with filter tabs that narrow the set in place."
	},
	{
		"id": "table-collapsible",
		"name": "Collapsible Table",
		"description": "Several tables on one page, each in a collapsible card with its own columns — for groups that do not share a schema, where one table would stand full of empty cells."
	},
	{
		"id": "table-comparison",
		"name": "Comparison Table",
		"description": "Transposed matrix that puts candidates in the columns and criteria in grouped rows, with a pinned label column that survives horizontal scroll, columns you can swap or add, and best-in-row marks you can toggle."
	},
	{
		"id": "contact-form",
		"name": "Contact Form",
		"description": "Flat single-column form mixing control types (text, pill toggles, dropdowns, long free-text) landing on one full-width submit."
	},
	{
		"id": "dashboard-comparison",
		"name": "Data Dashboard",
		"description": "Comparison-heavy analytics behind a persistent filter bar: tiles that each carry an inline sparkline and several period-over-period deltas, then segmented breakdowns underneath."
	},
	{
		"id": "form-wizard-dialog",
		"name": "Dialog Wizard",
		"description": "Step through a short flow in a dialog, overlay, or popup launched from the page underneath, which stays where it was."
	},
	{
		"id": "documentation",
		"name": "Documentation Catalog",
		"description": "Reference landing that is pure wayfinding: a banner above a grid of category cards linking into sections, with no article content on the surface itself."
	},
	{
		"id": "documentation-design",
		"name": "Documentation Design",
		"description": "Reference article alternating prose with live rendered examples: an interactive preview, a property table, paired do and don't comparisons, and copyable code blocks."
	},
	{
		"id": "documentation-technical",
		"name": "Documentation Technical",
		"description": "Reference article ordered as sequential numbered steps with code at each stage, plus callout cards for prerequisites and onward links."
	},
	{
		"id": "dashboard-scorecard",
		"name": "Executive Summary Dashboard",
		"description": "Report-shaped analytics with a prose rail beside the charts: a scorecard of headline numbers with period deltas and status coloring, goal-attainment bars, a trend grid, and a written commentary column that folds beneath the content when narrow."
	},
	{
		"id": "file-explorer",
		"name": "File Explorer",
		"description": "Hierarchical browser that drills through nested levels as adjacent columns rather than replacing the list each time, with breadcrumb history, switchable list and grid density, and a metadata pane for the selected node."
	},
	{
		"id": "table-filter",
		"name": "Filterable Table",
		"description": "Flat row collection built around progressive filtering: a token bar that escalates into full query syntax, saved views that persist a filter set, column and grouping options, and a resizable detail pane."
	},
	{
		"id": "form-wizard",
		"name": "Form Wizard",
		"description": "Linear multi-step form that moves through one panel at a time, with a horizontal progress track pinned above rather than running down a rail, so every step keeps the full content width for its fields."
	},
	{
		"id": "dashboard-cohort-funnel",
		"name": "Funnel & Cohort Dashboard",
		"description": "Analytics for sequence and retention questions, pairing two shapes a plain dashboard cannot hold: a staged funnel where each step reads as drop-off against the one before, and a two-axis cohort matrix rendered as a heatmap."
	},
	{
		"id": "gallery-hero",
		"name": "Gallery Hero",
		"description": "Centered stack (headline, short blurb, call-to-action buttons) resolving into a multi-image photo grid rather than one wide full-bleed picture, so the imagery reads as a set."
	},
	{
		"id": "table-grouped",
		"name": "Grouped Table",
		"description": "Row collection bundled into collapsible sections with per-group counts, so a long list reads as a handful of blocks that expand and collapse."
	},
	{
		"id": "ide",
		"name": "IDE",
		"description": "Dense multi-pane workspace of resizable, collapsible regions: a hierarchy tree on one flank, tabbed documents in the middle, a docked drawer along the bottom, an inspector opposite."
	},
	{
		"id": "table-inbox",
		"name": "Inbox Table",
		"description": "Two-pane message queue: the table indexes a reading pane rather than being the destination, with a divider you drag to resize."
	},
	{
		"id": "incident-console",
		"name": "Incident Console",
		"description": "Dense row queue with an inspector: severity-coded rows grouped by status, a saved-search filter bar, a segmented status control, and a resizable detail pane for the selected row."
	},
	{
		"id": "form-wizard-inline",
		"name": "Inline Wizard",
		"description": "Accordion wizard stacking every step in one column: the active step expands in place while finished ones collapse to a single line carrying their result and a way back in."
	},
	{
		"id": "kanban-board",
		"name": "Kanban Board",
		"description": "Horizontal lanes of draggable cards where the column itself is the status, so drag and drop between lanes is the state change."
	},
	{
		"id": "login-card",
		"name": "Login Card",
		"description": "Credential form inside an elevated centered card, third-party provider buttons separated from the fields by a divider, secondary sign-up and legal links beneath."
	},
	{
		"id": "login-split",
		"name": "Login Split",
		"description": "Credential form filling one half of a two-pane split, full-bleed media holding the other."
	},
	{
		"id": "login-sso",
		"name": "Login SSO",
		"description": "Progressive credential flow that branches on input: the email domain resolves an identity provider and redirects, with a password path as fallback."
	},
	{
		"id": "messaging-shell",
		"name": "Messaging Shell",
		"description": "Four-column nested navigation narrowing left to right (team workspace, channel list, message stream, thread panel) where each column scopes the next."
	},
	{
		"id": "mixed-gallery",
		"name": "Mixed Gallery",
		"description": "Masonry grid of variable-height tiles that pack against each other instead of cropping to a shared ratio, captioned per tile."
	},
	{
		"id": "detail-page",
		"name": "Order Detail",
		"description": "Single-record detail in two columns: a summary header with status and actions, a repeating line-item list, a totals block that sums it, and a chronological activity timeline in the rail."
	},
	{
		"id": "editor",
		"name": "Page Editor",
		"description": "Three-pane authoring workspace: a source palette on one flank, a live canvas in the middle, and an inspector that retargets to whatever is selected."
	},
	{
		"id": "dashboard-composition",
		"name": "Portfolio Dashboard",
		"description": "Analytics for a value-over-time question: balance and change tiles above a stacked area chart of composition through time, closing on a ranked table of the largest contributors."
	},
	{
		"id": "product-detail",
		"name": "Product Detail",
		"description": "Single-item detail pairing a media gallery with a selection column: variant swatches, a quantity stepper, primary and secondary commit actions, and collapsible specification sections below."
	},
	{
		"id": "product-gallery",
		"name": "Product Gallery",
		"description": "Uniform card grid where every tile carries media, title, supporting line, and a price."
	},
	{
		"id": "dashboard-progress",
		"name": "Project Status Dashboard",
		"description": "Status analytics mixing progress and time-axis shapes: a completion donut, a horizontal timeline of dated bars against a today marker, a per-owner table with progress and status, an at-risk list, and a burndown."
	},
	{
		"id": "table-page",
		"name": "Searchable Table",
		"description": "Flat table of uniform rows under a block of record-level facts, narrowed three ways at once — a full-text search box, a scope toggle, and per-column popovers — with sortable and filterable columns, per-row hover detail, and totals derived from the visible rows that flag themselves as partial while a filter is on."
	},
	{
		"id": "dashboard-alert-rail",
		"name": "Service Monitoring Dashboard",
		"description": "Always-on analytics with a triage rail: status-colored tiles with sparklines, multi-series time charts over a switchable window, and an independently scrolling alert column that folds into the content when narrow."
	},
	{
		"id": "settings-dialog",
		"name": "Settings Dialog",
		"description": "Preferences inside a modal container with searchable section navigation, so configuration happens without leaving whatever is underneath."
	},
	{
		"id": "settings",
		"name": "Settings Form",
		"description": "Preferences as one continuously scrolling form, sections stacked in order with no navigation between them."
	},
	{
		"id": "settings-sidebar",
		"name": "Settings Panels",
		"description": "Preferences split into nav-switched panels: a persistent section list swaps the pane beside it, and rows edit in place rather than opening a separate form."
	},
	{
		"id": "shell-nav",
		"name": "Shell Nav",
		"description": "Application frame combining both navigation axes: a top menu bar with command-palette search over a resizable hierarchy rail, wrapping placeholder content."
	},
	{
		"id": "side-gallery",
		"name": "Side Gallery",
		"description": "Asymmetric split section: a copy column of headline, supporting text, and links held against a clustered image collage opposite."
	},
	{
		"id": "shell-side-nav",
		"name": "Side Nav",
		"description": "Application frame with a single collapsible, resizable left rail carrying grouped history and search, wrapping the main content."
	},
	{
		"id": "table",
		"name": "Simple Table",
		"description": "Flat row collection where columns sort, rows select into a bulk-action toolbar, and each row carries an overflow menu."
	},
	{
		"id": "theme-showcase",
		"name": "Theme Showcase",
		"description": "Several unrelated product surfaces rendered together on one canvas so a token change can be judged across contexts at once."
	},
	{
		"id": "shell-top-nav",
		"name": "Top Nav",
		"description": "Application frame with horizontal navigation only: a centered bar whose items open full-width mega-menu panels, over placeholder content that keeps the entire width."
	},
	{
		"id": "table-tree",
		"name": "Tree Table",
		"description": "Hierarchical table where every parent row rolls up from its children — a code repository whose folders show the newest commit beneath them, beside a detail sidebar and a rendered README."
	},
	{
		"id": "form-two-column",
		"name": "Two-column Form",
		"description": "Form split into two columns beneath a hero header: inputs on one flank, a persistent context panel opposite that stays put while the fields scroll."
	},
	{
		"id": "form-wizard-vertical",
		"name": "Vertical Wizard",
		"description": "Multi-step wizard with the steps in a fixed left rail that stays visible while the form scrolls, plus a side panel whose guidance follows the focused field."
	},
	{
		"id": "work-item-detail",
		"name": "Work Item Detail",
		"description": "Single work-item detail in two columns: a title with a status selector, a description, a subtask checklist with progress, an attachments block, and a comment and activity feed in the main column, plus a property rail with assignee, dates, labels, and linked items."
	}
];
// src/prompt.ts
/**
* The system-prompt section and the bundled skill. Both are constants built
* from the build-time catalog, so the prompt bytes never change between turns
* (DeepSeek prefix cache) and component props reach the context only through
* astryx_component on demand.
*/
const PROMPT_SECTION_NAME = "astryx-studio";
const SKILL_NAME = "astryx-page";
const PROMPT_TEXT = [
	"# Astryx 页面构建（astryx-studio 插件）",
	"",
	"用户要做网页、页面、后台、看板、落地页，或提到 Astryx 时，用 Astryx 设计系统（React + StyleX）构建，按下面的流程：",
	"",
	"1. 新页面先调 `astryx_build`，关键词用**英文**（把中文需求翻译成 2–8 个英文词）。它返回起始模板和备选；没有好的匹配时会列出全部页面模板，你自己挑，都不合适就用 `blank`。",
	"2. 调 `astryx_template(id, \"src/pages/main/page.tsx\")` 写入模板。当前目录不是 Astryx 项目时，它会征得用户同意后在 `./astryx-app/` 建项目并安装依赖。",
	"3. 之后的修改只用文件工具（`read` / `edit` / `write` / `apply_patch`），不要用 bash 写文件：文件工具的每次写入都会被验证。",
	"4. 使用或修改一个组件前，先用 `astryx_component(name)` 看它的 props，不要猜 prop 名。",
	"5. 每次写入后会收到 `astryx verify` 结果：✗ 时按报错修复后再继续；✓ 表示语法、lint 和 tsc 都通过。",
	"6. 主题、暗色和预览宽度由预览工具条控制，不要为此改代码，除非用户明确要求写死。",
	"7. 中文文案通常比英文长 30–50%，替换文案后注意别撑破卡片和按钮。",
	"8. 插件建的项目里，`src/main.tsx` 已经包好 `<Theme>` 和 CSS（Vite 下不要加 `@astryxdesign/core/astryx.css`，它在 StyleX 构建里解析不到），只改页面文件。",
	"",
	`Astryx playbook rules (from @astryxdesign/cli ${cliVersion}):`,
	...rules.map((r) => `- ${r}`),
	"",
	`需要模板选型表或 StyleX 模板的注意事项时，加载 \`${SKILL_NAME}\` skill。`
].join("\n");
const STYLEX_NOTE = "有 15 个模板用 `stylex.create`。可以修改已有 stylex 对象里的值，但值必须是静态可分析的字面量（不能来自 props 或变量计算），也不要新增 `stylex.create` 调用：验证钩子会把新增计为违规。";
const SKILL_REGISTRATION = {
	name: SKILL_NAME,
	description: "用 Astryx 页面模板构建和修改网页：模板选型表、全部模板清单、改模板的规则和验证说明。",
	whenToUse: "构建或修改 Astryx 页面、挑选页面模板、处理 astryx verify 报错时。",
	source: "bundled",
	content: [
		"# astryx-page：用 Astryx 模板构建页面",
		"",
		"## 选模板",
		"",
		"先用 `astryx_build` 的英文关键词让 ranker 选；`basis` 为 `direct` 最可靠，`closest` 时看一眼备选，`fallback` 时从下表直接挑。",
		"",
		"| 需求 | 模板 id |",
		"|---|---|",
		"| 数据看板、运营后台首页 | dashboard / dashboard-scorecard / dashboard-cohort-funnel / dashboard-alert-rail |",
		"| 登录、注册 | login / login-card / login-split / login-sso |",
		"| 定价、落地页、营销 | centered-hero / gallery-hero |",
		"| 表格、列表、收件箱 | table / table-page / table-filter / table-inbox / table-grouped |",
		"| 设置页 | settings / settings-sidebar / settings-dialog |",
		"| 表单、多步向导 | form-two-column / form-wizard / form-wizard-vertical / contact-form |",
		"| 文档 | documentation / documentation-technical |",
		"| 聊天、AI 对话 | ai-chat / ai-chat-landing / messaging-shell |",
		"| 看板（Kanban） | kanban-board |",
		"| 详情页 | detail-page / product-detail / work-item-detail |",
		"| 什么都不像 | blank |",
		"",
		"## 全部页面模板",
		"",
		...templates.map((t) => `- \`${t.id}\` ${t.name}: ${t.description}`),
		"",
		"## 改模板",
		"",
		"- 保留模板的页面框架、gap 和 padding；替换数据、文案和区块。",
		"- 只读需要改的那一段：大模板（canvas-editor、ide）上千行，先用 read 的行范围定位，再 edit。",
		"- 加区块用已有组件，布局用 VStack/HStack/Grid/Card，不加 `<div>` 和 `style={{}}`。",
		`- ${STYLEX_NOTE}`,
		"- import 只能来自 @astryxdesign/*、@stylexjs/stylex、react、@heroicons/react、lucide-react、recharts。",
		"",
		"## 验证",
		"",
		"- 每次文件工具写入 `.ts/.tsx` 后，同步检查语法和 lint（`<div>` / `style={{}}` / `stylex.create` 数量不得增加、import 白名单），失败时立刻收到 `astryx verify ✗`。",
		"- tsc 在后台跑，结果在下一步开头注入。看到 `TS2322` 一类 prop 错误时，先 `astryx_component` 查 props 再改。"
	].join("\n")
};
// src/workspace.ts
/**
* Astryx workspace detection and the built-in scaffold.
*
* `astryx init` is not a scaffolder (it only adds agents / theme / template
* files to an existing project), so the plugin carries a project shaped like
* the official apps/example-vite, pinned to the CLI's own version.
*/
const ASTRYX_VERSION = cliVersion;
/** True when `dir/package.json` depends on @astryxdesign/core. */
function isAstryxProject(dir) {
	const file = join(dir, "package.json");
	if (!existsSync(file)) return false;
	try {
		const pkg = JSON.parse(readFileSync(file, "utf8"));
		return [
			"dependencies",
			"devDependencies",
			"peerDependencies"
		].some((k) => pkg[k]?.["@astryxdesign/core"] !== void 0);
	} catch {
		return false;
	}
}
/** The Astryx workspace for a session cwd: cwd itself, else `cwd/<appDir>`, else none. */
function detectWorkspace(cwd, appDir) {
	if (isAstryxProject(cwd)) return cwd;
	const app = join(cwd, appDir);
	return isAstryxProject(app) ? app : void 0;
}
/** Whether `file` lies inside `dir` (both absolute). */
function isInside(dir, file) {
	const rel = relative(dir, file);
	return rel === "" || !rel.startsWith("..") && !isAbsolute(rel) && !rel.startsWith(`..${sep}`);
}
/** Resolve a model-supplied path against the workspace and refuse anything outside it. */
function resolveInside(workspace, path) {
	const abs = resolve(workspace, path);
	if (!isInside(workspace, abs)) throw new Error(`path ${path} is outside the Astryx workspace ${workspace}`);
	return abs;
}
const PLACEHOLDER_PAGE = "src/pages/main/page.tsx";
const PLACEHOLDER_SOURCE = [
	"// astryx-studio placeholder: astryx_template replaces this file.",
	"import {VStack} from '@astryxdesign/core/Layout';",
	"import {Heading, Text} from '@astryxdesign/core/Text';",
	"",
	"export default function Page() {",
	"  return (",
	"    <VStack gap={2}>",
	"      <Heading level={1}>Astryx</Heading>",
	"      <Text type=\"body\">Replace this page with astryx_template.</Text>",
	"    </VStack>",
	"  );",
	"}",
	""
].join("\n");
/** True when `file` is still the untouched scaffold placeholder (safe to overwrite without asking). */
function isPlaceholder(file) {
	try {
		return readFileSync(file, "utf8") === PLACEHOLDER_SOURCE;
	} catch {
		return false;
	}
}
function scaffoldFiles(name) {
	const v = ASTRYX_VERSION;
	return {
		"package.json": JSON.stringify({
			name,
			private: true,
			type: "module",
			scripts: {
				dev: "vite",
				build: "vite build",
				typecheck: "tsc --noEmit"
			},
			dependencies: {
				"@astryxdesign/core": v,
				"@astryxdesign/theme-neutral": v,
				"@stylexjs/stylex": "^0.19.0",
				react: "^19.2.7",
				"react-dom": "^19.2.7"
			},
			devDependencies: {
				"@astryxdesign/build": v,
				"@astryxdesign/cli": v,
				"@stylexjs/unplugin": "^0.19.0",
				"@types/react": "^19.2.17",
				"@types/react-dom": "^19.2.3",
				"@vitejs/plugin-react": "^5.2.0",
				typescript: "^6.0.3",
				vite: "^8.1.3"
			},
			browserslist: ["last 1 Chrome version"]
		}, null, 2) + "\n",
		"tsconfig.json": JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				lib: [
					"ES2022",
					"DOM",
					"DOM.Iterable"
				],
				module: "ESNext",
				moduleResolution: "bundler",
				jsx: "react-jsx",
				strict: true,
				skipLibCheck: true,
				noEmit: true,
				allowImportingTsExtensions: true,
				moduleDetection: "force",
				types: ["vite/client"]
			},
			include: ["src"]
		}, null, 2) + "\n",
		".gitignore": "node_modules\ndist\n.astryx-studio\n",
		"vite.config.ts": [
			"import {defineConfig} from 'vite';",
			"import react from '@vitejs/plugin-react';",
			"import {astryxStylex} from '@astryxdesign/build/vite';",
			"",
			"export default defineConfig({",
			"  plugins: [...astryxStylex(), react()],",
			"  server: {host: '127.0.0.1'},",
			"});",
			""
		].join("\n"),
		"index.html": [
			"<!doctype html>",
			"<html lang=\"zh\">",
			"  <head>",
			"    <meta charset=\"UTF-8\" />",
			"    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
			`    <title>${name}</title>`,
			"  </head>",
			"  <body>",
			"    <div id=\"root\"></div>",
			"    <script type=\"module\" src=\"/src/main.tsx\"><\/script>",
			"  </body>",
			"</html>",
			""
		].join("\n"),
		"src/index.css": "/* Lets Vite emit a CSS asset for StyleX aggregation. */\n:root {\n  --stylex-injection: 0;\n}\n",
		"src/main.tsx": [
			"import {StrictMode} from 'react';",
			"import {createRoot} from 'react-dom/client';",
			"import {Theme} from '@astryxdesign/core/theme';",
			"import {neutralTheme} from '@astryxdesign/theme-neutral/built';",
			"import '@astryxdesign/core/reset.css';",
			"import '@astryxdesign/theme-neutral/theme.css';",
			"import './index.css';",
			"import Page from './pages/main/page';",
			"",
			"createRoot(document.getElementById('root')!).render(",
			"  <StrictMode>",
			"    <Theme theme={neutralTheme}>",
			"      <Page />",
			"    </Theme>",
			"  </StrictMode>,",
			");",
			""
		].join("\n"),
		[PLACEHOLDER_PAGE]: PLACEHOLDER_SOURCE,
		"src/vite-env.d.ts": "/// <reference types=\"vite/client\" />\n"
	};
}
async function pickPackageManager(preference, run, cwd) {
	if (preference !== "auto") return preference;
	try {
		return (await run("pnpm", ["--version"], {
			cwd,
			timeoutMs: 1e4
		})).code === 0 ? "pnpm" : "npm";
	} catch {
		return "npm";
	}
}
/** Write the scaffold into `dir` (must not already be a project) and install it. */
async function scaffold(dir, options) {
	if (existsSync(join(dir, "package.json"))) throw new Error(`${dir} already has a package.json that does not depend on @astryxdesign/core; refusing to overwrite it`);
	const files = scaffoldFiles(dir.split(sep).pop() || "astryx-app");
	for (const [rel, text] of Object.entries(files)) {
		const file = join(dir, rel);
		mkdirSync(resolve(file, ".."), { recursive: true });
		writeFileSync(file, text);
	}
	const pm = await pickPackageManager(options.packageManager, options.run, dir);
	return {
		dir,
		packageManager: pm,
		install: await options.run(pm, ["install"], {
			cwd: dir,
			timeoutMs: options.timeoutMs,
			signal: options.signal
		})
	};
}
// src/tools.ts
/**
* The five Astryx tools: thin wrappers over @astryxdesign/cli/api.
* Each returns a canonical JSON value (for PTC callers) and renders a compact
* text view for the model.
*/
const TOOL_NAMES = {
	build: "astryx_build",
	template: "astryx_template",
	component: "astryx_component",
	search: "astryx_search",
	render: "astryx_render"
};
const json = (v) => JSON.parse(JSON.stringify(v ?? null));
const text = (t) => [{
	type: "text",
	text: t
}];
/** CLI cwd for read-only calls: the workspace if there is one, else the session cwd if it is a project, else the plugin root (which ships @astryxdesign/core). */
async function readCwd(env, exec) {
	const cwd = await env.cwdOf(exec);
	if (cwd) {
		const ws = detectWorkspace(cwd, env.config.appDir);
		if (ws) return ws;
	}
	return PLUGIN_ROOT;
}
async function call(what, fn) {
	try {
		return await fn();
	} catch (error) {
		throw new Error(`${what} failed: ${describeError(error)}`);
	}
}
function shapeBuild(keywords, data) {
	const start = data.start ?? null;
	const hasResults = data.hasResults === true;
	const names = (key) => (data[key] ?? []).map((e) => e.name).filter((n) => !!n);
	const basis = start ? start.basis : "none";
	const value = {
		keywords,
		basis,
		start: start ? {
			name: start.name,
			displayName: start.displayName,
			description: start.description,
			reason: start.reason
		} : null,
		alternatives: (start?.alternatives ?? []).map((a) => ({
			name: a.name,
			displayName: a.displayName,
			description: a.description
		})),
		notes: start?.notes ?? [],
		blocks: names("blocks"),
		components: names("domain"),
		frame: data.frame ?? [],
		foundation: data.foundation ?? []
	};
	if (!start || basis === "fallback" || !hasResults) {
		value.catalog = templates.map((t) => ({
			id: t.id,
			description: t.description
		}));
		value.fallbackTemplate = "blank";
	}
	return value;
}
function renderBuild(v) {
	const lines = [];
	if (v.start) {
		lines.push(`start: ${v.start.name} (${v.start.displayName}) [${v.basis}] — ${v.start.description}`);
		lines.push(`why: ${v.start.reason}`);
	} else lines.push("start: none");
	for (const a of v.alternatives) lines.push(`alternative: ${a.name} (${a.displayName}) — ${a.description}`);
	for (const n of v.notes) lines.push(`note: ${n}`);
	if (v.blocks.length) lines.push(`blocks: ${v.blocks.join(", ")}`);
	if (v.components.length) lines.push(`components: ${v.components.join(", ")}`);
	if (v.frame.length) lines.push(`frame: ${v.frame.join(", ")}`);
	if (v.foundation.length) lines.push(`foundation: ${v.foundation.join(", ")}`);
	if (v.catalog) {
		lines.push("", "The ranker had no strong match. Pick the closest page template yourself from this list; if none fits, use `blank`:");
		for (const t of v.catalog) lines.push(`- ${t.id}: ${t.description}`);
	}
	lines.push("", "Next: astryx_template(id, \"src/pages/main/page.tsx\").");
	return lines.join("\n");
}
function createTools(env) {
	return [
		defineTool({
			name: TOOL_NAMES.build,
			description: "Find the Astryx page template to start from, plus the blocks and components around it. Call this first for any new page. Pass short ENGLISH keywords describing the page (translate Chinese requests), e.g. \"course sales dashboard revenue orders\". When the ranker has no good match the result lists every page template so you can choose.",
			parameters: { keywords: {
				type: "string",
				required: true,
				description: "English keywords for the page, 2–8 words."
			} },
			output: {
				schema: { type: "json" },
				render: (_a, v) => text(renderBuild(v))
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const keywords = args.keywords.trim();
				if (!keywords) throw new Error("keywords must not be empty");
				const cwd = await readCwd(env, exec);
				const api = await env.api();
				const r = await call("astryx build", () => api.build(keywords, { cwd }));
				if (r.type !== "build.kit") throw new Error(`astryx build returned ${r.type}, expected build.kit`);
				return json(shapeBuild(keywords, r.data));
			}
		}),
		defineTool({
			name: TOOL_NAMES.template,
			description: "Write an Astryx page template into the workspace as the starting point of a page. If the session folder is not an Astryx project, first creates one in ./" + env.config.appDir + " (asks the user). Installs any packages the template needs. Default path: src/pages/main/page.tsx.",
			parameters: {
				id: {
					type: "string",
					required: true,
					description: "Template id from astryx_build, e.g. \"dashboard\"."
				},
				path: {
					type: "string",
					description: "File path inside the workspace. Default src/pages/main/page.tsx."
				},
				overwrite: {
					type: "boolean",
					description: "Replace an existing file. Default false."
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, raw) => {
					const v = raw;
					return text([
						`wrote template ${v.template} to ${v.file} (workspace ${v.workspace})`,
						...v.scaffolded ? ["created a new Astryx project for this workspace"] : [],
						...v.installed.length ? [`installed: ${v.installed.join(", ")}`] : [],
						...v.notes.map((n) => `note: ${n}`),
						"Next: read the file, then adapt it with edit. Keep its frame, gap and padding; replace data and copy."
					].join("\n"));
				}
			},
			timeoutMs: env.config.installTimeoutMs * 2,
			async execute(args, exec) {
				const id = args.id.trim();
				if (!id) throw new Error("id must not be empty");
				const cwd = await env.cwdOf(exec);
				if (!cwd) throw new Error("astryx_template needs a session working directory");
				let workspace = detectWorkspace(cwd, env.config.appDir);
				let scaffolded = false;
				if (!workspace) {
					const dir = resolveInside(cwd, env.config.appDir);
					const s = await scaffold(dir, {
						run: env.run,
						packageManager: env.config.packageManager,
						timeoutMs: env.config.installTimeoutMs,
						signal: exec.signal
					});
					if (s.install.code !== 0) throw new Error(`${s.packageManager} install in ${dir} failed:\n${(s.install.stderr || s.install.stdout).slice(-1500)}`);
					workspace = dir;
					scaffolded = true;
				}
				const target = resolveInside(workspace, args.path ?? "src/pages/main/page.tsx");
				const targetPath = relative(workspace, target);
				const api = await env.api();
				const ws = workspace;
				const overwrite = args.overwrite === true || isPlaceholder(target);
				const data = (await call("astryx template", () => api.template(id, {
					cwd: ws,
					targetPath,
					overwrite
				}))).data ?? {};
				const installed = [];
				if (data.missingPackages?.length && data.installCommand) {
					const ir = await env.run(data.installCommand, [], {
						cwd: workspace,
						shell: true,
						signal: exec.signal,
						timeoutMs: env.config.installTimeoutMs
					});
					if (ir.code !== 0) throw new Error(`template written, but "${data.installCommand}" failed:\n${(ir.stderr || ir.stdout).slice(-1500)}`);
					installed.push(...data.missingPackages);
				}
				env.tsc.schedule(workspace);
				const value = {
					template: id,
					file: targetPath,
					workspace,
					scaffolded,
					installed,
					notes: (data.notes ?? []).filter((n) => !/^Install missing dependencies/.test(n) || installed.length === 0)
				};
				return json(value);
			}
		}),
		defineTool({
			name: TOOL_NAMES.component,
			description: "Read an Astryx component: its props, defaults and usage rules (dense, Chinese where available). Call it before using or changing a component you have not checked in this conversation.",
			parameters: { name: {
				type: "string",
				required: true,
				description: "Component name, e.g. \"FunnelChart\" or \"Button\"."
			} },
			output: {
				schema: { type: "json" },
				render: (_a, v) => text(JSON.stringify(v))
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const name = args.name.trim();
				if (!name) throw new Error("name must not be empty");
				const cwd = await readCwd(env, exec);
				const api = await env.api();
				const r = await call("astryx component", () => api.component(name, {
					cwd,
					dense: true,
					zh: true
				}));
				return json(r.data);
			}
		}),
		defineTool({
			name: TOOL_NAMES.search,
			description: "Search Astryx components, hooks, docs, templates and themes by English keywords.",
			parameters: {
				query: {
					type: "string",
					required: true,
					description: "English search words."
				},
				type: {
					type: "string",
					enum: [...SEARCH_DOMAINS],
					description: "Restrict to one domain."
				},
				limit: {
					type: "integer",
					description: "Max results (default 10)."
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, raw) => {
					const rows = (raw.results ?? []).map((r) => `- [${r.domain}] ${r.name}${r.import ? ` (${r.import})` : ""}: ${r.description ?? ""}`);
					return text(rows.length ? rows.join("\n") : "no results");
				}
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const query = args.query.trim();
				if (!query) throw new Error("query must not be empty");
				const cwd = await readCwd(env, exec);
				const api = await env.api();
				const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
				const type = args.type;
				const data = (await call("astryx search", () => api.search(query, {
					cwd,
					limit,
					...type ? { type } : {}
				}))).data;
				return json({
					query: data.query ?? query,
					matchCount: data.matchCount ?? 0,
					results: (data.results ?? []).slice(0, limit)
				});
			}
		}),
		defineTool({
			name: TOOL_NAMES.render,
			description: "Export an Astryx page module to one self-contained HTML file (experimental). Use only when the user asks for an HTML export.",
			parameters: {
				file: {
					type: "string",
					required: true,
					description: "Page module path inside the workspace."
				},
				out: {
					type: "string",
					description: "Output .html path inside the workspace. Default next to the page."
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, raw) => {
					const v = raw;
					return text([`wrote ${v.output} (${v.bytes ?? 0} bytes)`, ...(v.warnings ?? []).map((w) => `warning ${w.code}: ${w.message}`)].join("\n"));
				}
			},
			async execute(args, exec) {
				const cwd = await env.cwdOf(exec);
				const workspace = cwd ? detectWorkspace(cwd, env.config.appDir) : void 0;
				if (!workspace) throw new Error("no Astryx workspace here; create a page with astryx_template first");
				const file = relative(workspace, resolveInside(workspace, args.file));
				const out = args.out ? relative(workspace, resolveInside(workspace, args.out)) : void 0;
				const api = await env.api();
				const r = await call("astryx render", () => api.render(file, {
					cwd: workspace,
					overwrite: true,
					...out ? { out } : {}
				}));
				return json(r.data);
			}
		})
	];
}
// src/verify/tsc.ts
/**
* Asynchronous `tsc --noEmit --incremental` per workspace. One run at a time
* per workspace; a new request aborts the one in flight, and an aborted run
* reports nothing. Only the newest completed result is kept for injection.
*/
const DIAG_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
function parseTscOutput(output, workspace) {
	const out = [];
	for (const raw of output.split(/\r?\n/)) {
		const m = DIAG_RE.exec(raw.trim());
		if (!m) continue;
		const file = m[1];
		out.push({
			file: file.startsWith("/") ? relative(workspace, file) : file,
			line: Number(m[2]),
			column: Number(m[3]),
			code: m[4],
			message: m[5]
		});
	}
	return out;
}
function tscArgs(workspace) {
	const local = join(workspace, "node_modules", ".bin", "tsc");
	const project = existsSync(join(workspace, "tsconfig.app.json")) ? "tsconfig.app.json" : "tsconfig.json";
	return {
		command: existsSync(local) ? local : "tsc",
		args: [
			"--noEmit",
			"--incremental",
			"--tsBuildInfoFile",
			join(".astryx-studio", "tsbuildinfo"),
			"--pretty",
			"false",
			"-p",
			project
		]
	};
}
function createTscScheduler(options) {
	const inflight = /* @__PURE__ */ new Map();
	const running = /* @__PURE__ */ new Map();
	const results = /* @__PURE__ */ new Map();
	return {
		schedule(workspace) {
			const p = runOnce(workspace);
			running.set(workspace, p);
			p.finally(() => {
				if (running.get(workspace) === p) running.delete(workspace);
			});
			return p;
		},
		take(workspace) {
			const r = results.get(workspace);
			results.delete(workspace);
			return r;
		},
		inflight(workspace) {
			return running.get(workspace);
		},
		dispose() {
			for (const c of inflight.values()) c.abort();
			inflight.clear();
			running.clear();
			results.clear();
		}
	};
	async function runOnce(workspace) {
		{
			inflight.get(workspace)?.abort();
			const controller = new AbortController();
			inflight.set(workspace, controller);
			results.delete(workspace);
			mkdirSync(join(workspace, ".astryx-studio"), { recursive: true });
			const { command, args } = tscArgs(workspace);
			let outcome;
			try {
				const r = await options.run(command, args, {
					cwd: workspace,
					signal: controller.signal,
					timeoutMs: options.timeoutMs
				});
				if (r.aborted || controller.signal.aborted) return void 0;
				if (r.timedOut) outcome = {
					kind: "unverified",
					ms: r.ms,
					reason: `tsc exceeded ${options.timeoutMs} ms`
				};
				else if (r.code === 0) outcome = {
					kind: "pass",
					ms: r.ms
				};
				else {
					const diagnostics = parseTscOutput(r.stdout + "\n" + r.stderr, workspace);
					outcome = diagnostics.length > 0 ? {
						kind: "fail",
						ms: r.ms,
						diagnostics
					} : {
						kind: "unverified",
						ms: r.ms,
						reason: (r.stderr || r.stdout).trim().slice(0, 300) || `tsc exited ${r.code}`
					};
				}
			} catch (error) {
				if (controller.signal.aborted) return void 0;
				outcome = {
					kind: "unverified",
					ms: 0,
					reason: error instanceof Error ? error.message : String(error)
				};
			}
			if (inflight.get(workspace) !== controller) return void 0;
			inflight.delete(workspace);
			results.set(workspace, outcome);
			return outcome;
		}
	}
}
// src/verify/lint.ts
/** Package roots a page may import. Calibrated against all page templates of the pinned CLI (see docs/lint-calibration.md). */
const IMPORT_WHITELIST = [
	"@astryxdesign/*",
	"@stylexjs/stylex",
	"react",
	"react-dom",
	"@heroicons/react",
	"lucide-react",
	"recharts"
];
const COUNTERS = {
	div: /<div\b/g,
	inlineStyle: /\bstyle=\{\s*\{/g,
	stylexCreate: /\bstylex\s*\.\s*create\s*\(/g
};
const LABEL = {
	div: "<div>",
	inlineStyle: "style={{}}",
	stylexCreate: "stylex.create"
};
const HINT = {
	div: "use VStack/HStack/Grid/Stack/Card instead of <div> for layout",
	inlineStyle: "use component props and design tokens instead of style={{}}",
	stylexCreate: "reuse the existing stylex.create object or component props instead of adding another"
};
function countLint(source) {
	const n = (re) => source.match(re)?.length ?? 0;
	return {
		div: n(COUNTERS.div),
		inlineStyle: n(COUNTERS.inlineStyle),
		stylexCreate: n(COUNTERS.stylexCreate)
	};
}
/**
* Bare module specifiers `source` really imports (static, dynamic and
* re-exports; relative imports excluded). esbuild parses the file, so import
* statements inside strings or comments (code samples in templates) do not
* count. Unparseable source yields [] (the syntax check reports it).
*/
async function importSpecifiers(source, file = "page.tsx") {
	const found = [];
	const collector = {
		name: "astryx-import-collector",
		setup(b) {
			b.onResolve({ filter: /.*/ }, (args) => {
				if (args.kind === "entry-point") return void 0;
				if (!args.path.startsWith(".") && !args.path.startsWith("/")) found.push(args.path);
				return {
					path: args.path,
					external: true
				};
			});
		}
	};
	try {
		await build({
			stdin: {
				contents: source,
				loader: file.endsWith(".tsx") ? "tsx" : "ts",
				sourcefile: file,
				resolveDir: "/"
			},
			bundle: true,
			write: false,
			format: "esm",
			platform: "neutral",
			logLevel: "silent",
			jsx: "automatic",
			tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
			plugins: [collector]
		});
	} catch {
		return [];
	}
	return found;
}
/** `@scope/name` or `name` of a specifier. */
function packageRoot(spec) {
	const parts = spec.split("/");
	return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? spec;
}
function isWhitelisted(spec, whitelist = IMPORT_WHITELIST) {
	const root = packageRoot(spec);
	return whitelist.some((w) => w.endsWith("/*") ? root.startsWith(w.slice(0, -1)) : root === w);
}
/** Findings introduced by going from `before` to `after` (`before` is '' for a new file). */
async function lintDiff(before, after, whitelist = IMPORT_WHITELIST, file = "page.tsx") {
	const findings = [];
	const a = countLint(before);
	const b = countLint(after);
	for (const key of Object.keys(COUNTERS)) if (b[key] > a[key]) findings.push({
		rule: key,
		message: `${LABEL[key]} count ${a[key]} → ${b[key]}: ${HINT[key]}`
	});
	const had = new Set((await importSpecifiers(before, file)).map(packageRoot));
	const added = /* @__PURE__ */ new Set();
	for (const spec of await importSpecifiers(after, file)) {
		const root = packageRoot(spec);
		if (had.has(root) || added.has(root) || isWhitelisted(spec, whitelist)) continue;
		added.add(root);
		findings.push({
			rule: "import",
			message: `import of ${root} is not allowed in an Astryx page (allowed: ${whitelist.join(", ")})`
		});
	}
	return findings;
}
// src/verify/syntax.ts
/** Millisecond syntax check: parse only, no type information. */
function checkSyntax(source, file) {
	const loader = file.endsWith(".tsx") ? "tsx" : "ts";
	try {
		transformSync(source, {
			loader,
			sourcefile: file,
			logLevel: "silent",
			jsx: "automatic"
		});
		return [];
	} catch (error) {
		const errors = error.errors;
		if (!Array.isArray(errors)) return [{
			line: 0,
			column: 0,
			message: String(error)
		}];
		return errors.map((e) => ({
			line: e.location?.line ?? 0,
			column: e.location?.column ?? 0,
			message: e.text
		}));
	}
}
// src/verify/verifier.ts
/**
* Framework-free core of the verify hook. `index.ts` wires it to
* `tools/pre-execute`, `tools/post-execute` and `agent/pre-step`.
*
* - before a file tool runs: snapshot the files it names (by call id);
* - after it runs: for every written .ts/.tsx inside the Astryx workspace,
*   run the esbuild syntax check and the lint count-diff synchronously, and
*   start tsc in the background;
* - at the agent's next step: hand over the newest tsc result.
*/
const FILE_TOOLS = [
	"write",
	"edit",
	"apply_patch",
	"str_replace_editor"
];
function isFileTool(name) {
	return FILE_TOOLS.includes(name);
}
const PATCH_PATH_RE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
/** Paths a file tool call names in its arguments (unresolved). */
function pathsFromArgs(name, args) {
	const a = args ?? {};
	if (name === "write" || name === "edit") return typeof a.file_path === "string" ? [a.file_path] : [];
	if (name === "str_replace_editor") return typeof a.path === "string" ? [a.path] : [];
	if (name === "apply_patch" && typeof a.input === "string") return [...a.input.matchAll(PATCH_PATH_RE)].map((m) => m[1].trim());
	return [];
}
/** Absolute paths a file tool's result says it wrote. */
function pathsFromValue(name, value, cwd) {
	const v = value ?? {};
	const abs = (p) => cwd ? resolve(cwd, p) : resolve(p);
	if (name === "apply_patch" && Array.isArray(v.operations)) {
		const out = [];
		for (const op of v.operations) {
			if (op.kind === "delete") continue;
			const p = typeof op.destination === "string" ? op.destination : op.path;
			if (typeof p === "string") out.push(abs(p));
		}
		return out;
	}
	return typeof v.path === "string" ? [abs(v.path)] : [];
}
/** Page and component sources only: not declarations, not tool configs such as vite.config.ts. */
function isCheckedFile(workspace, file) {
	return /\.tsx?$/.test(file) && !file.endsWith(".d.ts") && !/\.config\.[cm]?tsx?$/.test(file) && isInside(workspace, file) && !relative(workspace, file).split(/[\\/]/).some((seg) => seg === "node_modules" || seg === ".astryx-studio");
}
const defaultRead = (file) => existsSync(file) ? readFileSync(file, "utf8") : void 0;
var Verifier = class {
	deps;
	snapshots = /* @__PURE__ */ new Map();
	/** Workspace each agent last wrote into, so its next step knows whose tsc result to collect. */
	agentWorkspace = /* @__PURE__ */ new Map();
	read;
	constructor(deps) {
		this.deps = deps;
		this.read = deps.readFile ?? defaultRead;
	}
	/** Before a file tool runs: remember the current contents of the files it names. */
	snapshot(callId, name, args, cwd) {
		if (!isFileTool(name)) return;
		const files = /* @__PURE__ */ new Map();
		for (const p of pathsFromArgs(name, args)) {
			const abs = cwd ? resolve(cwd, p) : resolve(p);
			files.set(abs, this.read(abs) ?? "");
		}
		this.snapshots.set(callId, files);
	}
	/** Drop a snapshot (call denied or failed). */
	forget(callId) {
		this.snapshots.delete(callId);
	}
	/**
	* After a file tool succeeded. Returns the synchronous findings per checked
	* file (empty when everything passed or nothing was in scope) and starts tsc.
	*/
	async afterWrite(input) {
		const before = this.snapshots.get(input.callId) ?? /* @__PURE__ */ new Map();
		this.snapshots.delete(input.callId);
		const { workspace } = input;
		if (!workspace || !isFileTool(input.name)) return [];
		const files = pathsFromValue(input.name, input.value, input.cwd).filter((f) => isCheckedFile(workspace, f));
		if (files.length === 0) return [];
		const reports = [];
		for (const file of files) {
			const after = this.read(file);
			if (after === void 0) continue;
			const syntax = checkSyntax(after, file);
			const lint = await lintDiff(before.get(file) ?? "", after, void 0, file);
			if (syntax.length > 0 || lint.length > 0) reports.push({
				file: relative(workspace, file),
				syntax,
				lint
			});
		}
		if (input.agentId) this.agentWorkspace.set(input.agentId, workspace);
		this.deps.tsc.schedule(workspace);
		return reports;
	}
	/**
	* At the agent's next step: the newest tsc outcome for the workspace it last
	* wrote to. If a run is still in flight, wait for it up to `waitMs` (an
	* incremental run takes ~0.5–3 s), so a model that moves fast or ends its
	* turn right after an edit still sees the verdict. Never throws.
	*/
	async collect(agentId, waitMs = 0, signal) {
		const workspace = this.agentWorkspace.get(agentId);
		if (!workspace) return void 0;
		let outcome = this.deps.tsc.take(workspace);
		const running = this.deps.tsc.inflight(workspace);
		if (!outcome && running && waitMs > 0 && !signal?.aborted) {
			let timer;
			let onAbort;
			await Promise.race([running.catch(() => void 0), new Promise((r) => {
				timer = setTimeout(r, waitMs);
				onAbort = () => r();
				signal?.addEventListener("abort", onAbort, { once: true });
			})]);
			if (timer) clearTimeout(timer);
			if (onAbort) signal?.removeEventListener("abort", onAbort);
			outcome = this.deps.tsc.take(workspace);
		}
		return outcome ? {
			workspace,
			outcome
		} : void 0;
	}
	formatReports(reports) {
		const max = this.deps.maxReportedErrors;
		const lines = [];
		for (const r of reports) {
			for (const s of r.syntax.slice(0, max)) lines.push(`${r.file}:${s.line}:${s.column} syntax: ${s.message}`);
			for (const l of r.lint.slice(0, max)) lines.push(`${r.file} lint: ${l.message}`);
		}
		return `astryx verify ✗\n${lines.join("\n")}\nFix these with the file tools before continuing.`;
	}
	formatTsc(outcome) {
		const secs = (outcome.ms / 1e3).toFixed(1);
		if (outcome.kind === "pass") return `astryx verify ✓ (tsc ${secs}s)`;
		if (outcome.kind === "unverified") return `astryx verify ? not verified (tsc ${secs}s): ${outcome.reason}`;
		const shown = outcome.diagnostics.slice(0, this.deps.maxReportedErrors);
		const more = outcome.diagnostics.length - shown.length;
		return [
			`astryx verify ✗ (tsc ${secs}s)`,
			...shown.map((d) => `${d.file}:${d.line} ${d.code}: ${d.message}`),
			...more > 0 ? [`… ${more} more`] : [],
			"Fix these with the file tools (check props with astryx_component first)."
		].join("\n");
	}
};
// src/index.ts
const name = "dsh-astryx-studio";
const inject = [
	"tools",
	"systemPrompt",
	"skills",
	"workingDirectory"
];
const MESSAGE_SOURCE = "astryx-studio";
function verifyMessage(body) {
	return createUserMessage({
		content: [{
			type: "text",
			text: body
		}],
		source: { kind: MESSAGE_SOURCE }
	});
}
function apply(ctx, config = {}, overrides = {}) {
	const cfg = {
		...DEFAULT_CONFIG,
		...config
	};
	const run = overrides.run ?? runProcess;
	const tsc = createTscScheduler({
		run,
		timeoutMs: cfg.tscTimeoutMs
	});
	ctx.effect(() => () => tsc.dispose(), "astryx-studio: tsc scheduler");
	const verifier = new Verifier({
		tsc,
		maxReportedErrors: cfg.maxReportedErrors
	});
	const cwdOf = async (exec) => {
		if (!exec.agent) return void 0;
		try {
			return await ctx.workingDirectory.ensure(exec.agent, exec.signal);
		} catch {
			return;
		}
	};
	for (const tool of createTools({
		api: overrides.api ?? loadAstryxApi,
		cwdOf: (exec) => cwdOf(exec),
		config: cfg,
		run,
		tsc
	})) ctx.effect(() => ctx.tools.register(tool), `astryx-studio: ${tool.name}`);
	ctx.effect(() => ctx.systemPrompt.section({
		name: PROMPT_SECTION_NAME,
		order: 900,
		text: PROMPT_TEXT,
		interpolate: false
	}), "astryx-studio: prompt section");
	ctx.effect(() => ctx.skills.register(SKILL_REGISTRATION), "astryx-studio: astryx-page skill");
	ctx.on("tools/pre-execute", async (exec, next) => {
		if (exec.name === TOOL_NAMES.template) {
			const cwd = await cwdOf(exec);
			if (cwd && !detectWorkspace(cwd, cfg.appDir)) {
				const decision = await next();
				if (decision.kind !== "allow") return decision;
				return {
					kind: "ask",
					reason: `astryx_template will create an Astryx project in ${cwd}/${cfg.appDir} and install its dependencies`,
					displayReason: {
						en: `Create an Astryx project in ./${cfg.appDir} and install its dependencies?`,
						zh: `在 ./${cfg.appDir} 新建 Astryx 项目并安装依赖？`
					}
				};
			}
			return next();
		}
		if (isFileTool(exec.name)) verifier.snapshot(exec.callId, exec.name, exec.arguments, await cwdOf(exec));
		return next();
	});
	ctx.on("tools/post-execute", async (exec, result, next) => {
		if (!isFileTool(exec.name)) return next();
		if (result.isError) {
			verifier.forget(exec.callId);
			return next();
		}
		const cwd = await cwdOf(exec);
		const reports = await verifier.afterWrite({
			callId: exec.callId,
			name: exec.name,
			value: result.value,
			cwd,
			workspace: cwd ? detectWorkspace(cwd, cfg.appDir) : void 0,
			agentId: exec.agent?.id
		});
		const decision = await next();
		if (reports.length === 0 || decision.kind !== "accept") return decision;
		return {
			...decision,
			additionalContexts: [...decision.additionalContexts ?? [], verifyMessage(verifier.formatReports(reports))]
		};
	});
	ctx.on("agent/pre-step", async (payload, next) => {
		const decision = await next();
		if (decision.kind !== "enter") return decision;
		const found = await verifier.collect(payload.agent.id, cfg.tscStepWaitMs, payload.signal);
		if (!found) return decision;
		return {
			...decision,
			messages: [...decision.messages, verifyMessage(verifier.formatTsc(found.outcome))]
		};
	});
}
export { Config, MESSAGE_SOURCE, apply, inject, name, verifyMessage };

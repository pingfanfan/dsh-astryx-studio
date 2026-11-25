/**
 * Chinese search terms for the template gallery. Template names and
 * descriptions are English; each Chinese term maps to the English words that
 * appear in them. Shared by the client gallery (and usable by the Host).
 */
export const ZH_TERMS: Readonly<Record<string, readonly string[]>> = {
  // pages and layouts
  看板: ['dashboard', 'kanban'],
  仪表盘: ['dashboard'],
  仪表板: ['dashboard'],
  数据看板: ['dashboard', 'analytics'],
  后台: ['dashboard', 'shell', 'console'],
  控制台: ['console', 'dashboard'],
  分析: ['analytics'],
  统计: ['analytics', 'dashboard'],
  报表: ['report', 'scorecard', 'dashboard'],
  记分卡: ['scorecard'],
  指标: ['tiles', 'scorecard', 'analytics'],
  漏斗: ['funnel'],
  留存: ['retention', 'cohort'],
  进度: ['progress'],
  告警: ['alert', 'incident'],
  事件: ['incident'],
  对比: ['comparison'],
  比较: ['comparison'],
  // auth
  登录: ['login', 'credential'],
  登陆: ['login', 'credential'],
  注册: ['login', 'credential', 'form'],
  单点登录: ['sso'],
  // forms
  表单: ['form'],
  向导: ['wizard'],
  分步: ['wizard', 'step'],
  步骤: ['step', 'wizard'],
  联系: ['contact'],
  弹窗: ['dialog', 'modal', 'popup'],
  对话框: ['dialog', 'modal'],
  // commerce
  支付: ['payment'],
  付款: ['payment'],
  结账: ['checkout'],
  购物车: ['cart', 'checkout'],
  订单: ['order', 'checkout'],
  商品: ['product'],
  课程: ['course'],
  报名: ['enroll', 'course'],
  产品: ['product'],
  电商: ['product', 'checkout', 'cart'],
  商城: ['product'],
  价格: ['price'],
  // tables and lists
  表格: ['table'],
  列表: ['table', 'list', 'grid'],
  筛选: ['filter'],
  过滤: ['filter'],
  分组: ['grouped', 'group'],
  树: ['tree', 'hierarchical'],
  树形: ['tree', 'hierarchical'],
  收件箱: ['inbox'],
  邮件: ['inbox', 'message'],
  消息: ['message', 'messaging'],
  // content
  文档: ['documentation', 'reference'],
  教程: ['documentation', 'steps'],
  文章: ['article'],
  首页: ['hero', 'landing'],
  落地页: ['hero', 'landing'],
  着陆页: ['hero', 'landing'],
  官网: ['hero', 'landing'],
  营销: ['hero', 'call-to-action'],
  详情: ['detail'],
  详情页: ['detail'],
  空白: ['blank'],
  // galleries
  画廊: ['gallery'],
  相册: ['gallery', 'media'],
  图库: ['gallery', 'media'],
  图片: ['media', 'gallery'],
  瀑布流: ['masonry'],
  卡片: ['card'],
  资源库: ['library'],
  // apps and tools
  聊天: ['chat'],
  对话: ['chat', 'transcript'],
  助手: ['chat'],
  编辑器: ['editor'],
  画布: ['canvas'],
  设计: ['design', 'canvas'],
  文件: ['file'],
  文件管理: ['file'],
  代码: ['code', 'ide'],
  任务: ['work-item', 'kanban'],
  工单: ['work-item', 'incident'],
  项目管理: ['kanban', 'work-item'],
  拖拽: ['draggable', 'drag'],
  // components (astryx_search / astryx_build)
  日期: ['date', 'calendar'],
  日期选择: ['date', 'calendar'],
  日历: ['calendar', 'date'],
  时间: ['time'],
  标签页: ['tabs', 'tab'],
  选项卡: ['tabs', 'tab'],
  下拉: ['select', 'dropdown', 'menu'],
  下拉框: ['select', 'dropdown'],
  选择器: ['select', 'picker'],
  按钮: ['button'],
  输入框: ['input', 'field'],
  文本框: ['textarea', 'input'],
  开关: ['switch', 'toggle'],
  复选框: ['checkbox'],
  单选: ['radio'],
  徽章: ['badge'],
  标签: ['tag', 'badge', 'chip'],
  头像: ['avatar'],
  提示: ['tooltip', 'toast', 'banner'],
  消息提示: ['toast', 'banner'],
  分页: ['pagination'],
  进度条: ['progress'],
  步骤条: ['stepper', 'step'],
  抽屉: ['drawer', 'sheet'],
  菜单: ['menu'],
  折叠: ['accordion', 'collapsible'],
  上传: ['upload', 'file'],
  滑块: ['slider'],
  评分: ['rating'],
  图表: ['chart'],
  折线图: ['line chart', 'chart'],
  柱状图: ['bar chart', 'chart'],
  饼图: ['pie chart', 'chart'],
  图标: ['icon'],
  空状态: ['empty'],
  骨架屏: ['skeleton'],
  加载: ['spinner', 'loading'],
  搜索: ['search'],
  // shells and settings
  设置: ['settings', 'preferences'],
  偏好: ['preferences', 'settings'],
  导航: ['nav', 'navigation'],
  侧边栏: ['side-nav', 'sidebar', 'rail'],
  顶部导航: ['top-nav'],
  框架: ['shell', 'frame'],
  主题: ['theme'],
}

const CJK = /[㐀-鿿]/
// Longest first, so 单点登录 wins over 登录 and 数据看板 over 看板.
const KEYS = Object.keys(ZH_TERMS).sort((a, b) => b.length - a.length)

/**
 * Turn one search word into groups of alternatives; every group must match.
 * An English word is one group of itself. A Chinese word is split into the
 * dictionary terms it contains (greedy, longest first); characters no term
 * covers are dropped, and a Chinese word with no known term stays as itself.
 */
export function expandSearchWord(word: string): string[][] {
  const w = word.toLowerCase()
  if (!CJK.test(w)) return [[w]]
  // Mixed words (login表单, 表格tree): each non-Chinese run is a word of its own.
  const runs = w.match(/[㐀-鿿]+|[^㐀-鿿]+/g) ?? []
  if (runs.length > 1) return runs.filter((r) => r.trim()).flatMap(expandSearchWord)
  const groups: string[][] = []
  let i = 0
  while (i < w.length) {
    const key = KEYS.find((k) => w.startsWith(k, i))
    if (key) {
      groups.push([key, ...ZH_TERMS[key]!])
      i += key.length
    } else i++
  }
  return groups.length > 0 ? groups : [[w]]
}

/**
 * dsh-astryx-studio — Client half (web).
 *
 * Day 0 skeleton: registers the `astryx-preview` tab type (stage one, the
 * registry) and its Body (stage two, the keyed `sidebar.right.pane.tab` slot).
 * The iframe, toolbar and gallery tab land on Day 2/3.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const name = 'dsh-astryx-studio/client'
export const inject = ['slots', 'sidebarRightTabs']

export const PREVIEW_TAB_ID = 'dsh-astryx-studio/preview'
export const PREVIEW_TAB_KIND = 'astryx-preview'

const TITLE = 'Astryx 预览'

export function PreviewBody() {
  return (
    <div style={{ padding: 16, fontSize: 13 }} data-testid="astryx-preview">
      {TITLE}
    </div>
  )
}

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: PREVIEW_TAB_ID,
        kind: PREVIEW_TAB_KIND,
        title: () => TITLE,
        guide: [
          {
            id: 'preview',
            order: 60,
            title: () => TITLE,
            description: () => '正在构建的 Astryx 页面',
          },
        ],
      }),
    'astryx-studio: preview tab type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PREVIEW_TAB_ID }, PreviewBody),
      ),
    'astryx-studio: preview tab body',
  )
}

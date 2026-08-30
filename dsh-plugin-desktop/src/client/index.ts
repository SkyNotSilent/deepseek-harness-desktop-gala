import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type convergence only: locale/theme declarations expose settings slot rows.
// The desktop client does not load or register a settings surface.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// 类型收敛：官方侧边栏声明的 sidebar.footer.action 扩展位（设置旁的动作位）
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { startRendererBootReporter } from './boot-health.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { installCurrentBlankNewSessionFix } from './new-session-fix.ts'
import { DesktopTurnErrorView } from './turn-error/DesktopTurnErrorView.tsx'
import {
  DESKTOP_CONVERSATION_LOCALES,
  DESKTOP_CONVERSATION_NS,
} from './turn-error/locales.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type { DesktopClientEnvironment, DesktopClientMode, DesktopClientPlatform } from './environment.ts'
export { installCurrentBlankNewSessionFix } from './new-session-fix.ts'

/** Services required by advanced presentation. */
export const inject = [
  'slots',
  'locale',
  'sessions',
  'theme',
  'workspaces',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
  ctx.effect(
    () => ctx.locale.register(DESKTOP_CONVERSATION_NS, DESKTOP_CONVERSATION_LOCALES),
    'dsh-plugin-desktop: conversation locale',
  )
  ctx.effect(
    () => installCurrentBlankNewSessionFix(ctx.workspaces),
    'dsh-plugin-desktop: current blank New Session compatibility',
  )
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'turn-error',
    priority: -1,
    locale: DESKTOP_CONVERSATION_NS,
  }, DesktopTurnErrorView))
  if (environment.mode === 'advanced') {
    applyAdvancedShell(ctx, environment)
  }
}

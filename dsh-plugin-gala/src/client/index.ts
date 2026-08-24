/** Browser presentation owned by the private Gala workspace. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { GalaSkinDock, GalaWorkspaceSettings } from './GalaSkinDock.tsx'
import { registerGalaBrandSlots, startGalaBrandSync } from './gala-brand.tsx'
import { startGalaPersonaPresenter } from './gala-persona-presenter.ts'
import { startGalaSkinBridge } from './gala-skin-bridge.ts'

export const inject = ['slots', 'theme']

/** Register all Gala browser surfaces; every failure path preserves the official UI. */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => startGalaSkinBridge(ctx),
    'dsh-plugin-gala: skin bridge',
  )
  registerGalaBrandSlots(ctx)
  ctx.effect(
    () => startGalaBrandSync(),
    'dsh-plugin-gala: brand sync',
  )
  ctx.effect(
    () => startGalaPersonaPresenter(),
    'dsh-plugin-gala: persona presenter',
  )
  ctx.effect(
    () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'gala-skin-dock' }, GalaSkinDock),
    'dsh-plugin-gala: skin dock',
  )
  ctx.effect(
    () => ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
        { name: 'settings.plugins.tab', id: 'gala-workspace', order: 30, label: '角色空间' },
        GalaWorkspaceSettings,
      )),
    'dsh-plugin-gala: workspace settings tab',
  )
}

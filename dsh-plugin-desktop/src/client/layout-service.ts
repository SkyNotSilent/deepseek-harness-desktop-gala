import type { Context } from '@deepseek-ai/cordis'
import type {} from './contracts.ts'
import type { DesktopLayoutState } from './layout-state.ts'

/**
 * Provide the advanced layout service for one plugin-fiber lifetime.
 * @param ctx - active browser Cordis context.
 * @param layout - desktop-owned layout implementation.
 * @returns disposer for the service registration.
 */
export function provideDesktopLayout(ctx: Context, layout: DesktopLayoutState): () => void {
  const dispose = ctx.reflect.provide('layout', layout)
  return () => { void dispose() }
}

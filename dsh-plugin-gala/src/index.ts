/** Cordis Host plugin for the private Gala workspace. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  createGalaLayer,
  type GalaBundleAccess,
  type GalaLayer,
  type GalaNative,
  type GalaPackageSource,
  type PanelCard,
  type PanelDetail,
  type PickerState,
} from './gala-host.ts'
import {
  createGalaHttpHandler,
  GALA_HTTP_PREFIX,
  type GalaHttpHandler,
  type GalaHttpRpc,
} from './gala-http.ts'
import { panelViewModel, renderPanelPage } from './gala-panel-page.ts'
import { GALA_PERSONA_ORDER, GALA_PERSONA_SECTION } from './gala-persona.ts'
import type { GalaWorkspaceHost } from './gala-workspace.ts'

export * from './gala-avatar.ts'
export * from './gala-host.ts'
export * from './gala-http.ts'
export * from './gala-persona.ts'
export * from './gala-splash.ts'
export * from './gala-workspace.ts'
export type { GalaCharacter, GalaPersona } from './protocols/gala-json.ts'
export type { ConflictResolution } from './gala-market.ts'

export const name = 'gala'
export const inject = ['webServer']

/** Desktop-owned inputs and native capabilities consumed by the Gala Host plugin. */
export interface GalaHostAdapter {
  readonly userDataDir: string
  readonly profileDir: string
  readonly packages: readonly GalaPackageSource[]
  readonly bundles: GalaBundleAccess
  readonly native: GalaNative
  /** Desktop-owned Profile/workspace coordinator. */
  readonly workspaces?: GalaWorkspaceHost
  /** Bind the loopback origin before any native panel action can run. */
  configureOrigin(origin: string): void
  /** Optionally contribute native tray commands for this service lifetime. */
  attach?(service: GalaService): () => void
}

/** Panel/RPC state exposed without leaking Electron into the Gala workspace. */
export interface GalaPanelState {
  count(): number
  cards(): readonly PanelCard[]
  detail(id: string): PanelDetail | undefined
  picker(): PickerState
  skinTokens(): Record<string, { light: string; dark: string }>
}

/** Stable service contract provided as `ctx.gala`. */
export interface GalaService {
  readonly panel: GalaPanelState
  readonly rpc: GalaHttpRpc
  readonly httpHandler: GalaHttpHandler
  /** 当前应注入 systemPrompt 的人设段落；空串表示不注入。 */
  personaPrompt(): string
  activate(): Promise<void>
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    galaHost: GalaHostAdapter
    gala: GalaService
  }
}

/** Assets are package-owned and remain reachable from both source and built entrypoints. */
export function defaultOfficialsDir(): string {
  return fileURLToPath(new URL('../assets/gala/officials', import.meta.url))
}

export function createGalaService(adapter: GalaHostAdapter, layer: GalaLayer, origin: string): GalaService {
  const applyAppearance = async (id: string): Promise<void> => {
    const workspaces = adapter.workspaces
    const picker = layer.pickerState()
    const girl = picker.girls.find(item => item.skinId === id)
    if (workspaces === undefined || picker.workspaceMode === 'shared' || girl === undefined) {
      await layer.skin.apply(id)
      return
    }
    if (picker.activeWorkspace?.personaId === girl.characterId) {
      await layer.skin.apply(id)
      return
    }
    if (adapter.native.confirmWorkspaceSwitch !== undefined
      && !await adapter.native.confirmWorkspaceSwitch(girl.name)) return
    const result = await workspaces.switchWorkspace(
      { personaId: girl.characterId, name: girl.name },
      id,
    )
    if (!result.restarted) await layer.skin.apply(id)
  }
  const rpc: GalaHttpRpc = {
    open: view => { adapter.native.openPanel(view) },
    toggleFavorite: id => layer.gallery.toggleFavorite(id),
    applySkin: applyAppearance,
    revertSkin: () => layer.skin.revert(),
    restoreOriginal: async choice => {
      if (choice === 'appearance-only' || adapter.workspaces === undefined) {
        await layer.skin.revert()
        return
      }
      const result = await adapter.workspaces.disable(null)
      if (!result.restarted) await layer.skin.revert()
    },
    enableWorkspaces: async () => { await adapter.workspaces?.enable() },
    disableWorkspaces: async () => {
      if (adapter.workspaces === undefined) return
      await adapter.workspaces.disable(layer.skin.current()?.id ?? null)
    },
    stagePlugins: async changes => { await adapter.workspaces?.stagePlugins(changes) },
    applyPlugins: async () => { await adapter.workspaces?.applyPlugins() },
    setPersonaEnabled: async enabled => { layer.persona.setEnabled(enabled) },
    importPackage: () => layer.importPackage(),
    compose: id => layer.compose.compose(id),
  }
  const panel: GalaPanelState = {
    count: () => layer.gallery.list().length,
    cards: () => layer.panelCards(),
    detail: id => layer.panelDetail(id),
    picker: () => layer.pickerState(),
    skinTokens: () => layer.skinTokens(),
  }
  const httpHandler = createGalaHttpHandler({
    origin,
    renderPanel: (view, nonce) => renderPanelPage(panelViewModel(layer, view), nonce),
    assetRoot: packageId => layer.assetRoot(packageId),
    skinTokens: panel.skinTokens,
    pickerState: panel.picker,
    events: layer.events,
    rpc,
  })

  let activated = false
  let disposed = false
  let detachNative: (() => void) | undefined
  const service: GalaService = {
    panel,
    rpc,
    httpHandler,
    personaPrompt: () => layer.persona.prompt(),
    activate: async () => {
      if (activated || disposed) return
      await layer.activate()
      activated = true
      try {
        detachNative = adapter.attach?.(service)
      } catch (cause) {
        adapter.native.notify('Gala 原生入口不可用', cause instanceof Error ? cause.message : String(cause))
      }
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      detachNative?.()
      detachNative = undefined
      layer.dispose()
    },
  }
  return service
}

/** Failure isolation keeps the official Desktop usable when Gala cannot assemble. */
export function createDisabledGalaService(cause: unknown): GalaService {
  const message = cause instanceof Error ? cause.message : String(cause)
  const unavailable = async (): Promise<never> => {
    throw new Error(`dsh-plugin-gala: service unavailable: ${message}`)
  }
  return {
    panel: {
      count: () => 0,
      cards: () => [],
      detail: () => undefined,
      picker: () => ({
        girls: [], classics: [], activeSkinId: null, logo: null, persona: null,
        workspaceMode: 'shared', activeWorkspace: null, activeAppearance: null,
        restartRequired: false, plugins: [], personaEnabled: false, activePersona: null,
      }),
      skinTokens: () => ({}),
    },
    rpc: {
      open: () => {},
      toggleFavorite: () => false,
      applySkin: unavailable,
      revertSkin: unavailable,
      restoreOriginal: unavailable,
      enableWorkspaces: unavailable,
      disableWorkspaces: unavailable,
      stagePlugins: unavailable,
      applyPlugins: unavailable,
      setPersonaEnabled: unavailable,
      importPackage: unavailable,
      compose: unavailable,
    },
    httpHandler: async (_req, res) => {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, error: message }))
    },
    personaPrompt: () => '',
    activate: async () => {},
    dispose: () => {},
  }
}

/** Assemble Gala within the Cordis lifetime and register its own loopback routes. */
export function apply(ctx: Context): void {
  if (ctx.webServer.host !== '127.0.0.1') {
    throw new Error('dsh-plugin-gala: Gala requires a loopback Web server')
  }
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const adapter = ctx.get('galaHost')
  let service: GalaService
  if (adapter === undefined) {
    service = createDisabledGalaService(new Error('launcher did not provide galaHost'))
  } else try {
    adapter.configureOrigin(origin)
    const layer = createGalaLayer({
      userDataDir: adapter.userDataDir,
      profileDir: adapter.profileDir,
      packages: adapter.packages,
      bundles: adapter.bundles,
      native: adapter.native,
      officialsDir: defaultOfficialsDir(),
      appearanceStorePath: adapter.workspaces?.appearanceStorePath,
      workspaces: adapter.workspaces,
    })
    service = createGalaService(adapter, layer, origin)
  } catch (cause) {
    ctx.logger.error('dsh-plugin-gala: disabled after assembly failure')
    ctx.logger.error(cause)
    service = createDisabledGalaService(cause)
  }
  ctx.provide('gala', service)
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: GALA_HTTP_PREFIX,
      handler: service.httpHandler,
    }),
    'dsh-plugin-gala: panel, assets, RPC and SSE routes',
  )
  ctx.effect(
    () => () => { service.dispose() },
    'dsh-plugin-gala: service lifetime',
  )
  registerPersonaSection(ctx, service)
}

/**
 * 把当前角色人设作为 `gala:persona` 段落挂进 systemPrompt。段落文本是函数，
 * 每次组装提示词时实时解析当前皮肤，因此换肤 / 开关人设即时生效。
 * systemPrompt 服务缺席（例如裁剪过的 Profile）时，子 fiber 根本不会启动。
 */
export function registerPersonaSection(ctx: Context, service: GalaService): void {
  ctx.inject(['systemPrompt'], child => {
    child.systemPrompt.section({
      name: GALA_PERSONA_SECTION,
      order: GALA_PERSONA_ORDER,
      text: () => service.personaPrompt(),
    })
  })
}

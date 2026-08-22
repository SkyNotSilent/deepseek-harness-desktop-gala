/**
 * 皮肤桥（client 侧）— PRD v4.0 §9 / 决策：overrideTokens 路径
 *
 * 官方 UI 的主题 token 以 body 内联样式落地（theme-presenter），样式表规则
 * 打不赢；所以皮肤对官方 UI 的作用必须经 ctx.theme.overrideTokens 进入
 * 主题服务的层叠。主进程把当前皮肤翻译成 `--dsw-*` 双值层（gala-skin-map），
 * 本桥 boot 时取一次，SSE 收到 skin-changed 再取——同 source 整层替换，
 * 皮肤移除时空层 = 干净回滚。
 *
 * Gala 层不可用（路由 404 / 网络错误）时静默不生效，官方 UI 不受影响（§7.4）。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'

/** 皮肤映射层端点 */
export const SKIN_TOKENS_PATH = '/_dsh/desktop/gala/skin-tokens'
/** SSE 事件端点 */
export const GALA_EVENTS_PATH = '/_dsh/desktop/gala/events'
/** overrideTokens 的层来源标识（同 source 重调 = 整层替换） */
export const SKIN_OVERRIDE_SOURCE = 'dsh-plugin-desktop:gala-skin'

/** SSE 源的最小结构面（真 EventSource 与测试 fake 都满足） */
export interface SkinBridgeEventSource {
  close(): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

/** 可注入的浏览器能力（测试 fake 用） */
export interface SkinBridgeIo {
  fetchImpl?: typeof fetch
  eventSource?: (url: string) => SkinBridgeEventSource
}

function isTokenPair(value: unknown): value is { light: string; dark: string } {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { light?: unknown }).light === 'string'
    && typeof (value as { dark?: unknown }).dark === 'string'
  )
}

/** 解析 skin-tokens 响应；结构不符返回空层 */
export function parseSkinTokens(payload: unknown): Record<string, { light: string; dark: string }> {
  if (typeof payload !== 'object' || payload === null) return {}
  const tokens = (payload as { tokens?: unknown }).tokens
  if (typeof tokens !== 'object' || tokens === null) return {}
  const layer: Record<string, { light: string; dark: string }> = {}
  for (const [name, value] of Object.entries(tokens)) {
    if (name.startsWith('--dsw-') && isTokenPair(value)) layer[name] = value
  }
  return layer
}

/**
 * 启动皮肤桥：取当前层 → overrideTokens；SSE skin-changed → 重取重调。
 * 返回清理函数（关 SSE + 撤销覆盖层）。
 */
export function startGalaSkinBridge(ctx: ClientContext, io: SkinBridgeIo = {}): () => void {
  const fetchImpl = io.fetchImpl ?? fetch.bind(globalThis)
  let disposeLayer: (() => void) | undefined
  let stopped = false

  const refresh = async (): Promise<void> => {
    let layer: Record<string, { light: string; dark: string }>
    try {
      const response = await fetchImpl(SKIN_TOKENS_PATH, { cache: 'no-store' })
      if (!response.ok) return
      layer = parseSkinTokens(await response.json())
    } catch {
      return // Gala 层不可用：保持现状
    }
    if (stopped) return
    disposeLayer?.()
    disposeLayer = Object.keys(layer).length > 0
      ? ctx.theme.overrideTokens(SKIN_OVERRIDE_SOURCE, layer)
      : undefined
  }

  void refresh()

  let source: SkinBridgeEventSource | undefined
  try {
    source = (io.eventSource ?? ((url: string) => new EventSource(url)))(GALA_EVENTS_PATH)
    source.addEventListener('message', event => {
      if (event.data === 'skin-changed') void refresh()
    })
  } catch {
    // SSE 不可用：boot 时的一次取值仍然生效
  }

  return () => {
    stopped = true
    source?.close()
    disposeLayer?.()
    disposeLayer = undefined
  }
}

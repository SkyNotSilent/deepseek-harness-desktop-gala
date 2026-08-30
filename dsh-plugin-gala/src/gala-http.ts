/**
 * Gala loopback HTTP 层 — 面板页面 / 包内资产 / RPC / SSE 事件。
 *
 * Gala 面板窗口从 loopback webServer 加载（与主窗口同源），交互经此处的
 * RPC 路由回主进程；file:// 页面对 loopback 是跨源（Origin 为 "null"），
 * 所以不再走 loadFile。校验骨架沿用 renderer-boot.ts：POST + Origin +
 * content-type + 体积上限。GET 面板/资产是顶层导航与同源请求（无 Origin 头），
 * 由 loopback 绑定 + 包内相对路径校验兜底。
 *
 * 本模块只依赖注入进来的能力（渲染/资产根/RPC 实现），node 环境可直接测。
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import type { ConnectionRequestRejection, ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection'
import { isSafeEntryPath } from './gala-market.ts'

/** Gala 路由前缀（index.ts 以 prefix 路由注册） */
export const GALA_HTTP_PREFIX = '/_dsh/desktop/gala'

const MAX_RPC_BYTES = 16 * 1024

/** 资产可服务的内容类型（PRD §15：仅加载图片/CSS/JSON，禁脚本） */
const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

// ── SSE 事件枢纽 ─────────────────────────────────────────────────────

/** Gala 事件枢纽：主进程 publish，面板与主窗口 client 经 SSE 订阅 */
export interface GalaEventHub {
  /** 广播一个事件名（如 'skin-changed' / 'collection-changed'） */
  publish(event: string): void
  subscribe(listener: (event: string) => void): () => void
  /** 当前订阅数（测试与诊断用） */
  size(): number
}

/** 创建内存事件枢纽 */
export function createGalaEventHub(): GalaEventHub {
  const listeners = new Set<(event: string) => void>()
  return {
    publish: event => {
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch {
          // 单个订阅者出错不影响其余广播
        }
      }
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    size: () => listeners.size,
  }
}

// ── 依赖注入 ────────────────────────────────────────────────────────

/** RPC 动作（由 gala-electron 提供实现） */
export interface GalaHttpRpc {
  /** 打开 Gala 面板并深链到指定视图 */
  open(view: string): void
  /** 切换收藏；返回切换后的状态 */
  toggleFavorite(id: string): boolean
  /** 启用皮肤（失败抛错=已按 §9.4 回滚） */
  applySkin(id: string): Promise<void>
  /** 移除当前皮肤 */
  revertSkin(): Promise<void>
  /** 明确选择恢复范围，避免把原装与退出独立空间混为一谈。 */
  restoreOriginal?(choice: 'appearance-only' | 'exit-isolated'): Promise<void>
  enableWorkspaces?(): Promise<void>
  disableWorkspaces?(): Promise<void>
  stagePlugins?(changes: Readonly<Record<string, boolean>>): Promise<void>
  applyPlugins?(): Promise<void>
  /** 开关角色人设对话（即时生效，不重启） */
  setPersonaEnabled?(enabled: boolean): Promise<void>
  /** 交互式导入 .ggal（弹文件选择框）；返回是否成功导入 */
  importPackage(): Promise<boolean>
  /** 按配方合成；true=已提交并准备重启，false=用户取消 */
  compose(id: string): Promise<boolean>
}

/** Gala HTTP 层依赖 */
export interface GalaHttpOptions {
  /** alpha.2 Connection Host/Origin and browser-session authentication fence. */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection
  /** 期望的同源 Origin（POST 校验，如 http://127.0.0.1:<port>） */
  origin: string
  /** 渲染面板页面；nonce 供受控内联脚本的 CSP 使用 */
  renderPanel(view: string, nonce: string): string
  /** 解析包 id 到其资产根目录；未知 id 返回 undefined */
  assetRoot(packageId: string): string | undefined
  /** 当前皮肤映射层（--dsw-* token → light/dark 双值） */
  skinTokens(): Record<string, { light: string; dark: string }>
  /** 选肤弹层状态（少女 / 经典配色 / 当前 logo；结构见 gala-host PickerState） */
  pickerState(): unknown
  events: GalaEventHub
  rpc: GalaHttpRpc
  /** nonce 生成器（缺省 crypto.randomUUID；测试可注入固定值） */
  nonce?: () => string
}

/** Gala HTTP 请求处理器（挂到 webServer 的 prefix 路由） */
export type GalaHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

// ── 处理器实现 ──────────────────────────────────────────────────────

function finish(res: ServerResponse, statusCode: number, body?: string): void {
  res.statusCode = statusCode
  if (body !== undefined) {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(body)
    return
  }
  res.end()
}

function jsonError(res: ServerResponse, statusCode: number, message: string): void {
  finish(res, statusCode, JSON.stringify({ ok: false, error: message }))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > MAX_RPC_BYTES) throw new Error('payload too large')
    chunks.push(bytes)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function stringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = (value as Record<string, unknown>)[field]
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 512 ? raw : undefined
}

function booleanRecordField(value: unknown, field: string): Record<string, boolean> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = (value as Record<string, unknown>)[field]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw)
  if (entries.length > 128 || entries.some(([key, enabled]) => key.length === 0 || key.length > 256 || typeof enabled !== 'boolean')) {
    return undefined
  }
  return Object.fromEntries(entries) as Record<string, boolean>
}

function serveAsset(res: ServerResponse, root: string, relativePath: string): void {
  const contentType = ASSET_CONTENT_TYPES[extname(relativePath).toLowerCase()]
  if (contentType === undefined) return finish(res, 415)
  const absolute = resolve(join(root, relativePath))
  // isSafeEntryPath 已拒 ..，这里再兜一层 resolve 后的根前缀
  if (!absolute.startsWith(resolve(root) + sep)) return finish(res, 403)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return finish(res, 404)
  res.statusCode = 200
  res.setHeader('content-type', contentType)
  res.setHeader('cache-control', 'no-store')
  createReadStream(absolute).pipe(res)
}

function serveEvents(res: ServerResponse, req: IncomingMessage, events: GalaEventHub): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  res.write('retry: 3000\n\n')
  const unsubscribe = events.subscribe(event => {
    res.write(`data: ${event}\n\n`)
  })
  req.on('close', () => {
    unsubscribe()
    res.end()
  })
}

async function handleRpc(
  req: IncomingMessage,
  res: ServerResponse,
  action: string,
  options: GalaHttpOptions,
): Promise<void> {
  if (req.method !== 'POST') return finish(res, 405)
  if (req.headers.origin !== options.origin) return finish(res, 403)
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finish(res, 415)
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    return finish(res, 400)
  }

  try {
    switch (action) {
      case 'open': {
        options.rpc.open(stringField(body, 'view') ?? 'gallery')
        return finish(res, 200, JSON.stringify({ ok: true }))
      }
      case 'favorite': {
        const id = stringField(body, 'id')
        if (id === undefined) return finish(res, 400)
        const favorite = options.rpc.toggleFavorite(id)
        return finish(res, 200, JSON.stringify({ ok: true, favorite }))
      }
      case 'skin-apply': {
        const id = stringField(body, 'id')
        if (id === undefined) return finish(res, 400)
        await options.rpc.applySkin(id)
        return finish(res, 200, JSON.stringify({ ok: true }))
      }
      case 'skin-revert': {
        await options.rpc.revertSkin()
        return finish(res, 200, JSON.stringify({ ok: true }))
      }
      case 'appearance-original': {
        const choice = stringField(body, 'choice')
        if (choice !== 'appearance-only' && choice !== 'exit-isolated') return finish(res, 400)
        if (options.rpc.restoreOriginal === undefined) return finish(res, 404)
        await options.rpc.restoreOriginal(choice)
        return finish(res, 200, JSON.stringify({ ok: true }))
      }
      case 'workspace-enable': {
        if (options.rpc.enableWorkspaces === undefined) return finish(res, 404)
        await options.rpc.enableWorkspaces()
        return finish(res, 200, JSON.stringify({ ok: true }))
      }
      case 'workspace-disable': {
        if (options.rpc.disableWorkspaces === undefined) return finish(res, 404)
        await options.rpc.disableWorkspaces()
        return finish(res, 200, JSON.stringify({ ok: true }))
      }
      case 'plugins-stage': {
        const changes = booleanRecordField(body, 'changes')
        if (changes === undefined) return finish(res, 400)
        if (options.rpc.stagePlugins === undefined) return finish(res, 404)
        await options.rpc.stagePlugins(changes)
        return finish(res, 200, JSON.stringify({ ok: true }))
      }
      case 'plugins-apply': {
        if (options.rpc.applyPlugins === undefined) return finish(res, 404)
        await options.rpc.applyPlugins()
        return finish(res, 200, JSON.stringify({ ok: true }))
      }
      case 'persona-toggle': {
        const enabled = (body as { enabled?: unknown } | null)?.enabled
        if (typeof enabled !== 'boolean') return finish(res, 400)
        if (options.rpc.setPersonaEnabled === undefined) return finish(res, 404)
        await options.rpc.setPersonaEnabled(enabled)
        return finish(res, 200, JSON.stringify({ ok: true, enabled }))
      }
      case 'import': {
        const imported = await options.rpc.importPackage()
        return finish(res, 200, JSON.stringify({ ok: true, imported }))
      }
      case 'compose': {
        const id = stringField(body, 'id')
        if (id === undefined) return finish(res, 400)
        const composed = await options.rpc.compose(id)
        return finish(res, 200, JSON.stringify({ ok: true, composed }))
      }
      default:
        return finish(res, 404)
    }
  } catch (cause) {
    return jsonError(res, 422, cause instanceof Error ? cause.message : String(cause))
  }
}

/**
 * 创建 Gala HTTP 处理器。路由（相对 GALA_HTTP_PREFIX）：
 * - GET  /panel?view=<gallery|skins|compose|market>  面板页面（带 nonce CSP 头）
 * - GET  /asset?pkg=<id>&path=<rel>          包内资产流
 * - GET  /skin-tokens                        当前皮肤映射层 JSON
 * - GET  /picker                             选肤弹层状态 JSON
 * - GET  /events                             SSE 事件流
 * - POST /rpc/<open|favorite|skin-apply|skin-revert|appearance-original|workspace-*|plugins-*|persona-toggle|import|compose>
 */
export function createGalaHttpHandler(options: GalaHttpOptions): GalaHttpHandler {
  const makeNonce = options.nonce ?? (() => crypto.randomUUID().replaceAll('-', ''))

  return async (req, res) => {
    const rejection = options.requestRejection(req)
    if (rejection !== undefined) return finish(res, rejection)
    const url = new URL(req.url ?? '/', options.origin)
    const subPath = url.pathname.startsWith(GALA_HTTP_PREFIX)
      ? url.pathname.slice(GALA_HTTP_PREFIX.length)
      : url.pathname

    if (subPath.startsWith('/rpc/')) {
      return handleRpc(req, res, subPath.slice('/rpc/'.length), options)
    }
    if (req.method !== 'GET') return finish(res, 405)

    switch (subPath) {
      case '/panel': {
        const nonce = makeNonce()
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader(
          'content-security-policy',
          `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; `
            + `img-src ${options.origin}; connect-src ${options.origin}`,
        )
        res.end(options.renderPanel(url.searchParams.get('view') ?? 'gallery', nonce))
        return
      }
      case '/asset': {
        const packageId = url.searchParams.get('pkg')
        const relativePath = url.searchParams.get('path')
        if (packageId === null || relativePath === null || !isSafeEntryPath(relativePath)) {
          return finish(res, 400)
        }
        const root = options.assetRoot(packageId)
        if (root === undefined) return finish(res, 404)
        return serveAsset(res, root, relativePath)
      }
      case '/skin-tokens': {
        return finish(res, 200, JSON.stringify({ ok: true, tokens: options.skinTokens() }))
      }
      case '/picker': {
        res.setHeader('cache-control', 'no-store')
        return finish(res, 200, JSON.stringify({ ok: true, picker: options.pickerState() }))
      }
      case '/events': {
        return serveEvents(res, req, options.events)
      }
      default:
        return finish(res, 404)
    }
  }
}

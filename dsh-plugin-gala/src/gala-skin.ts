/**
 * 皮肤注入服务（ctx.galaSkin）— PRD v4.0 §5.2 / §9 / §16 G2
 *
 * G2 里程碑完整实现：
 * - CSS 白名单过滤（§7.2）：只保留 :root 块内的 --gala-* 声明，
 *   丢弃 position:fixed / !important / url() / 无限循环动画 / iframe-webview 规则
 * - insertCSS/removeCSS 注入（§9.4）：通过宿主注入回调，保持可单测
 * - 换肤失败回滚（§9.4）：注入失败时保持上一套皮肤不变
 * - skins.json 持久化（§13.2）：重启后 restore() 恢复上次皮肤
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { validateSkinManifest } from './protocols/skin-protocol.ts'
import type { SkinManifest } from './protocols/skin-protocol.ts'

// ── 皮肤持久化存储（skins.json）─────────────────────────────────────

/** skins.json 顶层结构（PRD §13.2） */
export interface GalaSkinStoreFile {
  version: 1
  /** 当前启用皮肤 ID；null 表示无皮肤 */
  active: string | null
}

/** skins.json 当前版本 */
export const SKIN_STORE_VERSION = 1

/** 皮肤持久化存储接口 */
export interface GalaSkinStore {
  /** 上次启用的皮肤 ID；从未启用则 undefined */
  getActive(): string | undefined
  /** 记录启用皮肤；null 表示清除 */
  setActive(id: string | null): void
}

function isSkinStoreFile(data: unknown): data is GalaSkinStoreFile {
  if (typeof data !== 'object' || data === null) return false
  const file = data as Partial<GalaSkinStoreFile>
  return (
    file.version === SKIN_STORE_VERSION &&
    (file.active === null || typeof file.active === 'string')
  )
}

/** 创建 skins.json 存储实例（首次访问惰性加载；原子替换写入） */
export function createGalaSkinStore(filePath: string): GalaSkinStore {
  let active: string | null = null
  let dirty = false

  const read = (): void => {
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return // 首次运行：无记录
      throw cause
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      throw new Error(
        `gala: skins.json 解析失败 ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    if (!isSkinStoreFile(parsed)) {
      throw new Error(`gala: skins.json 校验失败 ${filePath}`)
    }
    active = parsed.active
  }

  const write = (): void => {
    if (!dirty) return
    mkdirSync(dirname(filePath), { recursive: true })
    const payload: GalaSkinStoreFile = { version: SKIN_STORE_VERSION, active }
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(tmp, filePath)
    dirty = false
  }

  read()

  return {
    getActive: () => active ?? undefined,
    setActive: id => {
      active = id
      dirty = true
      write()
    },
  }
}

// ── CSS 白名单过滤（PRD §7.2）────────────────────────────────────────

/** 允许的 CSS 自定义属性前缀（PRD §7.2） */
const SKIN_TOKEN_PREFIX = '--gala-'

/** 危险值特征：!important / url() / infinite（无限循环动画） */
const UNSAFE_VALUE_RE = /!important|url\s*\(|\binfinite\b/i

/** 校验单个声明是否安全（PRD §7.2） */
function isSafeDeclaration(name: string, value: string): boolean {
  if (!name.startsWith(SKIN_TOKEN_PREFIX)) return false
  if (UNSAFE_VALUE_RE.test(value)) return false
  return true
}

/** :root 块提取（非贪婪匹配大括号内容） */
const ROOT_BLOCK_RE = /:root\s*\{([\s\S]*?)\}/g

/**
 * 白名单 sanitize CSS 文本（PRD §7.2 / §9.4）。
 *
 * 只保留 `:root` 块内的 `--gala-*` 声明；丢弃所有其他规则
 * （覆盖 position:fixed / iframe-webview 选择器等）。
 * 声明值含 !important / url() / infinite 时也丢弃。
 *
 * 返回过滤后的 `:root { ... }` 文本；无可用声明时返回空串。
 */
export function sanitizeSkinCss(css: string): string {
  const entries: Array<[string, string]> = []
  for (const match of css.matchAll(ROOT_BLOCK_RE)) {
    // 移除注释后按 `;` 切分声明，避免正则惰性匹配在无分号时截断值
    const body = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const decl of body.split(';')) {
      const trimmed = decl.trim()
      if (trimmed === '') continue
      const colon = trimmed.indexOf(':')
      if (colon === -1) continue
      const name = trimmed.slice(0, colon).trim()
      const value = trimmed.slice(colon + 1).trim()
      if (isSafeDeclaration(name, value)) {
        entries.push([name, value])
      }
    }
  }
  if (entries.length === 0) return ''
  return `:root {\n${entries.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}`
}

/**
 * 将 SkinManifest.tokens 序列化为 `:root { ... }` CSS 文本（PRD §9.4）。
 * 非 --gala-* 键或危险值被丢弃；全部不通过时抛错（无可注入内容）。
 */
export function serializeSkinTokens(tokens: Record<string, string>): string {
  const entries: Array<[string, string]> = []
  for (const [name, value] of Object.entries(tokens)) {
    if (isSafeDeclaration(name, value)) {
      entries.push([name, value])
    }
  }
  if (entries.length === 0) {
    throw new Error('gala: 皮肤没有任何可通过白名单校验的 CSS 变量')
  }
  return `:root {\n${entries.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}`
}

/** 远程 URL / 绝对路径引用（PRD §7.2：只加载本地包内文件） */
const REMOTE_OR_ABSOLUTE_RE = /^(https?:|file:|data:|[a-zA-Z]:[\\/]|[\\/])/

/** 目录穿越（.. 片段） */
const TRAVERSAL_RE = /(^|[\\/])\.\.([\\/]|$)/

/** 校验皮肤 CSS 路径：必须为包内相对路径（PRD §7.2） */
export function resolveSkinCssPath(cssPath: string): string {
  const p = cssPath.trim()
  if (REMOTE_OR_ABSOLUTE_RE.test(p)) {
    throw new Error(`gala: 皮肤 CSS 必须是包内相对路径: ${p}`)
  }
  if (TRAVERSAL_RE.test(p)) {
    throw new Error(`gala: 皮肤 CSS 路径不允许目录穿越: ${p}`)
  }
  return p
}

// ── 皮肤注入服务（PRD §5.2 ctx.galaSkin）─────────────────────────────

/** 皮肤注入服务（PRD §5.2 ctx.galaSkin） */
export interface GalaSkinService {
  /** 当前启用的皮肤（无则 undefined） */
  current(): SkinManifest | undefined
  /** 已注册皮肤列表 */
  list(): readonly SkinManifest[]
  /** 注册一个皮肤清单（须通过 GSP schema 校验） */
  register(manifest: SkinManifest): void
  /** 启用指定皮肤（insertCSS 注入；失败回滚到上一套皮肤，PRD §9.4） */
  apply(skinId: string): Promise<void>
  /** 移除当前皮肤（removeCSS 精确移除） */
  revert(): Promise<void>
  /** 从持久化存储恢复上次启用的皮肤（G11 重启后调用） */
  restore(): Promise<void>
}

/** 宿主注入能力（生产：webContents.insertCSS/removeCSS；测试：fake） */
export interface GalaSkinHost {
  /** 注入 CSS，返回唯一 insertKey 用于后续精确移除（PRD §9.4） */
  insertCss(css: string): Promise<string>
  /** 按 insertKey 精确移除已注入 CSS（PRD §9.4） */
  removeCss(key: string): Promise<void>
  /** 读取皮肤包内 CSS 文件内容（仅允许包内相对路径） */
  readCss(cssPath: string): string
  /** 皮肤状态持久化存储（PRD §13.2） */
  store: GalaSkinStore
}

/** 皮肤服务依赖 */
export interface GalaSkinOptions {
  /** 宿主注入能力；缺省时 apply/revert/restore 抛错（G0 状态机语义） */
  host?: GalaSkinHost
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 未接入宿主时的占位（G0 状态机语义：注入调用即报错） */
function createUnavailableHost(): GalaSkinHost {
  const unavailable = async (): Promise<never> => {
    throw new Error('gala: 皮肤注入宿主未接入（G2 由桌面主进程提供 webContents）')
  }
  return {
    insertCss: unavailable,
    removeCss: unavailable,
    readCss: () => {
      throw new Error('gala: 皮肤 CSS 读取宿主未接入')
    },
    store: {
      getActive: () => undefined,
      setActive: () => {},
    },
  }
}

/** 创建皮肤注入服务实例 */
export function createGalaSkinService(options: GalaSkinOptions = {}): GalaSkinService {
  const host = options.host ?? createUnavailableHost()
  const skins = new Map<string, SkinManifest>()
  let active: SkinManifest | undefined
  let activeKey: string | undefined

  const applySkin = async (skinId: string): Promise<void> => {
    const manifest = skins.get(skinId)
    if (!manifest) {
      throw new Error(`皮肤未注册: ${skinId}`)
    }

    // 1. 组装白名单化 CSS（tokens + tokens.css 文件，PRD §9.4）
    const tokenCss = serializeSkinTokens(manifest.tokens)
    let extraCss = ''
    if (manifest.css) {
      const cssPath = resolveSkinCssPath(manifest.css)
      extraCss = sanitizeSkinCss(host.readCss(cssPath))
    }
    const cssText = [tokenCss, extraCss].filter(Boolean).join('\n')

    // 2. 注入新皮肤；失败则保持上一套皮肤不变（PRD §9.4 回滚）
    let newKey: string
    try {
      newKey = await host.insertCss(cssText)
    } catch (cause) {
      // 旧皮肤 CSS 仍在页面中（removeCss 尚未调用），状态不变 = 回滚
      throw new Error(`gala: 皮肤注入失败 ${skinId}: ${messageOf(cause)}`)
    }

    // 3. 移除上一套皮肤；移除失败则回滚新注入，恢复旧皮肤
    if (activeKey !== undefined) {
      try {
        await host.removeCss(activeKey)
      } catch (cause) {
        try { await host.removeCss(newKey) } catch { /* 回滚尽力而为 */ }
        throw new Error(`gala: 旧皮肤移除失败，换肤已回滚: ${active?.id}: ${messageOf(cause)}`)
      }
    }

    active = manifest
    activeKey = newKey
    host.store.setActive(manifest.id)
  }

  return {
    current: () => active,
    list: () => [...skins.values()],
    register: manifest => {
      const { id } = manifest
      if (!validateSkinManifest(manifest)) {
        throw new Error(`无效的皮肤清单: ${id}`)
      }
      skins.set(id, manifest)
    },
    apply: applySkin,
    revert: async () => {
      if (activeKey === undefined) return
      await host.removeCss(activeKey)
      active = undefined
      activeKey = undefined
      host.store.setActive(null)
    },
    restore: async () => {
      const id = host.store.getActive()
      if (id === undefined) return
      if (!skins.has(id)) return // 皮肤包已卸载：跳过恢复
      await applySkin(id)
    },
  }
}

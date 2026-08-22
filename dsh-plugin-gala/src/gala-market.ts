/**
 * 本地市场服务（ctx.galaMarket）— PRD v4.0 §7.3 / §11 / §16 G4
 *
 * G4 里程碑完整实现：
 * - `.ggal` 导入（G16）：读 zip → 校验 manifest/sha256/gala.json → 落盘 → 注册图鉴
 * - 非法包拒绝（G17）：schema 错误 / 摘要不符 / 路径越界 / 体积超限，一律不写盘
 * - 图鉴刷新（G18）：character / bundle 注册进 ctx.gala，皮肤交给 ctx.galaSkin
 * - 冲突处理（G19）：id 已存在 → 覆盖 / 跳过 / 重命名
 * - 回滚（G20）：删包 + 从 profile bundles 移除 + 图鉴注销
 *
 * 落盘策略：先在市场目录下的临时目录组装，全部校验通过后 rename 就位；
 * 任一步失败即删除临时目录（§7.3 “导入失败自动回滚”）。
 * 因为写盘路径完全由本模块拼装，zip 内的越界路径在写盘前就被拒绝，
 * 不存在 “先解压再发现越界” 的窗口。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MAX_SKIN_BYTES, readGgalPackage, type GgalEntry } from './ggal-zip.ts'
import { validateGalaJson, type GalaCharacter, type GalaType } from './protocols/gala-json.ts'
import {
  galaSlug,
  normalizeGalaId,
  validateMarketManifest,
  type MarketManifest,
} from './protocols/market-manifest.ts'
import type { GalaRegistry } from './gala-registry.ts'

/** 包内清单文件名（PRD §11.1） */
export const MANIFEST_ENTRY = 'manifest.json'
/** 包内 Gala 元数据文件名（PRD §11.1） */
export const GALA_ENTRY = 'gala.json'
/** 临时组装目录前缀（位于市场目录内，保证 rename 同卷原子） */
const IMPORT_TEMP_PREFIX = '.import-'

/** id 冲突时的处置（PRD §11.6） */
export type ConflictResolution =
  | { action: 'overwrite' }
  | { action: 'skip' }
  | { action: 'rename'; id: string }

/** 导入结果 */
export interface ImportResult {
  /** 用户取消（skip）时为 false */
  success: boolean
  /** 实际落地的 Gala id（重命名时为新 id） */
  id: string
  type: GalaType
  /** 落地目录；skip 时为 undefined */
  dir?: string | undefined
  /** 冲突处置结果；无冲突时为 undefined */
  conflict?: ConflictResolution['action'] | undefined
}

/** 已安装的市场包 */
export interface InstalledPackage {
  id: string
  type: GalaType
  dir: string
  character: GalaCharacter
}

/** 市场服务依赖注入（对话框与 profile 写入由宿主提供，保持 node 环境可单测） */
export interface GalaMarketOptions {
  /** 市场包落地根目录（PRD §13.2 gala/market） */
  marketDir: string
  registry: GalaRegistry
  /** 当前 profile 的 bundles（回滚时移除包，PRD §11.5） */
  readBundles: () => readonly string[]
  writeBundles: (bundles: readonly string[]) => void
  /** id 冲突时询问用户（PRD §11.6）；缺省视为跳过 */
  onConflict?: (id: string) => ConflictResolution | Promise<ConflictResolution>
  /** 读包实现（缺省读真实 zip；测试可注入内存条目） */
  readPackage?: (ggalPath: string) => readonly GgalEntry[]
}

/** 本地市场服务（PRD §5.2 ctx.galaMarket） */
export interface GalaMarketService {
  /** 已安装市场包（扫描市场目录，跳过损坏包） */
  list(): readonly InstalledPackage[]
  /** 把已安装市场包全部注册进图鉴（启动时调用） */
  restore(): void
  /** 导入 `.ggal` 包（PRD §11.3） */
  import(ggalPath: string): Promise<ImportResult>
  /** 回滚：删包 + 从 bundles 移除 + 图鉴注销（PRD §11.5） */
  rollback(id: string): void
}

// ── 校验 ────────────────────────────────────────────────────────────

/** 包内路径必须是相对路径且不得逃逸（PRD §7.3 / §11.4） */
export function isSafeEntryPath(path: string): boolean {
  if (path.length === 0) return false
  if (path.includes('\\')) return false // Windows 分隔符会绕过分段检查
  if (path.startsWith('/')) return false
  if (/^[a-zA-Z]:/.test(path)) return false // 盘符绝对路径
  if (path.includes('\0')) return false
  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * payload 摘要：按 manifest.files 声明顺序，对 `<路径>\n<该文件 sha256>\n` 串联再取 sha256。
 *
 * PRD §11.3 伪代码写的是 “包文件自身的 sha256 与包内 manifest 声明比对”，
 * 而 manifest 就在包里，自引用哈希不可能成立；这里改成对 payload 取摘要，
 * 同样覆盖 “内容被篡改就拒绝” 的意图，且可实际计算。
 */
export function computePayloadDigest(entries: readonly GgalEntry[], files: readonly string[]): string {
  const byPath = new Map(entries.map(entry => [entry.path, entry.data]))
  const hash = createHash('sha256')
  for (const path of files) {
    const data = byPath.get(path)
    if (data === undefined) throw new Error(`gala: .ggal 缺少 manifest 声明的文件 ${path}`)
    hash.update(`${path}\n${sha256Hex(data)}\n`)
  }
  return hash.digest('hex')
}

function parseJsonEntry(entries: readonly GgalEntry[], name: string): unknown {
  const entry = entries.find(item => item.path === name)
  if (entry === undefined) throw new Error(`gala: .ggal 缺少 ${name}`)
  try {
    return JSON.parse(entry.data.toString('utf8'))
  } catch (cause) {
    throw new Error(`gala: ${name} 解析失败: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** 校验包内容并返回 manifest + gala 元数据；任一条不满足即抛错（G17） */
function validatePackage(entries: readonly GgalEntry[]): {
  manifest: MarketManifest
  character: GalaCharacter
} {
  for (const entry of entries) {
    if (!isSafeEntryPath(entry.path)) {
      throw new Error(`gala: .ggal 含非法路径 ${entry.path}`)
    }
  }

  const manifestData = parseJsonEntry(entries, MANIFEST_ENTRY)
  if (!validateMarketManifest(manifestData)) {
    throw new Error(`gala: manifest.json 校验失败 ${formatAjvErrors(validateMarketManifest.errors)}`)
  }
  const manifest = manifestData

  const declared = new Set(manifest.files)
  const actual = new Set(entries.map(entry => entry.path).filter(path => path !== MANIFEST_ENTRY))
  for (const path of actual) {
    if (!declared.has(path)) throw new Error(`gala: .ggal 含未声明的文件 ${path}`)
  }
  for (const path of declared) {
    if (!actual.has(path)) throw new Error(`gala: .ggal 缺少 manifest 声明的文件 ${path}`)
  }

  const digest = computePayloadDigest(entries, manifest.files)
  if (digest !== manifest.sha256) {
    throw new Error('gala: .ggal 摘要不匹配（包内容与 manifest.sha256 不一致）')
  }

  const galaData = parseJsonEntry(entries, GALA_ENTRY)
  if (!validateGalaJson(galaData)) {
    throw new Error(`gala: gala.json 校验失败 ${formatAjvErrors(validateGalaJson.errors)}`)
  }
  const character = galaData

  if (normalizeGalaId(manifest.id) !== character.id) {
    throw new Error(`gala: manifest.id (${manifest.id}) 与 gala.json id (${character.id}) 不一致`)
  }
  if (manifest.type !== character.type) {
    throw new Error(`gala: manifest.type (${manifest.type}) 与 gala.json type (${character.type}) 不一致`)
  }

  if (character.type === 'skin') {
    const total = entries.reduce((sum, entry) => sum + entry.data.byteLength, 0)
    if (total > MAX_SKIN_BYTES) {
      throw new Error(`gala: 皮肤包体积超限（${total} > ${MAX_SKIN_BYTES} 字节）`)
    }
  }

  return { manifest, character }
}

function formatAjvErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return ''
  const first = errors[0] as { instancePath?: string; message?: string }
  return `${first.instancePath ?? ''} ${first.message ?? ''}`.trim()
}

// ── 服务实现 ────────────────────────────────────────────────────────

function readInstalled(marketDir: string): InstalledPackage[] {
  let names: string[]
  try {
    names = readdirSync(marketDir)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
  const installed: InstalledPackage[] = []
  for (const name of names) {
    if (name.startsWith(IMPORT_TEMP_PREFIX) || name.startsWith('.')) continue
    const dir = join(marketDir, name)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(dir, GALA_ENTRY), 'utf8'))
    } catch {
      continue // 损坏或非包目录：跳过，不阻塞其余市场包
    }
    if (!validateGalaJson(parsed)) continue
    installed.push({ id: parsed.id, type: parsed.type, dir, character: parsed })
  }
  return installed
}

/** 创建本地市场服务实例 */
export function createGalaMarketService(options: GalaMarketOptions): GalaMarketService {
  const { marketDir, registry, readBundles, writeBundles, onConflict } = options
  const readPackage = options.readPackage ?? (path => readGgalPackage(path))

  /** character / bundle 进图鉴；皮肤由 ctx.galaSkin 管理（PRD §11.3 步骤 7） */
  const registerIfCollectible = (character: GalaCharacter): void => {
    if (character.type === 'character' || character.type === 'bundle') {
      registry.register(character)
    }
  }

  const service: GalaMarketService = {
    list: () => readInstalled(marketDir),

    restore: () => {
      for (const installed of readInstalled(marketDir)) registerIfCollectible(installed.character)
    },

    import: async ggalPath => {
      const entries = readPackage(ggalPath)
      const { character } = validatePackage(entries)

      let finalId = character.id
      let conflict: ConflictResolution['action'] | undefined
      let targetDir = join(marketDir, galaSlug(finalId))

      if (existsSync(targetDir)) {
        const resolution = (await onConflict?.(finalId)) ?? { action: 'skip' as const }
        conflict = resolution.action
        if (resolution.action === 'skip') {
          return { success: false, id: finalId, type: character.type, conflict }
        }
        if (resolution.action === 'rename') {
          finalId = normalizeGalaId(resolution.id)
          targetDir = join(marketDir, galaSlug(finalId))
          if (existsSync(targetDir)) {
            throw new Error(`gala: 重命名目标 ${finalId} 同样已存在`)
          }
        }
      }

      const finalCharacter: GalaCharacter = { ...character, id: finalId }
      if (!validateGalaJson(finalCharacter)) {
        throw new Error(`gala: 重命名后的 id 非法 ${finalId}`)
      }

      mkdirSync(marketDir, { recursive: true })
      const tempDir = mkdtempSync(join(marketDir, IMPORT_TEMP_PREFIX))
      try {
        for (const entry of entries) {
          const destination = join(tempDir, entry.path)
          mkdirSync(dirname(destination), { recursive: true })
          writeFileSync(
            destination,
            entry.path === GALA_ENTRY
              ? `${JSON.stringify(finalCharacter, null, 2)}\n`
              : entry.data,
          )
        }
        if (conflict === 'overwrite') rmSync(targetDir, { recursive: true, force: true })
        renameSync(tempDir, targetDir)
      } catch (cause) {
        rmSync(tempDir, { recursive: true, force: true })
        throw cause
      }

      registerIfCollectible(finalCharacter)
      return { success: true, id: finalId, type: finalCharacter.type, dir: targetDir, conflict }
    },

    rollback: id => {
      const targetDir = join(marketDir, galaSlug(id))
      rmSync(targetDir, { recursive: true, force: true })
      const bundles = readBundles()
      const remaining = bundles.filter(bundle => bundle !== id && bundle !== galaSlug(id))
      if (remaining.length !== bundles.length) writeBundles(remaining)
      registry.unregister(normalizeGalaId(id))
    },
  }
  return service
}

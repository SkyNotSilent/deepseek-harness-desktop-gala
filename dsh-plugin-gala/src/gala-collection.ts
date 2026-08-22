/**
 * 嘎啦图鉴收藏存储（collection.json）— PRD v4.0 §13.2 / §13.3
 *
 * 维护 `~/Library/Application Support/dsh-desktop/gala/collection.json`：
 * - version: 1
 * - collected: [{ id, firstSeenAt, favorite, notes }]
 * 写入采用临时文件 + rename 的原子替换，避免半写损坏。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 图鉴收藏条目（PRD §13.3） */
export interface CollectionEntry {
  id: string
  /** 首次收录时间（ISO-8601） */
  firstSeenAt: string
  favorite: boolean
  notes: string
}

/** collection.json 顶层结构（PRD §13.3） */
export interface GalaCollectionFile {
  version: 1
  collected: CollectionEntry[]
}

/** collection.json 当前版本（PRD §13.3） */
export const COLLECTION_VERSION = 1

/** 图鉴收藏存储接口 */
export interface GalaCollectionStore {
  list(): readonly CollectionEntry[]
  get(id: string): CollectionEntry | undefined
  /** 记录首次收录时间（已收录则 no-op），新条目立即持久化 */
  record(id: string, at?: Date): CollectionEntry
  setFavorite(id: string, favorite: boolean): CollectionEntry
  setNotes(id: string, notes: string): CollectionEntry
  /** 强制落盘（脏标记下才写） */
  save(): void
}

function isCollectionFile(data: unknown): data is GalaCollectionFile {
  if (typeof data !== 'object' || data === null) return false
  const file = data as Partial<GalaCollectionFile>
  if (file.version !== COLLECTION_VERSION || !Array.isArray(file.collected)) return false
  return file.collected.every(
    entry =>
      typeof entry.id === 'string' &&
      typeof entry.firstSeenAt === 'string' &&
      typeof entry.favorite === 'boolean' &&
      typeof entry.notes === 'string',
  )
}

/** 创建 collection.json 存储实例（首次访问时惰性加载） */
export function createGalaCollectionStore(filePath: string): GalaCollectionStore {
  const entries = new Map<string, CollectionEntry>()
  let dirty = false

  const read = (): void => {
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return // 首次运行：空收藏
      throw cause
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      throw new Error(
        `gala: collection.json 解析失败 ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    if (!isCollectionFile(parsed)) {
      throw new Error(`gala: collection.json 校验失败 ${filePath}`)
    }
    for (const entry of parsed.collected) entries.set(entry.id, entry)
  }

  const write = (): void => {
    if (!dirty) return
    mkdirSync(dirname(filePath), { recursive: true })
    const payload: GalaCollectionFile = {
      version: COLLECTION_VERSION,
      collected: [...entries.values()],
    }
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(tmp, filePath)
    dirty = false
  }

  read()

  return {
    list: () => [...entries.values()],
    get: id => entries.get(id),
    record: (id, at = new Date()) => {
      const existing = entries.get(id)
      if (existing) return existing
      const entry: CollectionEntry = {
        id,
        firstSeenAt: at.toISOString(),
        favorite: false,
        notes: '',
      }
      entries.set(id, entry)
      dirty = true
      write()
      return entry
    },
    setFavorite: (id, favorite) => {
      const entry = entries.get(id)
      if (!entry) throw new Error(`gala: 收藏条目不存在 ${id}`)
      entry.favorite = favorite
      dirty = true
      write()
      return entry
    },
    setNotes: (id, notes) => {
      const entry = entries.get(id)
      if (!entry) throw new Error(`gala: 收藏条目不存在 ${id}`)
      entry.notes = notes
      dirty = true
      write()
      return entry
    },
    save: write,
  }
}

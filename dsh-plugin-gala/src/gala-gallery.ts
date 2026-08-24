/**
 * 嘎啦图鉴服务（G1 · 角色化展示 + 图鉴 UI）— PRD v4.0 §5.2 / §16 G1
 *
 * 组合四路数据：
 * - ctx.gala 注册中心 → 已安装插件映射为嘎啦卡片（G4：id + name + rarity + 形象）
 * - collection.json 收藏状态（G7：收藏 / 取消收藏，首次亮相自动收录）
 * - recipes.json 合成配方 → 详情页配方展示（G6：description + compose 配方）
 * - 图鉴窗口打开（G5：Cmd/Ctrl+Shift+G；窗口创建由宿主注入，保持可单测）
 */

import type { GalaRegistry } from './gala-registry.ts'
import type { GalaCollectionStore } from './gala-collection.ts'
import type { ComposeRecipe } from './protocols/compose-protocol.ts'
import type { GalaRarity } from './protocols/gala-json.ts'

/** 图鉴快捷键（PRD §16 G5：Cmd/Ctrl+Shift+G） */
export const GALLERY_ACCELERATOR = 'CommandOrControl+Shift+G'

/** 图鉴卡片（G4：id + name + rarity + 形象） */
export interface GalleryCard {
  id: string
  name: string
  rarity: GalaRarity
  avatar: string
  favorite: boolean
  firstSeenAt?: string | undefined
  /** 产品默认 IP；原装不属于 IP，因此不会出现此标记。 */
  isDefault: boolean
}

/** 图鉴详情（G6：description + compose 配方） */
export interface GalleryDetail extends GalleryCard {
  family: string
  tier?: number | undefined
  description: string
  recipes: readonly ComposeRecipe[]
}

/** 嘎啦图鉴服务 */
export interface GalaGalleryService {
  /** 图鉴列表（按 id 稳定排序；首次亮相自动收录到 collection.json） */
  list(): readonly GalleryCard[]
  /** 嘎啦详情（含 description + 相关 compose 配方）；未知 id 返回 undefined */
  getDetail(id: string): GalleryDetail | undefined
  /** 收藏 / 取消收藏，返回切换后的状态；未知 id 抛错 */
  toggleFavorite(id: string): boolean
  /** 打开图鉴窗口 */
  open(): void
  /** 注册 Cmd/Ctrl+Shift+G 快捷键；返回注销函数。重复注册会先注销上一次 */
  registerGalleryShortcut(): () => void
}

/** 图鉴服务依赖（窗口与快捷键由宿主注入，便于 node 环境单测） */
export interface GalaGalleryOptions {
  registry: GalaRegistry
  collection: GalaCollectionStore
  /** 合成配方读取器（G6 详情展示用） */
  recipes: () => readonly ComposeRecipe[]
  /** 打开图鉴窗口（宿主实现：创建/聚焦图鉴 BrowserWindow） */
  openWindow: () => void
  /** 注册系统级快捷键（宿主实现：globalShortcut.register）；缺省则快捷键为 no-op */
  registerShortcut?: (accelerator: string, handler: () => void) => () => void
}

/** 创建嘎啦图鉴服务实例 */
export function createGalaGalleryService(options: GalaGalleryOptions): GalaGalleryService {
  const { registry, collection, recipes, openWindow, registerShortcut } = options

  const cardFor = (id: string): GalleryCard | undefined => {
    const character = registry.get(id)
    if (!character) return undefined
    const entry = collection.get(id)
    return {
      id: character.id,
      name: character.name,
      rarity: character.rarity,
      avatar: character.assets.avatar,
      favorite: entry?.favorite ?? false,
      firstSeenAt: entry?.firstSeenAt,
      isDefault: character.id === 'gala:stars',
    }
  }

  let shortcutCleanup: (() => void) | undefined

  return {
    list: () => {
      // Registry 的插入顺序就是产品顺序：全员 → 官方角色 → 自定义角色。
      const characters = [...registry.list()]
      for (const character of characters) collection.record(character.id) // 首次亮相即收录
      const cards: GalleryCard[] = []
      for (const character of characters) {
        const card = cardFor(character.id)
        if (card) cards.push(card)
      }
      return cards
    },
    getDetail: id => {
      const character = registry.get(id)
      if (!character) return undefined
      const card = cardFor(id)
      if (!card) return undefined
      return {
        ...card,
        family: character.family,
        tier: character.tier,
        description: character.description,
        recipes: recipes().filter(recipe => recipe.ingredients.includes(id)),
      }
    },
    toggleFavorite: id => {
      if (!registry.get(id)) throw new Error(`嘎啦未收录: ${id}`)
      const current = collection.get(id) ?? collection.record(id)
      const next = !current.favorite
      collection.setFavorite(id, next)
      return next
    },
    open: () => openWindow(),
    registerGalleryShortcut: () => {
      shortcutCleanup?.()
      shortcutCleanup = registerShortcut?.(GALLERY_ACCELERATOR, () => openWindow())
      return () => {
        shortcutCleanup?.()
        shortcutCleanup = undefined
      }
    },
  }
}

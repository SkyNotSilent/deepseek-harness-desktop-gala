/**
 * 合成系统服务（ctx.galaCompose）— PRD v4.0 §5.2 / §10 / §16 G3
 *
 * G3 里程碑完整实现：
 * - 配方加载（G12）：通过注入的 recipes() 加载 gala/recipes.json
 * - 合成前置检查（G13）：验证用户拥有所有 ingredient 嘎啦，缺则抛错
 * - 合成操作（G14）：确认 → 写 profile bundles → 重启
 * - 启动失败回滚（G15）：依赖 profile-manager 的 lastKnownGood 机制
 *   （main.ts 已接线：markDesktopProfileFailed + requestRelaunch）
 */

import type { ComposeRecipe } from './protocols/compose-protocol.ts'

/** 合成服务依赖注入（宿主提供，保持 node 环境可单测） */
export interface GalaComposeOptions {
  /** 已安装嘎啦 id 列表（素材判定，PRD §10.2） */
  owned: () => readonly string[]
  /** 配方加载器（gala/recipes.json，PRD §10.3） */
  recipes: () => readonly ComposeRecipe[]
  /** 当前 profile 的 bundles 列表 */
  readBundles: () => readonly string[]
  /** 写 profile bundles（合成产物，PRD §10.4） */
  writeBundles: (bundles: readonly string[]) => void
  /** 确认对话框；返回 true 表示用户确认继续 */
  confirm: (message: string) => boolean | Promise<boolean>
  /** 重启应用（PRD §10.1 一键切换大嘎啦） */
  relaunch: () => void
}

/** 合成系统服务（PRD §5.2 ctx.galaCompose） */
export interface GalaComposeService {
  /** 配方列表（G12） */
  recipes(): readonly ComposeRecipe[]
  /**
   * 前置检查：查找配方 + 验证拥有所有素材。
   * 配方不存在或缺少素材则抛错（G13）。
   */
  check(recipeId: string): ComposeRecipe
  /**
   * 合成操作：check → 用户确认 → 写 bundles → 重启。
   * 返回 true 表示合成已提交（等待重启生效）；用户取消返回 false。
   * 启动失败回滚由 profile-manager 的 lastKnownGood 机制处理（G15）。
   */
  compose(recipeId: string): Promise<boolean>
}

/** 创建合成系统服务实例 */
export function createGalaComposeService(options: GalaComposeOptions): GalaComposeService {
  const { owned, recipes, writeBundles, confirm, relaunch } = options

  const check = (recipeId: string): ComposeRecipe => {
    const all = recipes()
    const recipe = all.find(r => r.id === recipeId)
    if (!recipe) {
      throw new Error(`gala: 找不到配方 ${recipeId}`)
    }
    const ownedIds = owned()
    const missing = recipe.ingredients.filter(id => !ownedIds.includes(id))
    if (missing.length > 0) {
      throw new Error(`gala: 缺少合成素材 ${missing.join(', ')}`)
    }
    return recipe
  }

  return {
    recipes,
    check,
    compose: async recipeId => {
      const recipe = check(recipeId)
      const ok = await confirm(`确认合成「${recipe.name}」？`)
      if (!ok) return false
      writeBundles(recipe.output.bundles)
      relaunch()
      return true
    },
  }
}
/**
 * 嘎啦注册中心（ctx.gala）— PRD v4.0 §5.2 / §8
 *
 * 维护已收集嘎啦角色的元数据注册表；未提供 `gala.json` 的插件
 * 按 §8.4 缺省规则自动生成默认嘎啦。
 */

import type { GalaCharacter } from './protocols/gala-json.ts'

/** 默认占位头像（PRD §8.4：使用默认占位头像） */
export const DEFAULT_GALA_AVATAR = 'assets/gala-default-avatar.png'

/**
 * 按 PRD §8.4 缺省规则为未声明 `gala.json` 的插件生成默认嘎啦：
 * - id = gala:<package-name>（归一化小写 slug）
 * - name = <package-name>
 * - type = character / family = system / rarity = common / tier = 1
 * - 使用默认占位头像
 */
export function defaultGalaForPackage(packageName: string): GalaCharacter {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
  // id pattern 要求至少 3 个字符（^gala:[a-z0-9-]{3,64}$）
  const slug = base.length >= 3 ? base : `${base || 'gala'}-gala`
  return {
    id: `gala:${slug}`,
    name: packageName,
    type: 'character',
    family: 'system',
    rarity: 'common',
    tier: 1,
    description: `默认嘎啦：${packageName}`,
    assets: { avatar: DEFAULT_GALA_AVATAR },
    author: 'system',
    version: '1.0.0',
  }
}

/** 嘎啦注册中心（PRD §5.2 ctx.gala） */
export interface GalaRegistry {
  list(): readonly GalaCharacter[]
  get(id: string): GalaCharacter | undefined
  register(character: GalaCharacter): void
  /** 注销嘎啦（市场包回滚，PRD §11.5）；返回是否确有该 id */
  unregister(id: string): boolean
}

/** 创建嘎啦注册中心实例（同 id 重复注册视为替换） */
export function createGalaRegistry(): GalaRegistry {
  const characters = new Map<string, GalaCharacter>()
  return {
    list: () => [...characters.values()],
    get: id => characters.get(id),
    register: character => {
      characters.set(character.id, character)
    },
    unregister: id => characters.delete(id),
  }
}

import { describe, expect, it } from 'vitest'
import { createGalaComposeService } from '../src/gala-compose.ts'
import type { ComposeRecipe } from '../src/protocols/compose-protocol.ts'

const duoRecipe: ComposeRecipe = {
  id: 'gala:alpha-beta-duo',
  name: '阿尔法贝塔双人组',
  type: 'bundle',
  tier: 2,
  ingredients: ['gala:alpha', 'gala:beta'],
  output: { bundles: ['@deepseek-ai/dsh-base', 'gala-character-alpha', 'gala-character-beta'] },
  description: '两只小嘎啦。',
}

const trioRecipe: ComposeRecipe = {
  id: 'gala:alpha-beta-gamma-trio',
  name: '三小强',
  type: 'bundle',
  tier: 3,
  ingredients: ['gala:alpha', 'gala:beta', 'gala:gamma'],
  output: { bundles: ['@deepseek-ai/dsh-base', 'gala-character-alpha', 'gala-character-beta', 'gala-character-gamma'] },
  description: '三只小嘎啦。',
}

describe('G13 · 合成前置检查（缺少 ingredients → 抛错）', () => {
  it('check 通过：拥有所有素材', () => {
    const service = createGalaComposeService({
      owned: () => ['gala:alpha', 'gala:beta'],
      recipes: () => [duoRecipe],
      readBundles: () => [],
      writeBundles: () => {},
      confirm: () => true,
      relaunch: () => {},
    })
    const recipe = service.check('gala:alpha-beta-duo')
    expect(recipe.name).toBe('阿尔法贝塔双人组')
  })

  it('check 抛错：缺少一个素材', () => {
    const service = createGalaComposeService({
      owned: () => ['gala:alpha'],
      recipes: () => [duoRecipe],
      readBundles: () => [],
      writeBundles: () => {},
      confirm: () => true,
      relaunch: () => {},
    })
    expect(() => service.check('gala:alpha-beta-duo')).toThrow('缺少合成素材')
    expect(() => service.check('gala:alpha-beta-duo')).toThrow('gala:beta')
  })

  it('check 抛错：缺少多个素材', () => {
    const service = createGalaComposeService({
      owned: () => ['gala:alpha'],
      recipes: () => [trioRecipe],
      readBundles: () => [],
      writeBundles: () => {},
      confirm: () => true,
      relaunch: () => {},
    })
    expect(() => service.check('gala:alpha-beta-gamma-trio')).toThrow('缺少合成素材')
    expect(() => service.check('gala:alpha-beta-gamma-trio')).toThrow('gala:beta')
    expect(() => service.check('gala:alpha-beta-gamma-trio')).toThrow('gala:gamma')
  })

  it('check 抛错：配方不存在', () => {
    const service = createGalaComposeService({
      owned: () => ['gala:alpha', 'gala:beta'],
      recipes: () => [duoRecipe],
      readBundles: () => [],
      writeBundles: () => {},
      confirm: () => true,
      relaunch: () => {},
    })
    expect(() => service.check('gala:nonexistent')).toThrow('找不到配方')
  })

  it('check 抛错：无任何素材', () => {
    const service = createGalaComposeService({
      owned: () => [],
      recipes: () => [duoRecipe],
      readBundles: () => [],
      writeBundles: () => {},
      confirm: () => true,
      relaunch: () => {},
    })
    expect(() => service.check('gala:alpha-beta-duo')).toThrow('缺少合成素材')
  })
})
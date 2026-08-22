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

describe('G14 · 合成操作（确认 → 写 bundles → 重启）', () => {
  it('compose 确认后写入 bundles 并触发重启', async () => {
    let written: readonly string[] | undefined
    let relaunched = false

    const service = createGalaComposeService({
      owned: () => ['gala:alpha', 'gala:beta'],
      recipes: () => [duoRecipe],
      readBundles: () => [],
      writeBundles: bundles => { written = bundles },
      confirm: () => true,
      relaunch: () => { relaunched = true },
    })

    const result = await service.compose('gala:alpha-beta-duo')
    expect(result).toBe(true)
    expect(written).toEqual(['@deepseek-ai/dsh-base', 'gala-character-alpha', 'gala-character-beta'])
    expect(relaunched).toBe(true)
  })

  it('compose 用户取消则不写入也不重启', async () => {
    let written = false
    let relaunched = false

    const service = createGalaComposeService({
      owned: () => ['gala:alpha', 'gala:beta'],
      recipes: () => [duoRecipe],
      readBundles: () => [],
      writeBundles: () => { written = true },
      confirm: () => false,
      relaunch: () => { relaunched = true },
    })

    const result = await service.compose('gala:alpha-beta-duo')
    expect(result).toBe(false)
    expect(written).toBe(false)
    expect(relaunched).toBe(false)
  })

  it('compose 缺少素材时抛错，不写入不重启', async () => {
    let written = false
    let relaunched = false

    const service = createGalaComposeService({
      owned: () => [],
      recipes: () => [duoRecipe],
      readBundles: () => [],
      writeBundles: () => { written = true },
      confirm: () => true,
      relaunch: () => { relaunched = true },
    })

    await expect(service.compose('gala:alpha-beta-duo')).rejects.toThrow('缺少合成素材')
    expect(written).toBe(false)
    expect(relaunched).toBe(false)
  })

  it('compose 配方不存在时抛错', async () => {
    let written = false
    let relaunched = false

    const service = createGalaComposeService({
      owned: () => ['gala:alpha', 'gala:beta'],
      recipes: () => [duoRecipe],
      readBundles: () => [],
      writeBundles: () => { written = true },
      confirm: () => true,
      relaunch: () => { relaunched = true },
    })

    await expect(service.compose('gala:nonexistent')).rejects.toThrow('找不到配方')
    expect(written).toBe(false)
    expect(relaunched).toBe(false)
  })
})
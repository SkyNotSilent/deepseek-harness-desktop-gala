import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadComposeRecipes } from '../src/protocols/compose-protocol.ts'
import { createGalaComposeService } from '../src/gala-compose.ts'
import type { ComposeRecipe } from '../src/protocols/compose-protocol.ts'

/** PRD §10.3 示例配方 */
const exampleRecipe: ComposeRecipe = {
  id: 'gala:alpha-beta-duo',
  name: '阿尔法贝塔双人组',
  type: 'bundle',
  tier: 2,
  ingredients: ['gala:alpha', 'gala:beta'],
  output: {
    bundles: [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'gala-character-alpha',
      'gala-character-beta',
    ],
  },
  description: '两只小嘎啦组成的小团队。',
}

describe('G12 · 配方加载（gala/recipes.json）', () => {
  it('loadComposeRecipes 加载有效 recipes.json 返回配方列表', () => {
    const dir = join(tmpdir(), 'g12-load')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'recipes.json')
    writeFileSync(file, JSON.stringify({ recipes: [exampleRecipe] }), 'utf8')

    const loaded = loadComposeRecipes(file)
    expect(loaded).toHaveLength(1)
    const first = loaded[0]
    expect(first).toBeDefined()
    expect(first!.id).toBe('gala:alpha-beta-duo')
    expect(first!.output.bundles).toHaveLength(4)
  })

  it('loadComposeRecipes 文件缺失时返回空数组', () => {
    const dir = join(tmpdir(), 'g12-missing')
    mkdirSync(dir, { recursive: true })
    const loaded = loadComposeRecipes(join(dir, 'nonexistent.json'))
    expect(loaded).toEqual([])
  })

  it('loadComposeRecipes 非法 JSON 抛错', () => {
    const dir = join(tmpdir(), 'g12-invalid')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'recipes.json')
    writeFileSync(file, '这显然不是 JSON', 'utf8')

    expect(() => loadComposeRecipes(file)).toThrow('recipes.json 解析失败')
  })

  it('loadComposeRecipes schema 校验失败抛错', () => {
    const dir = join(tmpdir(), 'g12-schema')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'recipes.json')
    writeFileSync(file, JSON.stringify({ recipes: [{ id: 'bad' }] }), 'utf8')

    expect(() => loadComposeRecipes(file)).toThrow('recipes.json 校验失败')
  })

  it('galaCompose.recipes() 返回注入的配方列表', () => {
    const recipes: ComposeRecipe[] = [exampleRecipe]
    const service = createGalaComposeService({
      owned: () => [],
      recipes: () => recipes,
      readBundles: () => [],
      writeBundles: () => {},
      confirm: () => true,
      relaunch: () => {},
    })
    expect(service.recipes()).toHaveLength(1)
    const first = service.recipes()[0]
    expect(first).toBeDefined()
    expect(first!.name).toBe('阿尔法贝塔双人组')
  })
})
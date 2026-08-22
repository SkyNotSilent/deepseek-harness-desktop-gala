import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGalaRegistry, defaultGalaForPackage } from '../src/gala-registry.ts'
import { createGalaCollectionStore } from '../src/gala-collection.ts'
import { createGalaGalleryService } from '../src/gala-gallery.ts'
import type { ComposeRecipe } from '../src/protocols/compose-protocol.ts'

const duoRecipe: ComposeRecipe = {
  id: 'gala:alpha-beta-duo',
  name: '阿尔法贝塔双人组',
  type: 'bundle',
  tier: 2,
  ingredients: ['gala:alpha', 'gala:beta'],
  output: { bundles: ['@deepseek-ai/dsh-base', 'gala-character-alpha', 'gala-character-beta'] },
  description: '两只小嘎啦组成的小团队。',
}

describe('gala almanac detail（G6）', () => {
  it('shows description and compose recipes for a collected gala', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g06-'))
    const registry = createGalaRegistry()
    const alpha = defaultGalaForPackage('alpha')
    alpha.description = '小阿尔法，新手村的守护者。'
    registry.register(alpha)
    registry.register(defaultGalaForPackage('beta'))
    const gallery = createGalaGalleryService({
      registry,
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [duoRecipe],
      openWindow: () => {},
    })

    const detail = gallery.getDetail('gala:alpha')

    expect(detail).toBeDefined()
    expect(detail?.description).toBe('小阿尔法，新手村的守护者。')
    expect(detail?.family).toBe('system')
    expect(detail?.recipes).toHaveLength(1)
    expect(detail?.recipes[0]?.id).toBe('gala:alpha-beta-duo')
    expect(detail?.recipes[0]?.ingredients).toEqual(['gala:alpha', 'gala:beta'])
  })

  it('filters recipes to those involving the requested gala', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g06-'))
    const registry = createGalaRegistry()
    registry.register(defaultGalaForPackage('alpha'))
    registry.register(defaultGalaForPackage('beta'))
    registry.register(defaultGalaForPackage('gamma'))
    const gallery = createGalaGalleryService({
      registry,
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [duoRecipe],
      openWindow: () => {},
    })

    const gamma = gallery.getDetail('gala:gamma')

    expect(gamma?.recipes).toHaveLength(0)
  })

  it('returns undefined for unknown gala ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g06-'))
    const gallery = createGalaGalleryService({
      registry: createGalaRegistry(),
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [duoRecipe],
      openWindow: () => {},
    })

    expect(gallery.getDetail('gala:missing')).toBeUndefined()
  })
})

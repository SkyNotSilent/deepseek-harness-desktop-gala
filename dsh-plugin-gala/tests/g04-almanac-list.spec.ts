import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGalaRegistry, defaultGalaForPackage } from '../src/gala-registry.ts'
import { createGalaCollectionStore } from '../src/gala-collection.ts'
import { createGalaGalleryService } from '../src/gala-gallery.ts'

describe('gala almanac list（G4）', () => {
  it('lists installed plugins as gala cards with id + name + rarity + avatar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g04-'))
    const registry = createGalaRegistry()
    registry.register(defaultGalaForPackage('alpha'))
    registry.register(defaultGalaForPackage('beta'))
    const gallery = createGalaGalleryService({
      registry,
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [],
      openWindow: () => {},
    })

    const cards = gallery.list()

    expect(cards).toHaveLength(2)
    const alpha = cards.find(card => card.id === 'gala:alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.name).toBe('alpha')
    expect(alpha?.rarity).toBe('common')
    expect(alpha?.avatar).toMatch(/^assets\//)
  })

  it('preserves registry product order and auto-records first appearance into collection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g04-'))
    const registry = createGalaRegistry()
    registry.register(defaultGalaForPackage('zeta'))
    registry.register(defaultGalaForPackage('alpha'))
    const collection = createGalaCollectionStore(join(dir, 'collection.json'))
    const gallery = createGalaGalleryService({
      registry,
      collection,
      recipes: () => [],
      openWindow: () => {},
    })

    const cards = gallery.list()

    expect(cards.map(card => card.id)).toEqual(['gala:zeta', 'gala:alpha'])
    expect(collection.list()).toHaveLength(2)
    expect(collection.get('gala:alpha')?.firstSeenAt).toBeTruthy()
  })
})

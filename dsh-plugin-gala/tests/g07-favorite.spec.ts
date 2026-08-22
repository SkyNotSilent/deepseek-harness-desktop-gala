import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGalaRegistry, defaultGalaForPackage } from '../src/gala-registry.ts'
import { createGalaCollectionStore } from '../src/gala-collection.ts'
import { createGalaGalleryService } from '../src/gala-gallery.ts'

describe('gala favorite（G7）', () => {
  it('toggles favorite and returns the new state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g07-'))
    const registry = createGalaRegistry()
    registry.register(defaultGalaForPackage('alpha'))
    const gallery = createGalaGalleryService({
      registry,
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [],
      openWindow: () => {},
    })

    expect(gallery.toggleFavorite('gala:alpha')).toBe(true)
    expect(gallery.toggleFavorite('gala:alpha')).toBe(false)
    expect(gallery.toggleFavorite('gala:alpha')).toBe(true)
  })

  it('persists favorite state to collection.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g07-'))
    const file = join(dir, 'collection.json')
    const registry = createGalaRegistry()
    registry.register(defaultGalaForPackage('alpha'))
    registry.register(defaultGalaForPackage('beta'))
    const gallery = createGalaGalleryService({
      registry,
      collection: createGalaCollectionStore(file),
      recipes: () => [],
      openWindow: () => {},
    })

    gallery.list() // 自动收录
    gallery.toggleFavorite('gala:alpha')

    expect(existsSync(file)).toBe(true)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      version: number
      collected: Array<{ id: string; favorite: boolean }>
    }
    expect(saved.version).toBe(1)
    expect(saved.collected).toHaveLength(2)
    expect(saved.collected.find(entry => entry.id === 'gala:alpha')?.favorite).toBe(true)
    expect(saved.collected.find(entry => entry.id === 'gala:beta')?.favorite).toBe(false)
  })

  it('reflects favorite state in subsequent list calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g07-'))
    const file = join(dir, 'collection.json')
    const registry = createGalaRegistry()
    registry.register(defaultGalaForPackage('alpha'))
    const gallery = createGalaGalleryService({
      registry,
      collection: createGalaCollectionStore(file),
      recipes: () => [],
      openWindow: () => {},
    })

    gallery.list()
    gallery.toggleFavorite('gala:alpha')

    const reloaded = createGalaGalleryService({
      registry,
      collection: createGalaCollectionStore(file),
      recipes: () => [],
      openWindow: () => {},
    })
    const cards = reloaded.list()

    expect(cards.find(card => card.id === 'gala:alpha')?.favorite).toBe(true)
  })

  it('throws for unknown gala ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g07-'))
    const gallery = createGalaGalleryService({
      registry: createGalaRegistry(),
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [],
      openWindow: () => {},
    })

    expect(() => gallery.toggleFavorite('gala:missing')).toThrow(/嘎啦未收录/)
  })
})

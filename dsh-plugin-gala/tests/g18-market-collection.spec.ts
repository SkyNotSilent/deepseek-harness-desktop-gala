import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGalaCollectionStore } from '../src/gala-collection.ts'
import { createGalaGalleryService } from '../src/gala-gallery.ts'
import { createGalaMarketService } from '../src/gala-market.ts'
import { createGalaRegistry } from '../src/gala-registry.ts'
import { sampleCharacter, writeGgal } from './helpers/ggal-fixture.ts'

const workspaces: string[] = []

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'gala-collection-'))
  workspaces.push(root)
  const registry = createGalaRegistry()
  const collection = createGalaCollectionStore(join(root, 'gala', 'collection.json'))
  const gallery = createGalaGalleryService({
    registry,
    collection,
    recipes: () => [],
    openWindow: () => {},
  })
  const marketDir = join(root, 'gala', 'market')
  const market = createGalaMarketService({
    marketDir,
    registry,
    readBundles: () => [],
    writeBundles: () => {},
  })
  return { root, marketDir, registry, collection, gallery, market }
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('G18 · 导入后图鉴出现新嘎啦', () => {
  it('导入角色包后图鉴列表出现该嘎啦并自动收录', async () => {
    const { root, gallery, market, collection } = workspace()
    expect(gallery.list()).toHaveLength(0)

    await market.import(writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() }))

    const cards = gallery.list()
    expect(cards.map(card => card.id)).toEqual(['gala:ocean-sprite'])
    expect(cards[0]?.rarity).toBe('rare')
    expect(cards[0]?.avatar).toBe('assets/avatar.png')
    expect(collection.get('gala:ocean-sprite')?.firstSeenAt).toBeTypeOf('string')
  })

  it('导入的嘎啦可以查看详情并收藏', async () => {
    const { root, gallery, market } = workspace()
    await market.import(writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() }))

    expect(gallery.getDetail('gala:ocean-sprite')?.description).toBe('住在数据海里的小嘎啦。')
    expect(gallery.toggleFavorite('gala:ocean-sprite')).toBe(true)
    expect(gallery.list()[0]?.favorite).toBe(true)
  })

  it('皮肤包不进角色图鉴（由 ctx.galaSkin 管理）', async () => {
    const { root, gallery, market, registry } = workspace()
    const result = await market.import(
      writeGgal(join(root, 'skin.ggal'), {
        character: sampleCharacter({ id: 'gala:ocean-skin', type: 'skin' }),
      }),
    )

    expect(result.success).toBe(true)
    expect(registry.get('gala:ocean-skin')).toBeUndefined()
    expect(gallery.list()).toHaveLength(0)
    expect(market.list().map(item => item.id)).toEqual(['gala:ocean-skin'])
  })

  it('重启后 restore() 让导入的嘎啦重新出现在图鉴', async () => {
    const { root, marketDir, market } = workspace()
    await market.import(writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() }))

    const registry = createGalaRegistry()
    const collection = createGalaCollectionStore(join(root, 'gala', 'collection.json'))
    const restarted = createGalaMarketService({
      marketDir,
      registry,
      readBundles: () => [],
      writeBundles: () => {},
    })
    restarted.restore()
    const gallery = createGalaGalleryService({
      registry,
      collection,
      recipes: () => [],
      openWindow: () => {},
    })

    expect(gallery.list().map(card => card.id)).toEqual(['gala:ocean-sprite'])
  })
})

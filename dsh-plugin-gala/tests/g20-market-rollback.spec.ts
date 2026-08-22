import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGalaCollectionStore } from '../src/gala-collection.ts'
import { createGalaGalleryService } from '../src/gala-gallery.ts'
import { createGalaMarketService } from '../src/gala-market.ts'
import { createGalaRegistry } from '../src/gala-registry.ts'
import { sampleCharacter, writeGgal } from './helpers/ggal-fixture.ts'

const workspaces: string[] = []

function workspace(initialBundles: readonly string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'gala-rollback-'))
  workspaces.push(root)
  const marketDir = join(root, 'market')
  const registry = createGalaRegistry()
  let bundles = initialBundles
  const writes: (readonly string[])[] = []
  const market = createGalaMarketService({
    marketDir,
    registry,
    readBundles: () => bundles,
    writeBundles: next => {
      bundles = next
      writes.push(next)
    },
  })
  const gallery = createGalaGalleryService({
    registry,
    collection: createGalaCollectionStore(join(root, 'collection.json')),
    recipes: () => [],
    openWindow: () => {},
  })
  return { root, marketDir, registry, market, gallery, writes, bundles: () => bundles }
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('G20 · 回滚（删包 + 从 bundles 移除 + 图鉴刷新）', () => {
  it('回滚删除包目录、注销图鉴条目', async () => {
    const { root, marketDir, market, gallery, registry } = workspace()
    await market.import(writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() }))
    expect(gallery.list()).toHaveLength(1)

    market.rollback('gala:ocean-sprite')

    expect(existsSync(join(marketDir, 'ocean-sprite'))).toBe(false)
    expect(registry.get('gala:ocean-sprite')).toBeUndefined()
    expect(gallery.list()).toHaveLength(0)
    expect(market.list()).toHaveLength(0)
  })

  it('回滚把包从 profile bundles 中移除，保留其他 bundle', async () => {
    const { root, market, writes, bundles } = workspace([
      '@deepseek-ai/dsh-base',
      'gala:ocean-sprite',
      '@deepseek-ai/dsh-web-app',
    ])
    await market.import(writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() }))

    market.rollback('gala:ocean-sprite')

    expect(writes).toHaveLength(1)
    expect(bundles()).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  })

  it('bundles 里用无前缀 slug 记录时同样能移除', async () => {
    const { root, market, bundles } = workspace(['ocean-sprite', '@deepseek-ai/dsh-base'])
    await market.import(writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() }))

    market.rollback('gala:ocean-sprite')

    expect(bundles()).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('包不在 bundles 中时不写 profile（避免无谓改动）', async () => {
    const { root, market, writes } = workspace(['@deepseek-ai/dsh-base'])
    await market.import(writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() }))

    market.rollback('gala:ocean-sprite')

    expect(writes).toHaveLength(0)
  })

  it('回滚不存在的包是幂等 no-op', () => {
    const { market } = workspace()
    expect(() => market.rollback('gala:never-installed')).not.toThrow()
    expect(() => market.rollback('gala:never-installed')).not.toThrow()
  })

  it('回滚后可以重新导入同一个包', async () => {
    const { root, market, gallery } = workspace()
    const ggal = writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() })
    await market.import(ggal)
    market.rollback('gala:ocean-sprite')

    await expect(market.import(ggal)).resolves.toMatchObject({ success: true, conflict: undefined })
    expect(gallery.list()).toHaveLength(1)
  })
})

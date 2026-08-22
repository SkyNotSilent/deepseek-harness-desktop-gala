import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGalaMarketService, type ConflictResolution } from '../src/gala-market.ts'
import { createGalaRegistry } from '../src/gala-registry.ts'
import { sampleCharacter, writeGgal } from './helpers/ggal-fixture.ts'

const workspaces: string[] = []

function workspace(onConflict?: (id: string) => ConflictResolution) {
  const root = mkdtempSync(join(tmpdir(), 'gala-conflict-'))
  workspaces.push(root)
  const marketDir = join(root, 'market')
  const registry = createGalaRegistry()
  const asked: string[] = []
  const market = createGalaMarketService({
    marketDir,
    registry,
    readBundles: () => [],
    writeBundles: () => {},
    ...(onConflict
      ? {
          onConflict: (id: string) => {
            asked.push(id)
            return onConflict(id)
          },
        }
      : {}),
  })
  return { root, marketDir, registry, market, asked }
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('G19 · 导入冲突提示覆盖 / 跳过 / 重命名', () => {
  it('跳过：保留旧包，不落地新内容', async () => {
    const { root, marketDir, market, asked } = workspace(() => ({ action: 'skip' }))
    const first = writeGgal(join(root, 'v1.ggal'), {
      character: sampleCharacter({ description: '第一版。' }),
    })
    await market.import(first)

    const second = writeGgal(join(root, 'v2.ggal'), {
      character: sampleCharacter({ description: '第二版。' }),
    })
    const result = await market.import(second)

    expect(result).toMatchObject({ success: false, conflict: 'skip', id: 'gala:ocean-sprite' })
    expect(asked).toEqual(['gala:ocean-sprite'])
    const landed = JSON.parse(readFileSync(join(marketDir, 'ocean-sprite', 'gala.json'), 'utf8')) as { description: string }
    expect(landed.description).toBe('第一版。')
  })

  it('覆盖：旧包被替换为新内容', async () => {
    const { root, marketDir, market, registry } = workspace(() => ({ action: 'overwrite' }))
    await market.import(
      writeGgal(join(root, 'v1.ggal'), {
        character: sampleCharacter({ description: '第一版。' }),
        extras: [{ path: 'old-only.txt', data: 'stale' }],
      }),
    )
    const result = await market.import(
      writeGgal(join(root, 'v2.ggal'), {
        character: sampleCharacter({ description: '第二版。', version: '2.0.0' }),
      }),
    )

    expect(result).toMatchObject({ success: true, conflict: 'overwrite' })
    const landed = JSON.parse(readFileSync(join(marketDir, 'ocean-sprite', 'gala.json'), 'utf8')) as { description: string }
    expect(landed.description).toBe('第二版。')
    expect(existsSync(join(marketDir, 'ocean-sprite', 'old-only.txt'))).toBe(false)
    expect(registry.get('gala:ocean-sprite')?.version).toBe('2.0.0')
  })

  it('重命名：新包以新 id 落到独立目录，旧包保持不动', async () => {
    const { root, marketDir, market, registry } = workspace(() => ({ action: 'rename', id: 'ocean-sprite-2' }))
    await market.import(
      writeGgal(join(root, 'v1.ggal'), { character: sampleCharacter({ description: '第一版。' }) }),
    )
    const result = await market.import(
      writeGgal(join(root, 'v2.ggal'), { character: sampleCharacter({ description: '第二版。' }) }),
    )

    expect(result).toMatchObject({ success: true, conflict: 'rename', id: 'gala:ocean-sprite-2' })
    expect(readdirSync(marketDir).sort()).toEqual(['ocean-sprite', 'ocean-sprite-2'])
    const renamed = JSON.parse(
      readFileSync(join(marketDir, 'ocean-sprite-2', 'gala.json'), 'utf8'),
    ) as { id: string; description: string }
    expect(renamed.id).toBe('gala:ocean-sprite-2') // 落盘的 gala.json 也改写为新 id
    expect(renamed.description).toBe('第二版。')
    expect(registry.get('gala:ocean-sprite')?.description).toBe('第一版。')
    expect(registry.get('gala:ocean-sprite-2')?.description).toBe('第二版。')
  })

  it('重命名目标同样冲突时抛错且不落地', async () => {
    const { root, marketDir, market } = workspace(() => ({ action: 'rename', id: 'ocean-sprite' }))
    await market.import(writeGgal(join(root, 'v1.ggal'), { character: sampleCharacter() }))

    await expect(
      market.import(writeGgal(join(root, 'v2.ggal'), { character: sampleCharacter() })),
    ).rejects.toThrow('同样已存在')
    expect(readdirSync(marketDir)).toEqual(['ocean-sprite'])
  })

  it('未提供冲突回调时默认跳过（不静默覆盖）', async () => {
    const { root, market } = workspace()
    await market.import(writeGgal(join(root, 'v1.ggal'), { character: sampleCharacter() }))
    const result = await market.import(writeGgal(join(root, 'v2.ggal'), { character: sampleCharacter() }))

    expect(result).toMatchObject({ success: false, conflict: 'skip' })
  })
})

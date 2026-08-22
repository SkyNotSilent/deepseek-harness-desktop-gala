import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGalaMarketService } from '../src/gala-market.ts'
import { createGalaRegistry } from '../src/gala-registry.ts'
import { readGgalPackage } from '../src/ggal-zip.ts'
import { ggalEntries, sampleCharacter, writeGgal } from './helpers/ggal-fixture.ts'

const workspaces: string[] = []

function workspace(): { root: string; marketDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'gala-market-'))
  workspaces.push(root)
  return { root, marketDir: join(root, 'market') }
}

function market(marketDir: string) {
  const registry = createGalaRegistry()
  let bundles: readonly string[] = []
  const service = createGalaMarketService({
    marketDir,
    registry,
    readBundles: () => bundles,
    writeBundles: next => { bundles = next },
  })
  return { service, registry }
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('G16 · .ggal 导入成功（解压 + 注册 + 图鉴刷新）', () => {
  it('导入合法包后文件落地、元数据注册、返回落地目录', async () => {
    const { root, marketDir } = workspace()
    const character = sampleCharacter()
    const ggal = writeGgal(join(root, 'ocean.ggal'), {
      character,
      extras: [{ path: 'assets/avatar.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }],
    })

    const { service, registry } = market(marketDir)
    const result = await service.import(ggal)

    expect(result.success).toBe(true)
    expect(result.id).toBe('gala:ocean-sprite')
    expect(result.type).toBe('character')
    expect(result.dir).toBe(join(marketDir, 'ocean-sprite'))
    expect(existsSync(join(marketDir, 'ocean-sprite', 'gala.json'))).toBe(true)
    expect(existsSync(join(marketDir, 'ocean-sprite', 'assets', 'avatar.png'))).toBe(true)
    expect(registry.get('gala:ocean-sprite')?.name).toBe('海洋小精灵')
  })

  it('deflate 压缩的包同样可以导入', async () => {
    const { root, marketDir } = workspace()
    const ggal = writeGgal(
      join(root, 'ocean.ggal'),
      { character: sampleCharacter(), extras: [{ path: 'README.md', data: 'x'.repeat(4096) }] },
      'deflate',
    )

    const { service } = market(marketDir)
    await expect(service.import(ggal)).resolves.toMatchObject({ success: true })
    expect(readFileSync(join(marketDir, 'ocean-sprite', 'README.md'), 'utf8')).toBe('x'.repeat(4096))
  })

  it('list() 与 restore() 从磁盘恢复已安装包', async () => {
    const { root, marketDir } = workspace()
    const ggal = writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() })
    const first = market(marketDir)
    await first.service.import(ggal)

    const { service, registry } = market(marketDir) // 模拟重启：全新注册中心
    expect(registry.get('gala:ocean-sprite')).toBeUndefined()
    expect(service.list().map(item => item.id)).toEqual(['gala:ocean-sprite'])
    service.restore()
    expect(registry.get('gala:ocean-sprite')?.name).toBe('海洋小精灵')
  })

  it('系统 zip 产出的包也能读（交叉验证 zip 格式解析）', () => {
    const { root } = workspace()
    const staging = join(root, 'staging')
    for (const entry of ggalEntries({ character: sampleCharacter() })) {
      const target = join(staging, entry.path)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, entry.data)
    }
    const ggal = join(root, 'system.ggal')
    try {
      execFileSync('zip', ['-q', '-r', ggal, 'manifest.json', 'gala.json'], { cwd: staging })
    } catch {
      return // 环境无 zip CLI：跳过交叉验证，不让单测依赖外部工具
    }
    const paths = readGgalPackage(ggal).map(entry => entry.path)
    expect(paths).toContain('manifest.json')
    expect(paths).toContain('gala.json')
  })
})

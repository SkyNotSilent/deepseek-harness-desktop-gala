import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGalaMarketService, isSafeEntryPath } from '../src/gala-market.ts'
import { createGalaRegistry } from '../src/gala-registry.ts'
import { MAX_EXTRACTED_BYTES, readGgalPackage } from '../src/ggal-zip.ts'
import { buildZip, ggalEntries, sampleCharacter, writeGgal, type FixtureEntry } from './helpers/ggal-fixture.ts'

const workspaces: string[] = []

function workspace(): { root: string; marketDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'gala-reject-'))
  workspaces.push(root)
  return { root, marketDir: join(root, 'market') }
}

function market(marketDir: string) {
  const registry = createGalaRegistry()
  const service = createGalaMarketService({
    marketDir,
    registry,
    readBundles: () => [],
    writeBundles: () => { throw new Error('rejected import must not touch bundles') },
  })
  return { service, registry }
}

/** 直接落一个 zip，绕过 fixture 的自动摘要计算 */
function writeRawGgal(path: string, entries: readonly FixtureEntry[]): string {
  writeFileSync(path, buildZip(entries))
  return path
}

function marketIsClean(marketDir: string): boolean {
  if (!existsSync(marketDir)) return true
  return readdirSync(marketDir).length === 0
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('G17 · 非法包拒绝导入（不写盘）', () => {
  it('manifest schema 非法则拒绝', async () => {
    const { root, marketDir } = workspace()
    const ggal = writeGgal(join(root, 'bad.ggal'), {
      character: sampleCharacter(),
      manifestOverrides: { schema: '9.9' },
    })
    const { service, registry } = market(marketDir)

    await expect(service.import(ggal)).rejects.toThrow('manifest.json 校验失败')
    expect(marketIsClean(marketDir)).toBe(true)
    expect(registry.list()).toHaveLength(0)
  })

  it('sha256 摘要不匹配则拒绝', async () => {
    const { root, marketDir } = workspace()
    const ggal = writeGgal(join(root, 'bad.ggal'), {
      character: sampleCharacter(),
      manifestOverrides: { sha256: 'f'.repeat(64) },
    })
    const { service } = market(marketDir)

    await expect(service.import(ggal)).rejects.toThrow('摘要不匹配')
    expect(marketIsClean(marketDir)).toBe(true)
  })

  it('gala.json 非法则拒绝（id 不符合 gala: 规范）', async () => {
    const { root, marketDir } = workspace()
    const character = { ...sampleCharacter(), id: 'ocean-sprite' } as ReturnType<typeof sampleCharacter>
    const ggal = writeGgal(join(root, 'bad.ggal'), {
      character,
      manifestOverrides: { id: 'ocean-sprite' },
    })
    const { service } = market(marketDir)

    await expect(service.import(ggal)).rejects.toThrow('gala.json 校验失败')
    expect(marketIsClean(marketDir)).toBe(true)
  })

  it('manifest.id 与 gala.json id 不一致则拒绝', async () => {
    const { root, marketDir } = workspace()
    const ggal = writeGgal(join(root, 'bad.ggal'), {
      character: sampleCharacter(),
      manifestOverrides: { id: 'other-sprite' },
    })
    const { service } = market(marketDir)

    await expect(service.import(ggal)).rejects.toThrow('不一致')
    expect(marketIsClean(marketDir)).toBe(true)
  })

  it('路径越界（..）则拒绝，且不写出目录外文件', async () => {
    const { root, marketDir } = workspace()
    const character = sampleCharacter()
    const entries = ggalEntries({
      character,
      extras: [{ path: '../escaped.txt', data: 'pwned' }],
    })
    const ggal = writeRawGgal(join(root, 'evil.ggal'), entries)
    const { service } = market(marketDir)

    await expect(service.import(ggal)).rejects.toThrow('非法路径')
    expect(existsSync(join(root, 'escaped.txt'))).toBe(false)
    expect(marketIsClean(marketDir)).toBe(true)
  })

  it('绝对路径与反斜杠路径都判定为非法', () => {
    expect(isSafeEntryPath('assets/avatar.png')).toBe(true)
    expect(isSafeEntryPath('/etc/passwd')).toBe(false)
    expect(isSafeEntryPath('C:/Windows/system32/x.dll')).toBe(false)
    expect(isSafeEntryPath('assets\\..\\..\\evil.txt')).toBe(false)
    expect(isSafeEntryPath('a/../../b')).toBe(false)
  })

  it('包内多出未声明的文件则拒绝', async () => {
    const { root, marketDir } = workspace()
    const entries = ggalEntries({ character: sampleCharacter() })
    const tampered = [...entries, { path: 'stowaway.js', data: 'process.exit(0)' }]
    const ggal = writeRawGgal(join(root, 'bad.ggal'), tampered)
    const { service } = market(marketDir)

    await expect(service.import(ggal)).rejects.toThrow('未声明的文件')
    expect(marketIsClean(marketDir)).toBe(true)
  })

  it('皮肤包超过 10 MB 则拒绝', async () => {
    const { root, marketDir } = workspace()
    const ggal = writeGgal(join(root, 'fat-skin.ggal'), {
      character: sampleCharacter({ id: 'gala:fat-skin', type: 'skin' }),
      extras: [{ path: 'assets/bg.png', data: Buffer.alloc(11 * 1024 * 1024, 7) }],
    })
    const { service } = market(marketDir)

    await expect(service.import(ggal)).rejects.toThrow('皮肤包体积超限')
    expect(marketIsClean(marketDir)).toBe(true)
  })

  it('解压后总体积超过 50 MB 则在解压阶段拒绝', () => {
    const { root } = workspace()
    const ggal = writeGgal(join(root, 'bomb.ggal'), {
      character: sampleCharacter(),
      extras: [{ path: 'assets/blob.bin', data: Buffer.alloc(1024, 1) }],
    })

    expect(() => readGgalPackage(ggal, 512)).toThrow('体积超限')
    expect(MAX_EXTRACTED_BYTES).toBe(50 * 1024 * 1024)
  })

  it('不是 zip 的文件直接拒绝', async () => {
    const { root, marketDir } = workspace()
    const ggal = join(root, 'plain.ggal')
    writeFileSync(ggal, 'this is not a zip archive')
    const { service } = market(marketDir)

    await expect(service.import(ggal)).rejects.toThrow('不是合法的 .ggal 包')
    expect(marketIsClean(marketDir)).toBe(true)
  })
})

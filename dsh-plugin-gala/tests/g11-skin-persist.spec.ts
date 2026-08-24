import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGalaSkinService, createGalaSkinStore } from '../src/gala-skin.ts'
import type { GalaSkinHost } from '../src/gala-skin.ts'
import type { SkinManifest } from '../src/protocols/skin-protocol.ts'

const oceanSkin: SkinManifest = {
  id: 'gala:ocean',
  name: '海洋梦境',
  type: 'skin',
  family: 'nature',
  rarity: 'rare',
  description: '深蓝海洋主题。',
  target: 'dsh-web-app',
  scope: 'global',
  tokens: {
    '--gala-color-primary': '#0077be',
    '--gala-color-background': '#e0f7fa',
  },
  author: 'gala-official',
  version: '1.0.0',
}

function createFakeHost(storePath: string): GalaSkinHost & {
  injected: Array<{ key: string; css: string }>
  injectCount: number
} {
  let counter = 0
  const injected: Array<{ key: string; css: string }> = []
  const store = createGalaSkinStore(storePath)
  return {
    injected,
    get injectCount() { return injected.length },
    insertCss: async (css: string) => {
      const key = `skin-key-${++counter}`
      injected.push({ key, css })
      return key
    },
    removeCss: async () => {},
    readCss: () => '',
    store,
  }
}

describe('G11 · 皮肤持久化（重启后上次皮肤仍生效）', () => {
  it('apply 后 skins.json 写入活跃皮肤 ID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g11-write-'))
    const file = join(dir, 'skins.json')
    const host = createFakeHost(file)
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)

    await skin.apply('gala:ocean')

    expect(existsSync(file)).toBe(true)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { version: number; active: string | null }
    expect(saved.version).toBe(2)
    expect((saved as { initialized?: boolean }).initialized).toBe(true)
    expect(saved.active).toBe('gala:ocean')
  })

  it('revert 后 skins.json active 清为 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g11-revert-'))
    const file = join(dir, 'skins.json')
    const host = createFakeHost(file)
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)

    await skin.apply('gala:ocean')
    await skin.revert()

    const saved = JSON.parse(readFileSync(file, 'utf8')) as { active: string | null }
    expect(saved.active).toBeNull()
  })

  it('重启后 restore() 恢复上次启用的皮肤', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g11-restore-'))
    const file = join(dir, 'skins.json')

    // 第一次运行：启用皮肤
    const host1 = createFakeHost(file)
    const skin1 = createGalaSkinService({ host: host1 })
    skin1.register(oceanSkin)
    await skin1.apply('gala:ocean')
    expect(host1.injectCount).toBe(1)

    // 模拟重启：用同一个 skins.json 创建新实例
    const host2 = createFakeHost(file)
    const skin2 = createGalaSkinService({ host: host2 })
    skin2.register(oceanSkin)

    // restore 前无活跃皮肤
    expect(skin2.current()).toBeUndefined()

    await skin2.restore()

    // 皮肤被重新注入
    expect(host2.injectCount).toBe(1)
    expect(skin2.current()?.id).toBe('gala:ocean')
    const css = host2.injected[0]!.css
    expect(css).toContain('--gala-color-primary: #0077be')
  })

  it('无上次皮肤时 restore() 是 no-op', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g11-noop-'))
    const file = join(dir, 'skins.json')
    const host = createFakeHost(file)
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)

    await skin.restore()

    expect(host.injectCount).toBe(0)
    expect(skin.current()).toBeUndefined()
  })

  it('明确恢复原装与从未初始化是两个不同状态', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g11-original-'))
    const file = join(dir, 'skins.json')
    const host = createFakeHost(file)
    const skin = createGalaSkinService({ host })

    expect(host.store.getActive()).toBeUndefined()
    await skin.revert()
    expect(host.store.getActive()).toBeNull()

    const restored = createGalaSkinStore(file)
    expect(restored.getActive()).toBeNull()
  })

  it('v1 的 null 迁移为用户明确选择原装', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g11-v1-'))
    const file = join(dir, 'skins.json')
    writeFileSync(file, '{"version":1,"active":null}\n', 'utf8')
    expect(createGalaSkinStore(file).getActive()).toBeNull()
  })

  it('restore 时上次皮肤已卸载则跳过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g11-uninstalled-'))
    const file = join(dir, 'skins.json')

    // 第一次运行：启用皮肤
    const host1 = createFakeHost(file)
    const skin1 = createGalaSkinService({ host: host1 })
    skin1.register(oceanSkin)
    await skin1.apply('gala:ocean')

    // 重启后皮肤包未加载（未注册）
    const host2 = createFakeHost(file)
    const skin2 = createGalaSkinService({ host: host2 })
    // 不注册 oceanSkin

    await skin2.restore()

    expect(host2.injectCount).toBe(0)
    expect(skin2.current()).toBeUndefined()
  })
})

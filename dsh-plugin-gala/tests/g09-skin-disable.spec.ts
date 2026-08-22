import { describe, expect, it } from 'vitest'
import { createGalaSkinService } from '../src/gala-skin.ts'
import type { GalaSkinHost, GalaSkinStore } from '../src/gala-skin.ts'
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

function createFakeHost(store?: GalaSkinStore): GalaSkinHost & {
  injected: Array<{ key: string; css: string }>
  removedKeys: string[]
} {
  let counter = 0
  const injected: Array<{ key: string; css: string }> = []
  const removedKeys: string[] = []
  const memoryStore: GalaSkinStore = {
    getActive: () => undefined,
    setActive: () => {},
  }
  return {
    injected,
    removedKeys,
    insertCss: async (css: string) => {
      const key = `skin-key-${++counter}`
      injected.push({ key, css })
      return key
    },
    removeCss: async (key: string) => {
      removedKeys.push(key)
    },
    readCss: () => '',
    store: store ?? memoryStore,
  }
}

describe('G9 · 禁用皮肤后官方 UI 恢复原样', () => {
  it('revert 后 removeCss 被调用，current() 清空', async () => {
    const host = createFakeHost()
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)

    await skin.apply('gala:ocean')
    expect(skin.current()).toBeDefined()

    await skin.revert()

    // removeCss 用插入时返回的 key
    expect(host.removedKeys).toHaveLength(1)
    expect(host.removedKeys[0]).toBe(host.injected[0]!.key)
    expect(skin.current()).toBeUndefined()
  })

  it('无皮肤时 revert 是 no-op', async () => {
    const host = createFakeHost()
    const skin = createGalaSkinService({ host })

    await skin.revert() // 不抛错

    expect(host.removedKeys).toHaveLength(0)
    expect(skin.current()).toBeUndefined()
  })

  it('revert 后再次 apply 可重新启用皮肤', async () => {
    const host = createFakeHost()
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)

    await skin.apply('gala:ocean')
    await skin.revert()
    expect(skin.current()).toBeUndefined()

    await skin.apply('gala:ocean')
    expect(skin.current()?.id).toBe('gala:ocean')
    expect(host.injected).toHaveLength(2)
  })

  it('revert 后持久化状态清零', async () => {
    let storedActive: string | null = null
    const fakeStore: GalaSkinStore = {
      getActive: () => storedActive ?? undefined,
      setActive: id => { storedActive = id },
    }
    const host = createFakeHost(fakeStore)
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)

    await skin.apply('gala:ocean')
    expect(storedActive).toBe('gala:ocean')

    await skin.revert()
    expect(storedActive).toBeNull()
  })
})

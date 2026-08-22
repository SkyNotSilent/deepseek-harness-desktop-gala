import { describe, expect, it } from 'vitest'
import { createGalaSkinService } from '../src/gala-skin.ts'
import type { GalaSkinHost, GalaSkinStore } from '../src/gala-skin.ts'
import type { SkinManifest } from '../src/protocols/skin-protocol.ts'

/** PRD §9.2 示例：海洋梦境皮肤 */
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
    '--gala-color-secondary': '#00a8cc',
    '--gala-color-background': '#e0f7fa',
    '--gala-font-family': '"Segoe UI", sans-serif',
    '--gala-border-radius': '12px',
  },
  author: 'gala-official',
  version: '1.0.0',
}

const forestSkin: SkinManifest = {
  id: 'gala:forest',
  name: '森林晨曦',
  type: 'skin',
  family: 'nature',
  rarity: 'uncommon',
  description: '翠绿森林主题。',
  target: 'dsh-web-app',
  scope: 'global',
  tokens: {
    '--gala-color-primary': '#2e7d32',
    '--gala-color-background': '#e8f5e9',
  },
  author: 'gala-official',
  version: '1.0.0',
}

/** 创建 fake 宿主：记录所有 insertCss/removeCss 调用 */
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

describe('G8 · 皮肤 CSS 注入并生效', () => {
  it('apply 后 insertCss 被调用，CSS 包含 tokens 声明', async () => {
    const host = createFakeHost()
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)

    await skin.apply('gala:ocean')

    expect(host.injected).toHaveLength(1)
    const css = host.injected[0]!.css
    expect(css).toContain('--gala-color-primary: #0077be')
    expect(css).toContain('--gala-color-secondary: #00a8cc')
    expect(css).toContain('--gala-color-background: #e0f7fa')
    expect(css).toContain('--gala-font-family: "Segoe UI", sans-serif')
    expect(css).toContain('--gala-border-radius: 12px')
    expect(css).toContain(':root')
  })

  it('apply 后 current() 返回已启用皮肤', async () => {
    const host = createFakeHost()
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)

    expect(skin.current()).toBeUndefined()
    await skin.apply('gala:ocean')
    expect(skin.current()?.id).toBe('gala:ocean')
  })

  it('换肤时先注入新皮肤再移除旧皮肤', async () => {
    const host = createFakeHost()
    const skin = createGalaSkinService({ host })
    skin.register(oceanSkin)
    skin.register(forestSkin)

    await skin.apply('gala:ocean')
    await skin.apply('gala:forest')

    // 两次注入
    expect(host.injected).toHaveLength(2)
    expect(host.injected[0]!.css).toContain('#0077be')
    expect(host.injected[1]!.css).toContain('#2e7d32')

    // 旧皮肤 key 被移除
    expect(host.removedKeys).toHaveLength(1)
    expect(host.removedKeys[0]).toBe(host.injected[0]!.key)

    // current 是新皮肤
    expect(skin.current()?.id).toBe('gala:forest')
  })

  it('未注册皮肤 apply 时抛错', async () => {
    const host = createFakeHost()
    const skin = createGalaSkinService({ host })

    await expect(skin.apply('gala:missing')).rejects.toThrow(/皮肤未注册/)
  })
})

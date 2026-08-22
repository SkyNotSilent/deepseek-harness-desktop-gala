import { describe, expect, it } from 'vitest'
import { deriveDarkValue, mapSkinTokens, SKIN_TOKEN_NAMES } from '../src/gala-skin-map.ts'
import { BUILTIN_SKINS } from '../src/gala-skins-builtin.ts'

describe('皮肤 token 映射（--gala-* → --dsw-*）', () => {
  it('主色映射到品牌与主按钮 token，双值齐全', () => {
    const layer = mapSkinTokens({ '--gala-color-primary': '#f26d9c' })

    for (const target of ['--dsw-alias-brand-primary', '--dsw-alias-brand-text', '--dsw-alias-button-primary-fill']) {
      expect(layer[target]?.light).toBe('#f26d9c')
      expect(layer[target]?.dark).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('底色 dark 值压暗保留色相（浅粉 → 深色域）', () => {
    const dark = deriveDarkValue('#fff5f8', 'surface')
    const lightness = parseInt(dark.slice(1, 3), 16)
    expect(lightness).toBeLessThan(0x40) // 红通道显著压暗
  })

  it('未在映射表内的 gala token 忽略；非 hex 值双值原样', () => {
    const layer = mapSkinTokens({
      '--gala-font-family': 'serif',
      '--gala-color-primary': 'var(--x)',
    })
    expect(Object.keys(layer).every(name => name.startsWith('--dsw-'))).toBe(true)
    expect(layer['--dsw-alias-brand-primary']).toEqual({ light: 'var(--x)', dark: 'var(--x)' })
  })

  it('三套内置皮肤的每个 token 都能映射出非空层', () => {
    for (const skin of BUILTIN_SKINS) {
      const layer = mapSkinTokens(skin.tokens)
      expect(Object.keys(layer).length).toBeGreaterThanOrEqual(6)
      for (const pair of Object.values(layer)) {
        expect(pair.light).toBeTruthy()
        expect(pair.dark).toBeTruthy()
      }
    }
  })

  it('内置皮肤只使用文档化的 gala token 名', () => {
    const allowed = new Set(SKIN_TOKEN_NAMES)
    for (const skin of BUILTIN_SKINS) {
      for (const name of Object.keys(skin.tokens)) {
        expect(allowed.has(name)).toBe(true)
      }
    }
  })
})

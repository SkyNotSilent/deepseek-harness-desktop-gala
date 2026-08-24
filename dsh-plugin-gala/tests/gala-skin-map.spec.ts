import { describe, expect, it } from 'vitest'
import { DERIVED_TEXT_TOKEN_NAMES, deriveDarkValue, deriveTextTokens, mapSkinTokens, SKIN_TOKEN_NAMES } from '../src/gala-skin-map.ts'
import { CHARACTER_SKINS } from '../src/gala-character-skins.ts'
import { BUILTIN_SKINS } from '../src/gala-skins-builtin.ts'

/** WCAG 相对亮度 */
function luminance(hex: string): number {
  const channel = (index: number): number => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

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

  it('主色推导过程文字 token：带主题色相且在浅色底 / 深色底上都够看清', () => {
    for (const skin of [...CHARACTER_SKINS, ...BUILTIN_SKINS]) {
      const layer = mapSkinTokens(skin.tokens)
      for (const name of DERIVED_TEXT_TOKEN_NAMES) expect(layer[name], `${skin.id} ${name}`).toBeDefined()
      const bgLight = skin.tokens['--gala-color-bg'] ?? '#ffffff'
      const bgDark = layer['--dsw-alias-bg-base']?.dark ?? '#1b1b1c'
      // 工具行标题 / 规则正文
      expect(contrast(layer['--dsw-alias-label-secondary']!.light, bgLight), `${skin.id} secondary light`).toBeGreaterThanOrEqual(7)
      expect(contrast(layer['--dsw-alias-label-secondary']!.dark, bgDark), `${skin.id} secondary dark`).toBeGreaterThanOrEqual(7)
      // 摘要 / 思考 / 时间戳
      expect(contrast(layer['--dsw-alias-label-tertiary']!.light, bgLight), `${skin.id} tertiary light`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(layer['--dsw-alias-label-tertiary']!.dark, bgDark), `${skin.id} tertiary dark`).toBeGreaterThanOrEqual(4.5)
      // 最淡的标注也不能低于 3:1（官方默认 #adb2b8 在白底只有约 2.4:1）
      expect(contrast(layer['--dsw-alias-label-caption']!.light, bgLight), `${skin.id} caption light`).toBeGreaterThanOrEqual(3.5)
      expect(contrast(layer['--dsw-alias-label-caption']!.dark, bgDark), `${skin.id} caption dark`).toBeGreaterThanOrEqual(3.5)
    }
  })

  it('过程文字保留主色色相；主色非 hex 时不推导', () => {
    const pink = deriveTextTokens('#d1548a')['--dsw-alias-label-tertiary']!.light
    const green = deriveTextTokens('#2f9d6f')['--dsw-alias-label-tertiary']!.light
    expect(pink).not.toBe(green)
    expect(parseInt(pink.slice(1, 3), 16)).toBeGreaterThan(parseInt(pink.slice(3, 5), 16)) // 粉：红 > 绿
    expect(parseInt(green.slice(3, 5), 16)).toBeGreaterThan(parseInt(green.slice(1, 3), 16)) // 绿：绿 > 红
    expect(deriveTextTokens('var(--x)')).toEqual({})
    expect(mapSkinTokens({ '--gala-color-primary': 'var(--x)' })['--dsw-alias-label-tertiary']).toBeUndefined()
  })
})

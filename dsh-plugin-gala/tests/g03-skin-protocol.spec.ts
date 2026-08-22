import { describe, expect, it } from 'vitest'
import { validateSkinManifest } from '../src/protocols/skin-protocol.ts'

/** PRD v4.0 §9.2 示例：海洋梦境皮肤 */
const oceanExample = {
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
  css: './tokens.css',
  assets: { wallpaper: './assets/wallpaper.png' },
  author: 'gala-official',
  version: '1.0.0',
}

describe('GSP skin protocol schema（G3）', () => {
  it('accepts the PRD §9.2 example skin', () => {
    expect(validateSkinManifest(oceanExample)).toBe(true)
  })

  it('accepts a skin without the optional css and assets', () => {
    const { css, assets, ...rest } = oceanExample
    void css
    void assets
    expect(validateSkinManifest(rest)).toBe(true)
  })

  it('rejects a non-skin type', () => {
    expect(validateSkinManifest({ ...oceanExample, type: 'character' })).toBe(false)
  })

  it('requires the target field', () => {
    const { target, ...rest } = oceanExample
    void target
    expect(validateSkinManifest(rest)).toBe(false)
  })

  it('requires the scope field', () => {
    const { scope, ...rest } = oceanExample
    void scope
    expect(validateSkinManifest(rest)).toBe(false)
  })

  it('requires the tokens field', () => {
    const { tokens, ...rest } = oceanExample
    void tokens
    expect(validateSkinManifest(rest)).toBe(false)
  })

  it('rejects an unknown scope', () => {
    expect(validateSkinManifest({ ...oceanExample, scope: 'local' })).toBe(false)
  })

  it('rejects non-string token values', () => {
    expect(validateSkinManifest({
      ...oceanExample,
      tokens: { '--gala-color-primary': 42 },
    })).toBe(false)
  })

  it('rejects a missing required family', () => {
    expect(validateSkinManifest({
      id: 'gala:ocean',
      name: '海洋梦境',
      type: 'skin',
      rarity: 'rare',
      description: '深蓝海洋主题。',
      target: 'dsh-web-app',
      scope: 'global',
      tokens: { '--gala-color-primary': '#0077be' },
      author: 'gala-official',
      version: '1.0.0',
    })).toBe(false)
  })
})

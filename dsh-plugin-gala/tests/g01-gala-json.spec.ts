import { describe, expect, it } from 'vitest'
import { validateGalaJson } from '../src/protocols/gala-json.ts'

/** PRD v4.0 §8.3 示例：小阿尔法 */
const alphaExample = {
  id: 'gala:alpha',
  name: '小阿尔法',
  type: 'character',
  family: 'system',
  rarity: 'common',
  description: 'DSH 的第一个嘎啦。',
  assets: { avatar: 'assets/avatar.png', chibi: 'assets/chibi.svg' },
  author: 'gala-official',
  version: '1.0.0',
}

describe('GMP gala.json schema（G1）', () => {
  it('accepts the PRD §8.3 example character', () => {
    expect(validateGalaJson(alphaExample)).toBe(true)
  })

  it('accepts an id matching ^gala:[a-z0-9-]{3,64}$', () => {
    expect(validateGalaJson({ ...alphaExample, id: 'gala:ocean-skin-2' })).toBe(true)
  })

  it('rejects ids without the gala: prefix', () => {
    expect(validateGalaJson({ ...alphaExample, id: 'alpha' })).toBe(false)
  })

  it('rejects ids that are too short', () => {
    expect(validateGalaJson({ ...alphaExample, id: 'gala:ab' })).toBe(false)
  })

  it('rejects uppercase ids', () => {
    expect(validateGalaJson({ ...alphaExample, id: 'gala:Alpha' })).toBe(false)
  })

  it('rejects a missing required family', () => {
    expect(validateGalaJson({
      id: 'gala:alpha',
      name: '小阿尔法',
      type: 'character',
      rarity: 'common',
      description: 'x',
      assets: { avatar: 'a.png' },
      author: 'a',
      version: '1.0.0',
    })).toBe(false)
  })

  it('rejects a missing required assets', () => {
    expect(validateGalaJson({
      id: 'gala:alpha',
      name: '小阿尔法',
      type: 'character',
      family: 'system',
      rarity: 'common',
      description: 'x',
      author: 'a',
      version: '1.0.0',
    })).toBe(false)
  })

  it('rejects an unknown type', () => {
    expect(validateGalaJson({ ...alphaExample, type: 'pet' })).toBe(false)
  })

  it('rejects an unknown rarity', () => {
    expect(validateGalaJson({ ...alphaExample, rarity: 'mythic' })).toBe(false)
  })

  it('rejects a malformed version', () => {
    expect(validateGalaJson({ ...alphaExample, version: '1.0' })).toBe(false)
  })

  it('accepts the optional tier, expressions, lines and tags', () => {
    expect(validateGalaJson({
      ...alphaExample,
      tier: 3,
      expressions: { idle: '😀', happy: '😄' },
      lines: { onEquip: '你好！' },
      tags: ['starter', 'cute'],
    })).toBe(true)
  })
})

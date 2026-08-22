import { describe, expect, it } from 'vitest'
import {
  CHARACTER_BY_SKIN,
  CHARACTER_SKINS,
  skinIdForCharacter,
} from '../src/gala-character-skins.ts'
import { SELECTABLE_GALAS } from '../src/gala-officials.ts'
import { BUILTIN_SKINS } from '../src/gala-skins-builtin.ts'
import { SKIN_TOKEN_NAMES } from '../src/gala-skin-map.ts'
import { validateSkinManifest } from '../src/protocols/skin-protocol.ts'

describe('全员默认 + 一人一肤：官方角色皮肤目录', () => {
  it('全员形象与每位官方少女都有一套皮肤，且通过 GSP schema 校验', () => {
    expect(CHARACTER_SKINS.length).toBe(SELECTABLE_GALAS.length)
    for (const manifest of CHARACTER_SKINS) {
      expect(validateSkinManifest(manifest)).toBe(true)
    }
  })

  it('token 全部落在 §7.2 白名单映射内（六色齐全）', () => {
    for (const manifest of CHARACTER_SKINS) {
      const names = Object.keys(manifest.tokens)
      expect(names.sort()).toEqual([...SKIN_TOKEN_NAMES].sort())
      for (const value of Object.values(manifest.tokens)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('皮肤 id ↔ 角色 id 双射，且不与内置经典皮肤冲突', () => {
    const skinIds = new Set(CHARACTER_SKINS.map(manifest => manifest.id))
    expect(skinIds.size).toBe(CHARACTER_SKINS.length)
    for (const entry of SELECTABLE_GALAS) {
      const skinId = skinIdForCharacter(entry.character.id)
      expect(skinIds.has(skinId)).toBe(true)
      expect(CHARACTER_BY_SKIN.get(skinId)).toBe(entry.character.id)
    }
    for (const builtin of BUILTIN_SKINS) {
      expect(skinIds.has(builtin.id)).toBe(false)
      expect(CHARACTER_BY_SKIN.has(builtin.id)).toBe(false)
    }
  })

  it('主色互不相同（同族少女也要能一眼分辨）', () => {
    const primaries = CHARACTER_SKINS.map(manifest => manifest.tokens['--gala-color-primary'])
    expect(new Set(primaries).size).toBe(CHARACTER_SKINS.length)
  })

  it('皮肤继承角色的族系与稀有度', () => {
    for (const entry of SELECTABLE_GALAS) {
      const manifest = CHARACTER_SKINS.find(
        candidate => candidate.id === skinIdForCharacter(entry.character.id),
      )
      expect(manifest?.family).toBe(entry.character.family)
      expect(manifest?.rarity).toBe(entry.character.rarity)
      expect(manifest?.name).toContain(entry.character.name)
    }
  })
})

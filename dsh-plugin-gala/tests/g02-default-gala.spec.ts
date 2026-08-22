import { describe, expect, it } from 'vitest'
import {
  createGalaRegistry,
  DEFAULT_GALA_AVATAR,
  defaultGalaForPackage,
} from '../src/gala-registry.ts'
import { validateGalaJson } from '../src/protocols/gala-json.ts'

describe('default gala generation（G2）', () => {
  it('generates a valid default character from a package name', () => {
    const gala = defaultGalaForPackage('my-plugin')
    expect(gala.id).toBe('gala:my-plugin')
    expect(gala.name).toBe('my-plugin')
    expect(gala.type).toBe('character')
    expect(gala.family).toBe('system')
    expect(gala.rarity).toBe('common')
    expect(gala.tier).toBe(1)
    expect(gala.assets.avatar).toBe(DEFAULT_GALA_AVATAR)
    expect(validateGalaJson(gala)).toBe(true)
  })

  it('generates a valid default for scoped package names', () => {
    const gala = defaultGalaForPackage('@scope/plugin-name')
    expect(gala.id).toBe('gala:plugin-name')
    expect(validateGalaJson(gala)).toBe(true)
  })

  it('safely normalizes package names with invalid characters', () => {
    const gala = defaultGalaForPackage('My Cool Plugin!')
    expect(gala.id).toMatch(/^gala:[a-z0-9-]{3,64}$/)
    expect(validateGalaJson(gala)).toBe(true)
  })

  it('pads over-short package names to satisfy the id pattern', () => {
    const gala = defaultGalaForPackage('a')
    expect(gala.id).toMatch(/^gala:[a-z0-9-]{3,64}$/)
    expect(validateGalaJson(gala)).toBe(true)
  })
})

describe('gala registry（G2）', () => {
  it('registers, lists and gets characters', () => {
    const registry = createGalaRegistry()
    const a = defaultGalaForPackage('a')
    const b = defaultGalaForPackage('b')
    registry.register(a)
    registry.register(b)
    expect(registry.list()).toHaveLength(2)
    expect(registry.get(a.id)?.name).toBe('a')
    expect(registry.get('missing')).toBeUndefined()
  })

  it('re-registering the same id replaces the entry', () => {
    const registry = createGalaRegistry()
    registry.register(defaultGalaForPackage('dup'))
    registry.register({ ...defaultGalaForPackage('dup'), tier: 2 })
    expect(registry.list()).toHaveLength(1)
    expect(registry.get('gala:dup')?.tier).toBe(2)
  })
})

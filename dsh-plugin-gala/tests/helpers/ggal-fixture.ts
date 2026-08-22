/**
 * 测试夹具：构造 `.ggal` 包。
 *
 * zip 写侧已提升为 src/ggal-pack.ts（造包 CLI 与测试共用），
 * 这里只保留 re-export 与示例角色。
 */

import type { GalaCharacter } from '../../src/protocols/gala-json.ts'

export {
  buildZip,
  ggalEntries,
  payloadDigest,
  writeGgal,
  type PackEntry as FixtureEntry,
  type PackageInput as PackageFixture,
} from '../../src/ggal-pack.ts'

/** 一只用于测试的普通嘎啦角色 */
export function sampleCharacter(overrides: Partial<GalaCharacter> = {}): GalaCharacter {
  return {
    id: 'gala:ocean-sprite',
    name: '海洋小精灵',
    type: 'character',
    family: 'ocean',
    rarity: 'rare',
    tier: 1,
    description: '住在数据海里的小嘎啦。',
    assets: { avatar: 'assets/avatar.png' },
    author: 'gala-official',
    version: '1.0.0',
    ...overrides,
  }
}

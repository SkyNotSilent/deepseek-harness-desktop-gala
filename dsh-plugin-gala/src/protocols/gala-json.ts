/**
 * Gala 元数据协议（GMP）— PRD v4.0 §8
 *
 * `gala.json` 的 JSON Schema（2020-12 draft）与运行时校验。
 * 校验器使用 ajv 2020-12 实现，schema 与 PRD §8.2 逐字段对齐。
 */

import { Ajv2020 } from 'ajv/dist/2020.js'
import type { AnySchemaObject, ValidateFunction } from 'ajv/dist/2020.js'

/** 嘎啦类型：角色 / 皮肤 / 合成套装 */
export type GalaType = 'character' | 'skin' | 'bundle'

/** 稀有度枚举（PRD §8.2） */
export type GalaRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** 嘎啦角色元数据（PRD §8.2 gala.json） */
export interface GalaCharacter {
  id: string
  name: string
  type: GalaType
  family: string
  rarity: GalaRarity
  /** 合成层级，默认 1 */
  tier?: number
  description: string
  assets: {
    avatar: string
    sprite?: string
    chibi?: string
    sound?: string
  }
  expressions?: {
    idle?: string
    happy?: string
    confused?: string
  }
  lines?: {
    onEquip?: string
    onFuse?: string
  }
  tags?: string[]
  author: string
  version: string
}

/** GMP `gala.json` schema（PRD §8.2，JSON Schema 2020-12） */
export const GALA_JSON_SCHEMA: AnySchemaObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id', 'name', 'type', 'family', 'rarity', 'description', 'assets', 'author', 'version'],
  properties: {
    id: { type: 'string', pattern: '^gala:[a-z0-9-]{3,64}$' },
    name: { type: 'string', minLength: 1, maxLength: 64 },
    type: { enum: ['character', 'skin', 'bundle'] },
    family: { type: 'string', minLength: 1, maxLength: 32 },
    rarity: { enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'] },
    tier: { type: 'integer', minimum: 1, default: 1 },
    description: { type: 'string', maxLength: 256 },
    assets: {
      type: 'object',
      required: ['avatar'],
      properties: {
        avatar: { type: 'string' },
        sprite: { type: 'string' },
        chibi: { type: 'string' },
        sound: { type: 'string' },
      },
    },
    expressions: {
      type: 'object',
      properties: {
        idle: { type: 'string' },
        happy: { type: 'string' },
        confused: { type: 'string' },
      },
    },
    lines: {
      type: 'object',
      properties: {
        onEquip: { type: 'string' },
        onFuse: { type: 'string' },
      },
    },
    tags: { type: 'array', items: { type: 'string' } },
    author: { type: 'string' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
  },
}

const ajv = new Ajv2020({ allErrors: true, strict: false })

/** `gala.json` 校验函数：通过时收窄为 GalaCharacter */
export const validateGalaJson: ValidateFunction<GalaCharacter> =
  ajv.compile<GalaCharacter>(GALA_JSON_SCHEMA)

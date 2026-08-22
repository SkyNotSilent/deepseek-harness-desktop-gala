/**
 * 皮肤插件协议（GSP）— PRD v4.0 §9
 *
 * 皮肤 `gala.json`（type: "skin"）的 JSON Schema（2020-12 draft）与运行时校验。
 * 在 GMP（§8）基础上增加 skin 专属字段：target / scope / tokens / css。
 */

import { Ajv2020 } from 'ajv/dist/2020.js'
import type { AnySchemaObject, ValidateFunction } from 'ajv/dist/2020.js'
import type { GalaRarity } from './gala-json.ts'

/** 皮肤作用域（PRD §9.2） */
export type SkinScope = 'global' | 'window' | 'profile'

/** 皮肤清单（PRD §9.2 gala.json skin 专属字段 + GMP 基础字段） */
export interface SkinManifest {
  id: string
  name: string
  type: 'skin'
  family: string
  rarity: GalaRarity
  tier?: number
  description: string
  /** 目标宿主，默认 dsh-web-app */
  target: string
  scope: SkinScope
  /** CSS 变量名 → 值的映射（白名单注入） */
  tokens: Record<string, string>
  /** 额外 CSS 文件路径（仍受白名单约束） */
  css?: string
  assets?: {
    avatar?: string
    wallpaper?: string
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

/** GSP 皮肤 schema（PRD §9.2，JSON Schema 2020-12） */
export const GALA_SKIN_SCHEMA: AnySchemaObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: [
    'id',
    'name',
    'type',
    'family',
    'rarity',
    'description',
    'target',
    'scope',
    'tokens',
    'author',
    'version',
  ],
  properties: {
    id: { type: 'string', pattern: '^gala:[a-z0-9-]{3,64}$' },
    name: { type: 'string', minLength: 1, maxLength: 64 },
    type: { const: 'skin' },
    family: { type: 'string', minLength: 1, maxLength: 32 },
    rarity: { enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'] },
    tier: { type: 'integer', minimum: 1, default: 1 },
    description: { type: 'string', maxLength: 256 },
    target: { type: 'string', default: 'dsh-web-app' },
    scope: { enum: ['global', 'window', 'profile'] },
    tokens: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    css: { type: 'string' },
    assets: {
      type: 'object',
      properties: {
        avatar: { type: 'string' },
        wallpaper: { type: 'string' },
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

/** 皮肤清单校验函数：通过时收窄为 SkinManifest */
export const validateSkinManifest: ValidateFunction<SkinManifest> =
  ajv.compile<SkinManifest>(GALA_SKIN_SCHEMA)

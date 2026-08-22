/**
 * 本地市场协议（GMP-Market）— PRD v4.0 §11.2
 *
 * `.ggal` 包内 `manifest.json` 的 JSON Schema（2020-12 draft）与运行时校验。
 *
 * 两处与 PRD 字面示例的偏差，均已在此固化：
 * - `id`：PRD §11.2 示例写 `"ocean-skin"`（无前缀），§11.4 又要求 “id 必须 gala: 开头”。
 *   此处两种写法都接受，由 §11.4 的一致性校验（manifest.id 归一化后须等于 gala.json 的 id）收口。
 * - `sha256`：PRD §11.3 伪代码用包文件自身的哈希与包内声明比对，自引用不可实现。
 *   实际约定为 payload 摘要（见 gala-market.ts `computePayloadDigest`）。
 */

import { Ajv2020 } from 'ajv/dist/2020.js'
import type { AnySchemaObject, ValidateFunction } from 'ajv/dist/2020.js'
import type { GalaType } from './gala-json.ts'

/** 市场清单当前 schema 版本（PRD §11.2） */
export const MARKET_MANIFEST_SCHEMA_VERSION = '1.0'

/** `.ggal` 包内的市场清单（PRD §11.2） */
export interface MarketManifest {
  schema: string
  id: string
  type: GalaType
  version: string
  author: string
  /** 包内文件清单（不含 manifest.json 自身） */
  files: string[]
  /** payload 摘要（见 gala-market.ts `computePayloadDigest`） */
  sha256: string
}

/** GMP-Market `manifest.json` schema（PRD §11.2，JSON Schema 2020-12） */
export const MARKET_MANIFEST_SCHEMA: AnySchemaObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['schema', 'id', 'type', 'version', 'author', 'files', 'sha256'],
  properties: {
    schema: { const: MARKET_MANIFEST_SCHEMA_VERSION },
    id: { type: 'string', pattern: '^(gala:)?[a-z0-9-]{3,64}$' },
    type: { enum: ['character', 'skin', 'bundle'] },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    author: { type: 'string', minLength: 1 },
    files: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
}

const ajv = new Ajv2020({ allErrors: true, strict: false })

/** `manifest.json` 校验函数：通过时收窄为 MarketManifest */
export const validateMarketManifest: ValidateFunction<MarketManifest> =
  ajv.compile<MarketManifest>(MARKET_MANIFEST_SCHEMA)

/** 去掉 `gala:` 前缀，得到可安全用作目录名的 slug（Windows 文件名不允许冒号） */
export function galaSlug(id: string): string {
  return id.startsWith('gala:') ? id.slice('gala:'.length) : id
}

/** 补上 `gala:` 前缀，得到规范 Gala id */
export function normalizeGalaId(id: string): string {
  return id.startsWith('gala:') ? id : `gala:${id}`
}

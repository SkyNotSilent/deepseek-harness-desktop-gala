/**
 * 合成配方协议（GFP）— PRD v4.0 §10
 *
 * `gala/recipes.json`（§10.3）的 JSON Schema（2020-12 draft）与运行时校验。
 * 校验器使用 ajv 2020-12 实现，schema 与 PRD §10.3 逐字段对齐（不引入 ajv-formats）。
 */

import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { AnySchemaObject } from 'ajv/dist/2020.js'

/** 合成配方（PRD §10.3） */
export interface ComposeRecipe {
  id: string
  name: string
  type: 'bundle'
  tier: number
  /** 素材嘎啦 id 列表 */
  ingredients: string[]
  output: {
    /** 合成后 profile 的 bundles */
    bundles: string[]
  }
  description: string
}

/** `recipes.json` 顶层结构（PRD §10.3） */
export interface ComposeRecipesFile {
  recipes: ComposeRecipe[]
}

/** GFP `recipes.json` schema（PRD §10.3，JSON Schema 2020-12） */
export const COMPOSE_RECIPES_SCHEMA: AnySchemaObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['recipes'],
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'type', 'tier', 'ingredients', 'output', 'description'],
        properties: {
          id: { type: 'string', pattern: '^gala:[a-z0-9-]{3,64}$' },
          name: { type: 'string', minLength: 1, maxLength: 64 },
          type: { const: 'bundle' },
          tier: { type: 'integer', minimum: 1 },
          ingredients: {
            type: 'array',
            items: { type: 'string', pattern: '^gala:[a-z0-9-]{3,64}$' },
          },
          output: {
            type: 'object',
            required: ['bundles'],
            properties: {
              bundles: { type: 'array', items: { type: 'string' } },
            },
          },
          description: { type: 'string', maxLength: 256 },
        },
      },
    },
  },
}

const validateRecipes = new Ajv2020({ strict: false, allErrors: true }).compile(COMPOSE_RECIPES_SCHEMA)

/** 校验整个 recipes 文件（PRD §10.3） */
export function validateComposeRecipesFile(data: unknown): data is ComposeRecipesFile {
  return validateRecipes(data)
}

/**
 * 加载并校验 `recipes.json`。
 * 文件缺失（首次运行）返回空数组；内容非法抛错并携带路径。
 */
export function loadComposeRecipes(filePath: string): readonly ComposeRecipe[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(
      `gala: recipes.json 解析失败 ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!validateComposeRecipesFile(parsed)) {
    throw new Error(`gala: recipes.json 校验失败 ${filePath}`)
  }
  return parsed.recipes
}

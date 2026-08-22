/**
 * 一人一肤：官方少女角色皮肤目录 — PRD v4.0 §9 / 原生换肤系统
 *
 * 每位官方少女（gala-officials.ts）对应一套主题皮肤：选中哪位少女，
 * 整个官方 UI 就换成她的主题色。色相取自形象族系（gala-avatar.ts 的
 * FAMILY_PALETTES），同族少女以明度 / 色偏手工区分；只声明 light 六 token
 * （§7.2 白名单），dark 值由 gala-skin-map.ts 的 deriveDarkValue 推导。
 *
 * 皮肤 id 规则：`gala:skin-<角色 slug>`（如 gala:skin-dsh-llm），与三套
 * 经典配色（gala-skins-builtin.ts）并列注册，互不冲突。
 */

import { OFFICIAL_GALAS } from './gala-officials.ts'
import { galaSlug } from './protocols/market-manifest.ts'
import type { SkinManifest } from './protocols/skin-protocol.ts'

/** 一套角色主题的 light 六色（dark 由映射层推导） */
interface CharacterTheme {
  /** 皮肤展示名（角色名 + 主题意象） */
  themeName: string
  primary: string
  primaryHover: string
  bg: string
  surface: string
  bubble: string
  hover: string
}

/** 角色 id → 手工调校的主题色（键齐 OFFICIAL_GALAS，测试兜底校验） */
const CHARACTER_THEMES: Record<string, CharacterTheme> = {
  'gala:dsh-base': {
    themeName: '阿基·蜜糖工地',
    primary: '#c9821f',
    primaryHover: '#b57318',
    bg: '#fffaf0',
    surface: '#fdf3e0',
    bubble: '#fbecd2',
    hover: '#f8e4c0',
  },
  'gala:dsh-web-app': {
    themeName: '小窗·暖阳橱窗',
    primary: '#e2632f',
    primaryHover: '#cd5426',
    bg: '#fff7f2',
    surface: '#ffece2',
    bubble: '#ffe1d2',
    hover: '#fdd5c1',
  },
  'gala:dsh-agent': {
    themeName: '阿念·薰衣草笔记',
    primary: '#7b5fd4',
    primaryHover: '#6a4fc0',
    bg: '#f9f7ff',
    surface: '#f0ebff',
    bubble: '#e7dfff',
    hover: '#ded4fb',
  },
  'gala:dsh-llm': {
    themeName: '灵灵·星海夜航',
    primary: '#5b5bd6',
    primaryHover: '#4a4ac2',
    bg: '#f6f6ff',
    surface: '#ececff',
    bubble: '#e2e2fd',
    hover: '#d8d8fa',
  },
  'gala:dsh-sandbox': {
    themeName: '盾盾·晴空堡垒',
    primary: '#3d7fc9',
    primaryHover: '#336fb4',
    bg: '#f4f9ff',
    surface: '#e8f2fe',
    bubble: '#dcebfc',
    hover: '#cfe3fa',
  },
  'gala:dsh-terminal': {
    themeName: '敲敲·薄荷琴房',
    primary: '#2f9d6f',
    primaryHover: '#278a60',
    bg: '#f3fbf7',
    surface: '#e4f6ec',
    bubble: '#d6f1e2',
    hover: '#c8ebd8',
  },
  'gala:dsh-skill': {
    themeName: '巧巧·青瓷工坊',
    primary: '#1f9e8e',
    primaryHover: '#1a8a7c',
    bg: '#f2fbfa',
    surface: '#e2f5f3',
    bubble: '#d3efec',
    hover: '#c4e9e5',
  },
  'gala:dsh-session': {
    themeName: '忆忆·丁香书馆',
    primary: '#a361c7',
    primaryHover: '#9151b3',
    bg: '#fcf7fe',
    surface: '#f6ecfb',
    bubble: '#f0e1f8',
    hover: '#e9d5f4',
  },
  'gala:dsh-commands': {
    themeName: '令令·樱花操场',
    primary: '#d1548a',
    primaryHover: '#bd4579',
    bg: '#fff6f9',
    surface: '#ffebf2',
    bubble: '#ffe0eb',
    hover: '#fdd4e3',
  },
  'gala:dsh-tools': {
    themeName: '宝宝·琥珀道具屋',
    primary: '#d2691f',
    primaryHover: '#bc5c19',
    bg: '#fff8f1',
    surface: '#feeede',
    bubble: '#fce3ca',
    hover: '#f9d7b6',
  },
}

/** 角色皮肤 id */
export function skinIdForCharacter(characterId: string): string {
  return `gala:skin-${galaSlug(characterId)}`
}

/** 官方角色皮肤目录（顺序与 OFFICIAL_GALAS 一致） */
export const CHARACTER_SKINS: readonly SkinManifest[] = OFFICIAL_GALAS.map(entry => {
  const theme = CHARACTER_THEMES[entry.character.id]
  if (theme === undefined) {
    throw new Error(`gala-character-skins: ${entry.character.id} 缺少主题色定义`)
  }
  return {
    id: skinIdForCharacter(entry.character.id),
    name: theme.themeName,
    type: 'skin',
    family: entry.character.family,
    rarity: entry.character.rarity,
    ...(entry.character.tier !== undefined ? { tier: entry.character.tier } : {}),
    description: entry.character.description,
    target: '@deepseek-ai/dsh-web-app',
    scope: 'global',
    tokens: {
      '--gala-color-primary': theme.primary,
      '--gala-color-primary-hover': theme.primaryHover,
      '--gala-color-bg': theme.bg,
      '--gala-color-surface': theme.surface,
      '--gala-color-bubble': theme.bubble,
      '--gala-color-hover': theme.hover,
    },
    author: 'gala-official',
    version: '1.0.0',
  }
})

/** 皮肤 id → 角色 id（logo / 立绘查询用；经典配色不在其中） */
export const CHARACTER_BY_SKIN: ReadonlyMap<string, string> = new Map(
  OFFICIAL_GALAS.map(entry => [skinIdForCharacter(entry.character.id), entry.character.id]),
)

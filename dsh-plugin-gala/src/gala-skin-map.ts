/**
 * 皮肤 token 映射 — `--gala-*` → 官方 UI `--dsw-*` — PRD v4.0 §7.2 / §9
 *
 * 皮肤包只声明 §7.2 白名单内的 `--gala-*` token（gala-skin.ts 的
 * sanitize 合同不动）；官方 UI 消费的是 `--dsw-alias-*`/`--dsw-specific-*`。
 * 桥接方式：本模块把每个 gala token 翻译成一组 dsw token 的
 * light/dark 双值层，client 侧经 ctx.theme.overrideTokens 应用
 * （官方 token 以 body 内联样式落地，样式表规则打不赢，必须走 theme 服务）。
 *
 * dark 值由 light 值按角色推导：品牌色微调亮度、面色压暗保留色相。
 */

/** 一个 dsw token 的 light/dark 双值（ThemeTokenOverrides 的要求） */
export interface TokenPair {
  light: string
  dark: string
}

/** 颜色角色：决定 dark 模式的推导方式 */
type ColorRole = 'brand' | 'surface' | 'surface-raised' | 'tint'

/** gala token → 目标 dsw token 列表 + 推导角色 */
const SKIN_TOKEN_MAP: Record<string, { targets: readonly string[]; role: ColorRole }> = {
  '--gala-color-primary': {
    role: 'brand',
    targets: [
      '--dsw-alias-brand-primary',
      '--dsw-alias-brand-text',
      '--dsw-alias-button-primary-fill',
    ],
  },
  '--gala-color-primary-hover': {
    role: 'brand',
    targets: ['--dsw-alias-button-primary-hover'],
  },
  '--gala-color-bg': {
    role: 'surface',
    targets: ['--dsw-alias-bg-base'],
  },
  '--gala-color-surface': {
    role: 'surface-raised',
    targets: ['--dsw-alias-bg-layer-1', '--dsw-specific-sidebar-fill'],
  },
  '--gala-color-bubble': {
    role: 'surface-raised',
    targets: ['--dsw-specific-bubble'],
  },
  '--gala-color-hover': {
    role: 'tint',
    targets: ['--dsw-alias-interactive-bg-hover', '--dsw-specific-sidebar-nav-item-hover'],
  },
}

/** 皮肤包可用的 gala token 名（文档与校验用） */
export const SKIN_TOKEN_NAMES: readonly string[] = Object.keys(SKIN_TOKEN_MAP)

// ── 颜色推导 ────────────────────────────────────────────────────────

interface Hsl { h: number; s: number; l: number }

/** #rgb / #rrggbb → HSL；解析失败返回 undefined */
function parseHex(color: string): Hsl | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return undefined
  const hex = match[1] as string
  const full = hex.length === 3 ? [...hex].map(ch => ch + ch).join('') : hex
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h, s, l }
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue = (p: number, q: number, t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  let r: number, g: number, b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue(p, q, h + 1 / 3)
    g = hue(p, q, h)
    b = hue(p, q, h - 1 / 3)
  }
  const channel = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** 按角色从 light 值推导 dark 值；非 hex 颜色原样双用 */
export function deriveDarkValue(lightValue: string, role: ColorRole): string {
  const hsl = parseHex(lightValue)
  if (hsl === undefined) return lightValue
  switch (role) {
    case 'brand':
      // 品牌色在暗底上略提亮，保持可辨识
      return hslToHex({ h: hsl.h, s: hsl.s, l: Math.min(0.72, hsl.l + 0.08) })
    case 'surface':
      // 底色压到深色域，保留色相的一点点温度
      return hslToHex({ h: hsl.h, s: Math.min(0.3, hsl.s * 0.35), l: 0.12 })
    case 'surface-raised':
      return hslToHex({ h: hsl.h, s: Math.min(0.32, hsl.s * 0.35), l: 0.17 })
    case 'tint':
      return hslToHex({ h: hsl.h, s: Math.min(0.4, hsl.s * 0.5), l: 0.24 })
  }
}

/**
 * 把皮肤的 `--gala-*` tokens 翻译成官方 UI 的 dsw token 双值层。
 * 未在映射表内的 gala token 忽略（Gala 自有界面仍经 insertCSS 消费它们）。
 */
export function mapSkinTokens(galaTokens: Record<string, string>): Record<string, TokenPair> {
  const layer: Record<string, TokenPair> = {}
  for (const [name, value] of Object.entries(galaTokens)) {
    const mapping = SKIN_TOKEN_MAP[name]
    if (mapping === undefined) continue
    const pair: TokenPair = { light: value, dark: deriveDarkValue(value, mapping.role) }
    for (const target of mapping.targets) layer[target] = pair
  }
  return layer
}

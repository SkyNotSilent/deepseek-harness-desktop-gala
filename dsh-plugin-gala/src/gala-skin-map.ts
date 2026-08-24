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
 *
 * 另外从主色色相推导一组“过程文字”token（label-secondary / tertiary /
 * caption 等）：官方默认的中性灰在角色皮肤的浅色底上对比度不足（caption
 * 在白底仅约 2.4:1），工具调用、上下文注入、规则、思考这些行几乎看不清。
 * 这里把它们换成带主题色相、明度足够深的值，既看得清又与角色配色一致。
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

/**
 * 由主色色相推导的过程文字 token：饱和度取主色的一部分（上限 cap），
 * 明度固定，保证在浅色皮肤底（l≈0.97）与推导后的深色底（l≈0.12）上都有
 * 足够对比度。`--dsw-alias-label-quaternary` 与 `--dsw-alias-separator-primary`
 * 被上游引用但从未定义，这里一并补齐。
 */
interface DerivedTextToken {
  target: string
  /** 饱和度上限（light / dark） */
  cap: { light: number; dark: number }
  /** 起始明度（light 从此向下压暗，dark 从此向上提亮） */
  startL: { light: number; dark: number }
  /** 相对底色的最低对比度（WCAG） */
  minContrast: number
}
const DERIVED_TEXT_TOKENS: readonly DerivedTextToken[] = [
  // 行标题 / 正文级次要文字（工具行标题、规则正文）
  { target: '--dsw-alias-label-secondary', cap: { light: 0.34, dark: 0.30 }, startL: { light: 0.34, dark: 0.76 }, minContrast: 7.5 },
  // 摘要 / 思考正文 / 时间戳（最常见的“过程”文字）
  { target: '--dsw-alias-label-tertiary', cap: { light: 0.32, dark: 0.28 }, startL: { light: 0.46, dark: 0.66 }, minContrast: 5 },
  // 最淡的标注：字段名、IO 标签、分隔点、计时器
  { target: '--dsw-alias-label-caption', cap: { light: 0.30, dark: 0.24 }, startL: { light: 0.56, dark: 0.56 }, minContrast: 3.8 },
  { target: '--dsw-alias-label-quaternary', cap: { light: 0.28, dark: 0.22 }, startL: { light: 0.66, dark: 0.48 }, minContrast: 2.6 },
  { target: '--dsw-alias-separator-primary', cap: { light: 0.26, dark: 0.20 }, startL: { light: 0.80, dark: 0.34 }, minContrast: 1.5 },
]

/** 过程文字 token 名（测试与文档用） */
export const DERIVED_TEXT_TOKEN_NAMES: readonly string[] = DERIVED_TEXT_TOKENS.map(token => token.target)

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

/** WCAG 相对亮度（sRGB） */
function luminance(hex: string): number {
  const hsl = parseHex(hex)
  if (hsl === undefined) return 1
  const full = hslToHex(hsl)
  const channel = (index: number): number => {
    const value = parseInt(full.slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG 对比度 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const L_STEP = 0.01

/** 从起始明度沿 direction 逐步调整，直到相对底色达到目标对比度。 */
function settle(hsl: Hsl, bg: string, minContrast: number, direction: -1 | 1): string {
  let l = hsl.l
  for (let i = 0; i < 100; i += 1) {
    const hex = hslToHex({ h: hsl.h, s: hsl.s, l })
    if (contrastRatio(hex, bg) >= minContrast) return hex
    l = Math.min(1, Math.max(0, l + direction * L_STEP))
    if (l === 0 || l === 1) break
  }
  return hslToHex({ h: hsl.h, s: hsl.s, l })
}

/**
 * 以主色色相推导过程文字 token；主色不是 hex 时不推导（保持官方默认）。
 * light 值相对浅色底压暗、dark 值相对深色底提亮，直到满足各自的对比度目标，
 * 因此暖色（橙 / 绿）与冷色（蓝 / 紫）都能稳定达到同一可读性。
 */
export function deriveTextTokens(primary: string, bgLight = '#ffffff', bgDark = '#1b1b1c'): Record<string, TokenPair> {
  const hsl = parseHex(primary)
  if (hsl === undefined) return {}
  const layer: Record<string, TokenPair> = {}
  for (const token of DERIVED_TEXT_TOKENS) {
    layer[token.target] = {
      light: settle({ h: hsl.h, s: Math.min(token.cap.light, hsl.s * 0.6), l: token.startL.light }, bgLight, token.minContrast, -1),
      dark: settle({ h: hsl.h, s: Math.min(token.cap.dark, hsl.s * 0.5), l: token.startL.dark }, bgDark, token.minContrast, 1),
    }
  }
  return layer
}

/**
 * 把皮肤的 `--gala-*` tokens 翻译成官方 UI 的 dsw token 双值层。
 * 未在映射表内的 gala token 忽略（Gala 自有界面仍经 insertCSS 消费它们）。
 * 声明了主色时，额外推导一组与主题色相一致的过程文字 token。
 */
export function mapSkinTokens(galaTokens: Record<string, string>): Record<string, TokenPair> {
  const layer: Record<string, TokenPair> = {}
  for (const [name, value] of Object.entries(galaTokens)) {
    const mapping = SKIN_TOKEN_MAP[name]
    if (mapping === undefined) continue
    const pair: TokenPair = { light: value, dark: deriveDarkValue(value, mapping.role) }
    for (const target of mapping.targets) layer[target] = pair
  }
  const primary = galaTokens['--gala-color-primary']
  if (primary !== undefined) {
    const bgLight = galaTokens['--gala-color-bg'] ?? '#ffffff'
    const bgDark = layer['--dsw-alias-bg-base']?.dark ?? '#1b1b1c'
    Object.assign(layer, deriveTextTokens(primary, bgLight, bgDark))
  }
  return layer
}

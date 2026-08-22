/**
 * 程序化嘎啦形象（二次元 Q 版少女 SVG）— PRD v4.0 §14.1
 *
 * Gala Game 是恋爱游戏（gal game）：每个插件拟人化为一位少女角色。
 * 正式立绘由生图 API（gala-artwork.ts）产出；这里是回退与首启兜底——
 * 用 SVG 画 Q 版动漫脸：发色随族系、刘海/发型/呆毛随 id 种子、
 * 大眼高光、腮红、小嘴，稀有度光环保留。
 *
 * 每位少女由其 gala id 播种（FNV-1a → xorshift PRNG），同一 id 永远同一张脸。
 * §14.1 统一规范固化为常量：同一描边宽/描边色、同一软阴影、同一表情栅格。
 * 生成的 SVG 自包含：无脚本、无外链、无 CSS。
 */

import type { GalaCharacter, GalaRarity } from './protocols/gala-json.ts'

/** 画布尺寸（正方形；栅格化时按需缩放） */
export const AVATAR_CANVAS = 512

/** §14.1 统一描边规范 */
const OUTLINE_WIDTH = 8
const OUTLINE_COLOR = '#4a3752'

/** 肤色（统一，二次元浅暖色） */
const SKIN_COLOR = '#ffeee4'
const SKIN_SHADE = '#ffdcc9'

/** 表情（面板 hover / 详情页 / 启动画面各取所需） */
export type GalaExpression = 'idle' | 'happy' | 'sleepy' | 'surprised'

/** 族系发色卡（少女发色 + 瞳色 + 发饰点缀色） */
const FAMILY_PALETTES: Record<string, { hair: string; hairShade: string; iris: string; accent: string }> = {
  core: { hair: '#f6c96f', hairShade: '#eab04d', iris: '#c07a2c', accent: '#ff8fb8' }, // 蜜金
  mind: { hair: '#bda6ff', hairShade: '#a68af2', iris: '#7b5fd4', accent: '#ffd166' }, // 薰衣草
  craft: { hair: '#8fdcba', hairShade: '#6cc8a0', iris: '#2f9d6f', accent: '#ff9770' }, // 薄荷
  guard: { hair: '#8fc2f7', hairShade: '#6fabe8', iris: '#3d7fc9', accent: '#ffd166' }, // 天空蓝
  link: { hair: '#f9a8c9', hairShade: '#ef8ab3', iris: '#d1548a', accent: '#8fd7ff' }, // 樱花粉
  system: { hair: '#d3d6df', hairShade: '#b9bdcb', iris: '#7c8296', accent: '#f9a8c9' }, // 银灰
  ocean: { hair: '#7fd8cf', hairShade: '#5fc2b8', iris: '#2c9a8f', accent: '#f9a8c9' }, // 海盐青
}

const PALETTE_KEYS = Object.keys(FAMILY_PALETTES)

/** 稀有度光环（普通无光环；越稀有越亮） */
const RARITY_HALOS: Record<GalaRarity, { color: string; opacity: number } | undefined> = {
  common: undefined,
  uncommon: { color: '#7ed49f', opacity: 0.35 },
  rare: { color: '#6fa8ff', opacity: 0.4 },
  epic: { color: '#c084fc', opacity: 0.45 },
  legendary: { color: '#ffd166', opacity: 0.55 },
}

// ── 种子随机 ────────────────────────────────────────────────────────

/** FNV-1a 32 位哈希：gala id → 稳定种子 */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** xorshift32：确定性 PRNG，返回 [0,1) */
function createRng(seed: number): () => number {
  let state = seed || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
}

const pick = <T,>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T

const round = (value: number): number => Math.round(value * 10) / 10

// ── 形体参数 ────────────────────────────────────────────────────────

type BangStyle = 'straight' | 'm-split' | 'side'
type HairStyle = 'bob' | 'twintail' | 'buns' | 'long'
type Accessory = 'ribbon' | 'ahoge' | 'clip' | 'none'

interface AvatarTraits {
  palette: { hair: string; hairShade: string; iris: string; accent: string }
  bang: BangStyle
  hair: HairStyle
  accessory: Accessory
}

/** 从 id + family 稳定推导发型与配色 */
function traitsFor(character: Pick<GalaCharacter, 'id' | 'family'>): AvatarTraits {
  const rng = createRng(fnv1a(character.id))
  const palette =
    FAMILY_PALETTES[character.family]
    ?? FAMILY_PALETTES[pick(createRng(fnv1a(character.family)), PALETTE_KEYS)]
    ?? (FAMILY_PALETTES.system as NonNullable<typeof FAMILY_PALETTES.system>)
  return {
    palette,
    bang: pick(rng, ['straight', 'm-split', 'side'] as const),
    hair: pick(rng, ['bob', 'twintail', 'buns', 'long'] as const),
    accessory: pick(rng, ['ribbon', 'ahoge', 'clip', 'none'] as const),
  }
}

const CX = AVATAR_CANVAS / 2
/** 脸中心（Q 版大头：脸占画面大半） */
const FACE_CY = 286
const FACE_RX = 148
const FACE_RY = 138

// ── 部件 ────────────────────────────────────────────────────────────

const stroke = `stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE_WIDTH}"`

/** 后发 + 双马尾/丸子头等剪影（画在脸后面） */
function backHairMarkup(traits: AvatarTraits): string {
  const { palette, hair } = traits
  const top = FACE_CY - FACE_RY - 34
  const parts: string[] = [
    // 后发大圆
    `<ellipse cx="${CX}" cy="${FACE_CY - 12}" rx="${FACE_RX + 34}" ry="${FACE_RY + 40}" fill="${palette.hairShade}" ${stroke} />`,
  ]
  switch (hair) {
    case 'twintail':
      parts.push(
        `<path d="M ${CX - FACE_RX - 20} ${FACE_CY - 40} Q ${CX - FACE_RX - 78} ${FACE_CY + 90} ${CX - FACE_RX - 30} ${FACE_CY + 168} Q ${CX - FACE_RX - 4} ${FACE_CY + 96} ${CX - FACE_RX + 12} ${FACE_CY + 10} Z" fill="${palette.hair}" ${stroke} stroke-linejoin="round" />`,
        `<path d="M ${CX + FACE_RX + 20} ${FACE_CY - 40} Q ${CX + FACE_RX + 78} ${FACE_CY + 90} ${CX + FACE_RX + 30} ${FACE_CY + 168} Q ${CX + FACE_RX + 4} ${FACE_CY + 96} ${CX + FACE_RX - 12} ${FACE_CY + 10} Z" fill="${palette.hair}" ${stroke} stroke-linejoin="round" />`,
      )
      break
    case 'buns':
      parts.push(
        `<circle cx="${CX - FACE_RX - 8}" cy="${top + 26}" r="42" fill="${palette.hair}" ${stroke} />`,
        `<circle cx="${CX + FACE_RX + 8}" cy="${top + 26}" r="42" fill="${palette.hair}" ${stroke} />`,
      )
      break
    case 'long':
      parts.push(
        `<path d="M ${CX - FACE_RX - 30} ${FACE_CY - 20} Q ${CX - FACE_RX - 44} ${FACE_CY + 150} ${CX - FACE_RX + 22} ${FACE_CY + 190} L ${CX - FACE_RX + 52} ${FACE_CY + 60} Z" fill="${palette.hairShade}" ${stroke} stroke-linejoin="round" />`,
        `<path d="M ${CX + FACE_RX + 30} ${FACE_CY - 20} Q ${CX + FACE_RX + 44} ${FACE_CY + 150} ${CX + FACE_RX - 22} ${FACE_CY + 190} L ${CX + FACE_RX - 52} ${FACE_CY + 60} Z" fill="${palette.hairShade}" ${stroke} stroke-linejoin="round" />`,
      )
      break
    case 'bob':
      break
  }
  return parts.join('')
}

/** 刘海（画在脸前面） */
function bangsMarkup(traits: AvatarTraits): string {
  const { palette, bang } = traits
  const hairTop = FACE_CY - FACE_RY - 46
  const browY = FACE_CY - 44
  switch (bang) {
    case 'straight':
      return (
        `<path d="M ${CX - FACE_RX - 6} ${browY} Q ${CX - FACE_RX - 10} ${hairTop} ${CX} ${hairTop} Q ${CX + FACE_RX + 10} ${hairTop} ${CX + FACE_RX + 6} ${browY} `
        + `L ${CX + FACE_RX - 30} ${browY} L ${CX + 66} ${browY - 26} L ${CX + 22} ${browY} L ${CX - 22} ${browY - 30} L ${CX - 66} ${browY} L ${CX - FACE_RX + 30} ${browY - 22} Z" `
        + `fill="${palette.hair}" ${stroke} stroke-linejoin="round" />`
      )
    case 'm-split':
      return (
        `<path d="M ${CX - FACE_RX - 6} ${browY + 14} Q ${CX - FACE_RX - 10} ${hairTop} ${CX} ${hairTop} Q ${CX + FACE_RX + 10} ${hairTop} ${CX + FACE_RX + 6} ${browY + 14} `
        + `L ${CX + FACE_RX - 26} ${browY - 10} Q ${CX + 40} ${browY + 26} ${CX} ${browY - 42} Q ${CX - 40} ${browY + 26} ${CX - FACE_RX + 26} ${browY - 10} Z" `
        + `fill="${palette.hair}" ${stroke} stroke-linejoin="round" />`
      )
    case 'side':
      return (
        `<path d="M ${CX - FACE_RX - 6} ${browY + 10} Q ${CX - FACE_RX - 10} ${hairTop} ${CX} ${hairTop} Q ${CX + FACE_RX + 10} ${hairTop} ${CX + FACE_RX + 6} ${browY + 10} `
        + `L ${CX + FACE_RX - 22} ${browY - 16} L ${CX + 26} ${browY + 18} Q ${CX - 60} ${browY + 8} ${CX - FACE_RX + 20} ${browY - 4} Z" `
        + `fill="${palette.hair}" ${stroke} stroke-linejoin="round" />`
      )
  }
}

/** 发饰 / 呆毛 */
function accessoryMarkup(traits: AvatarTraits): string {
  const { palette, accessory } = traits
  const hairTop = FACE_CY - FACE_RY - 46
  switch (accessory) {
    case 'ahoge':
      return `<path d="M ${CX - 4} ${hairTop + 6} Q ${CX + 8} ${hairTop - 60} ${CX + 52} ${hairTop - 40}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE_WIDTH}" stroke-linecap="round" />`
    case 'ribbon': {
      const x = CX + FACE_RX - 34
      const y = hairTop + 40
      return (
        `<path d="M ${x} ${y} L ${x - 40} ${y - 24} L ${x - 34} ${y + 18} Z" fill="${palette.accent}" ${stroke} stroke-linejoin="round" />`
        + `<path d="M ${x} ${y} L ${x + 40} ${y - 24} L ${x + 34} ${y + 18} Z" fill="${palette.accent}" ${stroke} stroke-linejoin="round" />`
        + `<circle cx="${x}" cy="${y}" r="12" fill="${palette.accent}" ${stroke} />`
      )
    }
    case 'clip': {
      const x = CX - FACE_RX + 30
      const y = FACE_CY - 66
      return (
        `<line x1="${x}" y1="${y}" x2="${x + 44}" y2="${y - 14}" stroke="${palette.accent}" stroke-width="10" stroke-linecap="round" />`
        + `<line x1="${x + 2}" y1="${y + 18}" x2="${x + 46}" y2="${y + 4}" stroke="${palette.accent}" stroke-width="10" stroke-linecap="round" />`
      )
    }
    case 'none':
      return ''
  }
}

/** 大眼睛（含瞳色渐变高光）与表情 */
function faceMarkup(traits: AvatarTraits, expression: GalaExpression): string {
  const { palette } = traits
  const eyeY = FACE_CY + 10
  const gap = 116
  const left = CX - gap / 2
  const right = CX + gap / 2
  const eyeRx = 30
  const eyeRy = 38

  const cheeks =
    `<ellipse cx="${left - 42}" cy="${eyeY + 52}" rx="24" ry="13" fill="#ffa8bd" opacity="0.6" />`
    + `<ellipse cx="${right + 42}" cy="${eyeY + 52}" rx="24" ry="13" fill="#ffa8bd" opacity="0.6" />`

  const openEye = (x: number): string =>
    `<ellipse cx="${x}" cy="${eyeY}" rx="${eyeRx}" ry="${eyeRy}" fill="#ffffff" ${stroke} />`
    + `<ellipse cx="${x}" cy="${eyeY + 4}" rx="${round(eyeRx * 0.72)}" ry="${round(eyeRy * 0.76)}" fill="${palette.iris}" />`
    + `<ellipse cx="${x}" cy="${eyeY + 16}" rx="${round(eyeRx * 0.44)}" ry="${round(eyeRy * 0.4)}" fill="${OUTLINE_COLOR}" opacity="0.55" />`
    + `<circle cx="${x - 9}" cy="${eyeY - 12}" r="9" fill="#ffffff" />`
    + `<circle cx="${x + 10}" cy="${eyeY + 18}" r="4.5" fill="#ffffff" opacity="0.9" />`
    + `<path d="M ${x - eyeRx - 4} ${eyeY - eyeRy + 4} Q ${x} ${eyeY - eyeRy - 14} ${x + eyeRx + 4} ${eyeY - eyeRy + 4}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE_WIDTH + 2}" stroke-linecap="round" />`

  const happyEye = (x: number): string =>
    `<path d="M ${x - eyeRx} ${eyeY + 6} Q ${x} ${eyeY - 26} ${x + eyeRx} ${eyeY + 6}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE_WIDTH + 2}" stroke-linecap="round" />`

  const sleepyEye = (x: number): string =>
    `<path d="M ${x - eyeRx} ${eyeY} Q ${x} ${eyeY + 22} ${x + eyeRx} ${eyeY}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE_WIDTH + 2}" stroke-linecap="round" />`

  switch (expression) {
    case 'happy':
      return (
        happyEye(left)
        + happyEye(right)
        + cheeks
        + `<path d="M ${CX - 30} ${eyeY + 56} Q ${CX} ${eyeY + 88} ${CX + 30} ${eyeY + 56}" fill="#b3566a" ${stroke} stroke-linejoin="round" />`
      )
    case 'sleepy':
      return (
        sleepyEye(left)
        + sleepyEye(right)
        + cheeks
        + `<ellipse cx="${CX}" cy="${eyeY + 64}" rx="12" ry="9" fill="#b3566a" />`
        + `<text x="${CX + 108}" y="${eyeY - 84}" font-family="sans-serif" font-size="48" font-weight="700" fill="${OUTLINE_COLOR}">z</text>`
      )
    case 'surprised':
      return (
        openEye(left)
        + openEye(right)
        + cheeks
        + `<ellipse cx="${CX}" cy="${eyeY + 62}" rx="14" ry="20" fill="#b3566a" />`
      )
    case 'idle':
      return (
        openEye(left)
        + openEye(right)
        + cheeks
        + `<path d="M ${CX - 18} ${eyeY + 58} Q ${CX} ${eyeY + 74} ${CX + 18} ${eyeY + 58}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE_WIDTH}" stroke-linecap="round" />`
      )
  }
}

function haloMarkup(rarity: GalaRarity): string {
  const halo = RARITY_HALOS[rarity]
  if (halo === undefined) return ''
  return (
    `<circle cx="${CX}" cy="${FACE_CY - 20}" r="238" fill="none" stroke="${halo.color}" stroke-width="14" opacity="${halo.opacity}" />`
    + (rarity === 'legendary'
      ? `<circle cx="${CX}" cy="${FACE_CY - 20}" r="220" fill="none" stroke="${halo.color}" stroke-width="5" opacity="${halo.opacity * 0.7}" stroke-dasharray="4 26" stroke-linecap="round" />`
      : '')
  )
}

/**
 * 渲染一位嘎啦少女的 Q 版 SVG。
 * 同一 (id, family, rarity, expression) 输出字节级稳定。
 */
export function renderGalaSvg(
  character: Pick<GalaCharacter, 'id' | 'family' | 'rarity'>,
  expression: GalaExpression = 'idle',
): string {
  const traits = traitsFor(character)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AVATAR_CANVAS} ${AVATAR_CANVAS}" width="${AVATAR_CANVAS}" height="${AVATAR_CANVAS}">`,
    // §14.1 统一软阴影
    `<defs><filter id="soft" x="-20%" y="-20%" width="140%" height="140%">`
      + `<feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="${OUTLINE_COLOR}" flood-opacity="0.18" />`
      + `</filter></defs>`,
    haloMarkup(character.rarity),
    `<g filter="url(#soft)">`,
    backHairMarkup(traits),
    // 脸 + 下巴阴影
    `<ellipse cx="${CX}" cy="${FACE_CY}" rx="${FACE_RX}" ry="${FACE_RY}" fill="${SKIN_COLOR}" ${stroke} />`,
    `<path d="M ${CX - 60} ${FACE_CY + FACE_RY - 22} Q ${CX} ${FACE_CY + FACE_RY + 4} ${CX + 60} ${FACE_CY + FACE_RY - 22}" fill="${SKIN_SHADE}" opacity="0.6" />`,
    faceMarkup(traits, expression),
    bangsMarkup(traits),
    accessoryMarkup(traits),
    `</g>`,
    `</svg>`,
  ].join('')
}

/** data: URL 形式（面板 <img> 内联用） */
export function galaSvgDataUrl(
  character: Pick<GalaCharacter, 'id' | 'family' | 'rarity'>,
  expression: GalaExpression = 'idle',
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderGalaSvg(character, expression))}`
}

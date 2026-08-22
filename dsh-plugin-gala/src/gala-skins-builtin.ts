/**
 * 内置皮肤三件套 — PRD v4.0 §9 / §16 G2
 *
 * 随包分发、免导入即可用的官方皮肤（用户导入的 .ggal 皮肤走市场路径）。
 * tokens 只用 §7.2 白名单内的 `--gala-*`；对官方 UI 的作用经
 * gala-skin-map.ts 翻译成 `--dsw-*` 双值层落地。
 */

import type { SkinManifest } from './protocols/skin-protocol.ts'

function builtinSkin(
  id: string,
  name: string,
  description: string,
  tokens: Record<string, string>,
): SkinManifest {
  return {
    id,
    name,
    type: 'skin',
    family: 'wardrobe',
    rarity: 'rare',
    description,
    target: '@deepseek-ai/dsh-web-app',
    scope: 'global',
    tokens,
    author: 'gala-official',
    version: '1.0.0',
  }
}

/** 内置皮肤目录 */
export const BUILTIN_SKINS: readonly SkinManifest[] = [
  builtinSkin('gala:skin-cream-pink', '奶油草莓', '像刚拆封的草莓牛奶糖，甜度刚刚好。', {
    '--gala-color-primary': '#f26d9c',
    '--gala-color-primary-hover': '#e05a8b',
    '--gala-color-bg': '#fff5f8',
    '--gala-color-surface': '#ffe9f0',
    '--gala-color-bubble': '#ffdfe9',
    '--gala-color-hover': '#ffd2e2',
  }),
  builtinSkin('gala:skin-mint-soda', '薄荷苏打', '气泡咕嘟咕嘟往上冒，整个界面都清凉了。', {
    '--gala-color-primary': '#12a184',
    '--gala-color-primary-hover': '#0e8a71',
    '--gala-color-bg': '#f2fbf8',
    '--gala-color-surface': '#e2f6ef',
    '--gala-color-bubble': '#d5f1e7',
    '--gala-color-hover': '#c6ebdf',
  }),
  builtinSkin('gala:skin-star-purple', '星空葡萄', '把一小片夜空腌进了葡萄汽水里。', {
    '--gala-color-primary': '#8b5cf6',
    '--gala-color-primary-hover': '#7a4be0',
    '--gala-color-bg': '#faf8ff',
    '--gala-color-surface': '#f1ecff',
    '--gala-color-bubble': '#e9e2ff',
    '--gala-color-hover': '#ded3ff',
  }),
]

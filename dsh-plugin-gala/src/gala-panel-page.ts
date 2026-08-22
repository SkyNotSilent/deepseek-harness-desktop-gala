/**
 * Gala 面板页面生成（主进程侧）— PRD v4.0 §14.2
 *
 * 单页四视图：图鉴 / 换肤 / 合成 / 市场。页面骨架与卡片 HTML 全部在主进程生成、
 * 不可信值（包元数据）全量转义；交互脚本是主进程模板（gala-panel-script.ts），
 * 经 CSP nonce 放行；数据以 JSON 载荷传入。页面从 loopback webServer 加载
 * （gala-http.ts），与主窗口同源，RPC 的 Origin 校验因此成立。
 */

import type { GalaLayer } from './gala-host.ts'
import { PANEL_SCRIPT } from './gala-panel-script.ts'
import { PANEL_STYLE, RARITY_COLORS } from './gala-panel-style.ts'
import type { GalaRarity } from './protocols/gala-json.ts'

/** 稀有度中文标签（全仓唯一事实源） */
export const RARITY_LABELS: Record<GalaRarity, string> = {
  common: '普通',
  uncommon: '精良',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

/** HTML 文本转义（含引号，可安全用于属性值） */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 面板视图模型（页面渲染与 JSON 载荷共用） */
export interface PanelViewModel {
  view: string
  cards: readonly {
    id: string
    name: string
    family: string
    rarity: GalaRarity
    rarityLabel: string
    rarityColor: string
    art: string
    favorite: boolean
    description: string
    quote: string
    recipes: readonly { id: string; name: string }[]
  }[]
  skins: readonly {
    id: string
    name: string
    description: string
    tokens: Record<string, string>
    active: boolean
    art?: string | undefined
  }[]
  compose: {
    recipes: readonly {
      id: string
      name: string
      description: string
      tier: number
      ingredients: readonly { id: string; name: string; owned: boolean }[]
      ready: boolean
    }[]
    error?: string
  }
  market: readonly { id: string; type: string; version: string }[]
}

/** 从装配好的 Gala 层收集面板数据 */
export function panelViewModel(layer: GalaLayer, view: string): PanelViewModel {
  const activeSkin = layer.skin.current()?.id
  const girlArt = new Map(layer.pickerState().girls.map(girl => [girl.skinId, girl.art]))
  let compose: PanelViewModel['compose']
  try {
    compose = {
      recipes: layer.compose.recipes().map(recipe => {
        const ingredients = recipe.ingredients.map(id => ({
          id,
          name: layer.registry.get(id)?.name ?? id,
          owned: layer.registry.get(id) !== undefined,
        }))
        return {
          id: recipe.id,
          name: recipe.name,
          description: recipe.description,
          tier: recipe.tier,
          ingredients,
          ready: ingredients.every(ingredient => ingredient.owned),
        }
      }),
    }
  } catch (cause) {
    compose = {
      recipes: [],
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
  return {
    view,
    cards: layer.panelCards().map(card => {
      let detail: ReturnType<GalaLayer['panelDetail']>
      try {
        detail = layer.panelDetail(card.id)
      } catch {
        // 配方文件损坏时详情仍可展示基础角色资料，工坊单独显示错误。
        detail = undefined
      }
      const character = layer.registry.get(card.id)
      return {
        id: card.id,
        name: card.name,
        family: detail?.family ?? '',
        rarity: card.rarity,
        rarityLabel: RARITY_LABELS[card.rarity],
        rarityColor: RARITY_COLORS[card.rarity] ?? '#a8b0bc',
        art: card.art,
        favorite: card.favorite,
        description: detail?.description ?? '',
        quote: character?.lines?.onEquip ?? '',
        recipes: detail?.recipes.map(recipe => ({ id: recipe.id, name: recipe.name })) ?? [],
      }
    }),
    skins: layer.skinList().map(skin => ({
      id: skin.id,
      name: skin.name,
      description: skin.description,
      tokens: skin.tokens,
      active: skin.id === activeSkin,
      ...(girlArt.get(skin.id) ? { art: girlArt.get(skin.id) } : {}),
    })),
    compose,
    market: layer.market.list().map(item => ({
      id: item.id,
      type: item.type,
      version: item.character.version,
    })),
  }
}

function galaCardMarkup(card: PanelViewModel['cards'][number]): string {
  return [
    `<article class="gala-card" data-gala-id="${escapeHtml(card.id)}" data-rarity="${card.rarity}" style="--rarity:${card.rarityColor}">`,
    card.favorite ? '<span class="star">★</span>' : '',
    `<img alt="" src="${escapeHtml(card.art)}" draggable="false" />`,
    `<h3 class="name">${escapeHtml(card.name)}</h3>`,
    `<span class="rarity">${escapeHtml(card.rarityLabel)}</span>`,
    '</article>',
  ].join('')
}

const SWATCH_TOKENS = ['--gala-color-bg', '--gala-color-surface', '--gala-color-primary', '--gala-color-hover']

function skinCardMarkup(skin: PanelViewModel['skins'][number]): string {
  const swatches = SWATCH_TOKENS
    .map(token => skin.tokens[token])
    .filter((value): value is string => value !== undefined)
    .map(value => `<span class="swatch" style="background:${escapeHtml(value)}"></span>`)
    .join('')
  return [
    `<article class="skin-card" data-skin-id="${escapeHtml(skin.id)}"${skin.active ? ' data-active' : ''}>`,
    skin.art === undefined
      ? '<div class="skin-orb" aria-hidden="true"><span>✦</span></div>'
      : `<img class="skin-art" alt="" src="${escapeHtml(skin.art)}" draggable="false" />`,
    '<div class="skin-copy">',
    `<h3>${escapeHtml(skin.name)}</h3>`,
    `<p class="desc">${escapeHtml(skin.description)}</p>`,
    `<div class="swatches">${swatches}</div>`,
    '<div class="actions">',
    '<button class="btn" data-action="preview">预览</button>',
    '<button class="btn primary" data-action="apply">穿上</button>',
    '</div>',
    '</div>',
    '</article>',
  ].join('')
}

function classicSkinMarkup(skin: PanelViewModel['skins'][number]): string {
  const swatches = SWATCH_TOKENS
    .map(token => skin.tokens[token])
    .filter((value): value is string => value !== undefined)
    .map(value => `<span class="swatch" style="background:${escapeHtml(value)}"></span>`)
    .join('')
  return [
    `<article class="classic-skin" data-skin-id="${escapeHtml(skin.id)}"${skin.active ? ' data-active' : ''}>`,
    `<div><h3>${escapeHtml(skin.name)}</h3><p>${escapeHtml(skin.description)}</p></div>`,
    `<div class="swatches">${swatches}</div>`,
    '<div class="actions"><button class="btn" data-action="preview">预览</button><button class="btn primary" data-action="apply">使用</button></div>',
    '</article>',
  ].join('')
}

function recipeCardMarkup(recipe: PanelViewModel['compose']['recipes'][number]): string {
  const stars = Array.from({ length: Math.min(recipe.tier, 5) }, () => '★').join('')
  const ingredients = recipe.ingredients.map(ingredient => [
    `<span class="ingredient${ingredient.owned ? ' owned' : ' missing'}" title="${escapeHtml(ingredient.id)}">`,
    `<span aria-hidden="true">${ingredient.owned ? '✓' : '✕'}</span>${escapeHtml(ingredient.name)}`,
    '</span>',
  ].join('')).join('')
  return [
    `<article class="recipe-card" data-recipe-id="${escapeHtml(recipe.id)}"${recipe.ready ? ' data-ready' : ''}>`,
    '<div class="recipe-tier" aria-label="配方星级">', stars, '</div>',
    `<h3>${escapeHtml(recipe.name)}</h3>`,
    `<p class="desc">${escapeHtml(recipe.description)}</p>`,
    `<div class="ingredients">${ingredients}</div>`,
    '<div class="recipe-footer">',
    `<span class="recipe-state">${recipe.ready ? '素材齐备' : '仍缺素材'}</span>`,
    `<button class="btn primary compose-button" data-compose-id="${escapeHtml(recipe.id)}"${recipe.ready ? '' : ' disabled'}>合成</button>`,
    '</div>',
    '<p class="compose-warning">合成会替换当前插件配置并重启应用</p>',
    '</article>',
  ].join('')
}

function marketItemMarkup(item: PanelViewModel['market'][number]): string {
  const kind = item.type === 'skin' ? '皮肤' : item.type === 'bundle' ? '套装' : '角色'
  return `<li><strong>${escapeHtml(item.id)}</strong><span>${kind}</span><span>v${escapeHtml(item.version)}</span></li>`
}

/** JSON 载荷（防 </script> 逃逸） */
function jsonPayload(model: PanelViewModel): string {
  return JSON.stringify(model).replaceAll('<', '\\u003c')
}

/** 渲染完整面板页面（nonce 供 CSP 放行受控脚本） */
export function renderPanelPage(model: PanelViewModel, nonce: string): string {
  const characterSkins = model.skins.filter(skin => skin.art !== undefined)
  const classicSkins = model.skins.filter(skin => skin.art === undefined)
  const galleryBody = model.cards.length === 0
    ? '<p class="empty">还没有收录任何嘎啦。<br />去市场导入一个 .ggal 包吧！</p>'
    : `<div id="gallery-grid">${model.cards.map(galaCardMarkup).join('')}</div>`
  const marketBody = model.market.length === 0
    ? '<p class="empty">市场里还空空的。</p>'
    : `<ul>${model.market.map(marketItemMarkup).join('')}</ul>`
  const composeBody = model.compose.error === undefined
    ? (model.compose.recipes.length === 0
        ? '<p class="empty">工坊还没有收到配方。</p>'
        : `<div id="compose-grid">${model.compose.recipes.map(recipeCardMarkup).join('')}</div>`)
    : `<div class="compose-error"><strong>配方暂时无法读取</strong><p>${escapeHtml(model.compose.error)}</p></div>`

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8" />',
    '<title>嘎啦图鉴</title>',
    `<style>${PANEL_STYLE}</style>`,
    '</head>',
    '<body>',
    '<header>',
    '<h1><span class="paw">🐾</span>嘎啦图鉴</h1>',
    '<nav>',
    '<button id="tab-gallery">图鉴</button>',
    '<button id="tab-skins">换肤</button>',
    '<button id="tab-compose">合成</button>',
    '<button id="tab-market">市场</button>',
    '</nav>',
    '</header>',
    '<main>',
    `<section id="view-gallery" hidden>${galleryBody}</section>`,
    '<section id="view-skins" hidden>',
    '<div id="skins-library">',
    '<div class="skin-section-heading"><span>GALA CHARACTERS</span><h2>选择你的 Gala 角色</h2><p>角色会同步改变配色、欢迎语与主界面场景。</p></div>',
    `<div id="skins-grid">${characterSkins.map(skinCardMarkup).join('')}</div>`,
    '<div class="skin-section-heading classic-heading"><span>CLASSIC PALETTES</span><h2>经典配色</h2><p>只调整界面颜色，不代表角色。</p></div>',
    `<div id="classic-skins">${classicSkins.map(classicSkinMarkup).join('')}</div>`,
    '</div>',
    '<p style="margin-top:18px"><button class="btn" id="skin-revert">恢复默认外观</button></p>',
    '</section>',
    '<section id="view-compose" hidden>',
    '<div class="atelier-hero">',
    '<img src="/_dsh/desktop/gala/asset?pkg=gala%3Adsh-base&amp;path=assets%2Fatelier-banner-v2.png" alt="少女们在魔法软件工坊中组合插件卡片" draggable="false" />',
    '<div class="atelier-copy"><span class="eyebrow">GALA FUSION ATELIER</span><h2>把小嘎啦，合成大搭档</h2><p>集齐配方里的伙伴，组装一套可直接启动的插件组合。</p></div>',
    '</div>',
    composeBody,
    '</section>',
    '<section id="view-market" hidden><div id="market">',
    '<p class="hint">导入 <code>.ggal</code> 嘎啦包，收集新角色和新皮肤。<br />包会经过完整校验（schema / 摘要 / 体积 / 路径），坏包进不来。</p>',
    '<p><button class="btn primary" id="market-import">导入嘎啦包…</button></p>',
    marketBody,
    '</div></section>',
    '</main>',
    '<div id="detail" hidden>',
    '<div class="sheet">',
    '<img id="detail-art" alt="" draggable="false" />',
    '<h2 id="detail-name"></h2>',
    '<div class="meta"><span class="chip" id="detail-family"></span><span class="chip" id="detail-rarity" style="--chip:var(--blush)"></span></div>',
    '<p class="desc" id="detail-desc"></p>',
    '<p class="quote" id="detail-quote"></p>',
    '<p class="recipes" id="detail-recipes"></p>',
    '<div class="actions">',
    '<button class="btn primary" id="detail-favorite">☆ 收藏</button>',
    '<button class="btn" id="detail-compose" hidden>去合成 →</button>',
    '<button class="btn" id="detail-close">合上</button>',
    '</div>',
    '</div>',
    '</div>',
    '<footer><label><input type="checkbox" id="motion-toggle" checked /> 动画效果</label></footer>',
    '<div id="toast"></div>',
    '<div id="relaunch-overlay" hidden><div class="relaunch-card"><span class="relaunch-spark">✨</span><h2>合成成功！正在重启应用…</h2><p>如未自动重启，请手动打开 DeepSeek Harness Desktop Gala。</p></div></div>',
    `<script id="gala-data" type="application/json">${jsonPayload(model)}</script>`,
    `<script nonce="${nonce}">${PANEL_SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

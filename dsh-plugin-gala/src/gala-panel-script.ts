/**
 * Gala 面板受控脚本 — PRD v4.0 §14.3
 *
 * 这段脚本由主进程模板生成（可信代码），经 CSP nonce 放行；
 * 不可信数据（包元数据）只经 `<script type="application/json">` 的 JSON
 * 载荷进入，脚本内一律走 textContent / dataset 写入，不拼 HTML——
 * 注入面与 gala-gallery-page 时代一致为零。
 *
 * 交互：tab 切换 / 卡片翻开详情 / 收藏 / 皮肤预览与应用（RPC）/
 * 配方定位与合成 / 市场导入 / SSE 刷新 / 动画开关（localStorage 记忆）。
 */

/** 生成面板内联脚本（数据经 #gala-data JSON 载荷读取） */
export const PANEL_SCRIPT = `
'use strict'
const data = JSON.parse(document.getElementById('gala-data').textContent)
const $ = (selector) => document.querySelector(selector)
const RPC = '/_dsh/desktop/gala/rpc/'

async function rpc(action, body) {
  const response = await fetch(RPC + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const payload = await response.json().catch(() => ({ ok: false, error: '响应解析失败' }))
  if (!response.ok || !payload.ok) throw new Error(payload.error || ('RPC ' + response.status))
  return payload
}

let toastTimer
function toast(message) {
  const el = $('#toast')
  el.textContent = message
  el.dataset.show = ''
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { delete el.dataset.show }, 2200)
}

// ── tab 切换 ──
const views = ['gallery', 'skins', 'compose', 'market']
function showView(view) {
  for (const name of views) {
    document.getElementById('view-' + name).hidden = name !== view
    const tab = document.getElementById('tab-' + name)
    if (name === view) tab.dataset.active = ''
    else delete tab.dataset.active
  }
}
for (const name of views) {
  document.getElementById('tab-' + name).addEventListener('click', () => showView(name))
}
showView(views.includes(data.view) ? data.view : 'gallery')

// ── 图鉴详情（点击翻开）──
const detail = $('#detail')
function openDetail(id) {
  const card = data.cards.find((item) => item.id === id)
  if (!card) return
  detail.dataset.currentId = id
  $('#detail-art').src = card.art
  $('#detail-name').textContent = card.name
  $('#detail-family').textContent = '族系 · ' + card.family
  $('#detail-rarity').textContent = card.rarityLabel
  $('#detail-rarity').style.setProperty('--chip', card.rarityColor)
  $('#detail-desc').textContent = card.description
  $('#detail-persona').hidden = !card.archetype
  $('#detail-archetype').textContent = card.archetype ? '人物 · ' + card.archetype : ''
  $('#detail-story').textContent = card.story
  $('#detail-quote').textContent = card.quote ? '「' + card.quote + '」' : ''
  $('#detail-recipes').textContent = card.recipes.length
    ? '可参与合成：' + card.recipes.map((recipe) => recipe.name).join('、')
    : '暂时没有它参与的合成配方。'
  const composeLink = $('#detail-compose')
  composeLink.hidden = card.recipes.length === 0
  composeLink.dataset.recipeId = card.recipes[0] ? card.recipes[0].id : ''
  updateFavoriteButton(card.favorite)
  detail.hidden = false
}
function updateFavoriteButton(favorite) {
  $('#detail-favorite').textContent = favorite ? '★ 已收藏' : '☆ 收藏'
}
document.getElementById('gallery-grid').addEventListener('click', (event) => {
  const card = event.target.closest('[data-gala-id]')
  if (card) openDetail(card.dataset.galaId)
})
$('#detail-close').addEventListener('click', () => { detail.hidden = true })
detail.addEventListener('click', (event) => {
  if (event.target === detail) detail.hidden = true
})
function highlightRecipe(id) {
  const card = document.querySelector('[data-recipe-id="' + CSS.escape(id) + '"]')
  if (!card) return
  for (const item of document.querySelectorAll('.recipe-card')) delete item.dataset.highlight
  card.dataset.highlight = ''
  card.scrollIntoView({ behavior: document.body.dataset.noMotion === undefined ? 'smooth' : 'auto', block: 'center' })
  setTimeout(() => { delete card.dataset.highlight }, 1800)
}
$('#detail-compose').addEventListener('click', () => {
  const recipeId = $('#detail-compose').dataset.recipeId
  detail.hidden = true
  showView('compose')
  if (recipeId) requestAnimationFrame(() => highlightRecipe(recipeId))
})
$('#detail-favorite').addEventListener('click', async () => {
  const id = detail.dataset.currentId
  try {
    const result = await rpc('favorite', { id })
    const card = data.cards.find((item) => item.id === id)
    if (card) card.favorite = result.favorite
    updateFavoriteButton(result.favorite)
    const gridCard = document.querySelector('[data-gala-id="' + CSS.escape(id) + '"] .star')
    if (result.favorite && !gridCard) {
      const star = document.createElement('span')
      star.className = 'star'
      star.textContent = '★'
      document.querySelector('[data-gala-id="' + CSS.escape(id) + '"]').appendChild(star)
    } else if (!result.favorite && gridCard) {
      gridCard.remove()
    }
    toast(result.favorite ? '已收藏' : '已取消收藏')
  } catch (cause) {
    toast('收藏失败：' + cause.message)
  }
})

// ── 换肤：预览（页内试色）/ 应用 / 恢复原装 ──
let previewSkin
function applyPreview(skin) {
  const root = document.documentElement
  if (!skin) {
    root.style.removeProperty('--cream')
    root.style.removeProperty('--blush')
    previewSkin = undefined
    return
  }
  root.style.setProperty('--cream', skin.tokens['--gala-color-bg'] || '#fdf6ee')
  root.style.setProperty('--blush', skin.tokens['--gala-color-hover'] || '#ffd2e2')
  previewSkin = skin.id
}
document.getElementById('skins-library').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]')
  if (!button) return
  const card = button.closest('[data-skin-id]')
  const skin = data.skins.find((item) => item.id === card.dataset.skinId)
  if (button.dataset.action === 'preview') {
    applyPreview(previewSkin === skin.id ? undefined : skin)
    toast(previewSkin ? '预览中：' + skin.name + '（只影响本面板）' : '已退出预览')
    return
  }
  if (button.dataset.action === 'apply') {
    button.disabled = true
    try {
      await rpc('skin-apply', { id: skin.id })
      for (const el of document.querySelectorAll('[data-skin-id]')) delete el.dataset.active
      card.dataset.active = ''
      applyPreview(undefined)
      toast('已换上「' + skin.name + '」')
    } catch (cause) {
      toast('换肤失败，已回滚到上一套皮肤：' + cause.message)
    } finally {
      button.disabled = false
    }
  }
})
$('#skin-revert').addEventListener('click', async () => {
  try {
    await rpc('skin-revert')
    for (const el of document.querySelectorAll('[data-skin-id]')) delete el.dataset.active
    applyPreview(undefined)
    toast('已恢复原装外观')
  } catch (cause) {
    toast('恢复失败：' + cause.message)
  }
})

// ── 合成工坊：原生确认 → 提交合成 → 重启遮罩 ──
const composeGrid = $('#compose-grid')
if (composeGrid) {
  composeGrid.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-compose-id]')
    if (!button || button.disabled) return
    button.disabled = true
    const originalText = button.textContent
    button.textContent = '等待确认…'
    toast('请在弹出的对话框里确认')
    try {
      const result = await rpc('compose', { id: button.dataset.composeId })
      if (result.composed) {
        $('#relaunch-overlay').hidden = false
      } else {
        button.disabled = false
        button.textContent = originalText
        toast('已取消合成')
      }
    } catch (cause) {
      button.disabled = false
      button.textContent = originalText
      toast('合成失败：' + cause.message)
    }
  })
}

// ── 市场导入 ──
$('#market-import').addEventListener('click', async () => {
  try {
    const result = await rpc('import')
    if (result.imported) {
      toast('导入成功，刷新图鉴…')
      setTimeout(() => location.reload(), 600)
    } else {
      toast('没有导入新的嘎啦包')
    }
  } catch (cause) {
    toast('导入失败：' + cause.message)
  }
})

// ── SSE：收藏/皮肤变化时轻刷新 ──
try {
  const events = new EventSource('/_dsh/desktop/gala/events')
  events.onmessage = (event) => {
    if (event.data === 'collection-changed') location.reload()
  }
} catch { /* SSE 不可用时面板依旧可手动刷新 */ }

// ── 动画开关（§14.3；localStorage 记忆）──
const motionToggle = $('#motion-toggle')
function setMotion(enabled) {
  if (enabled) delete document.body.dataset.noMotion
  else document.body.dataset.noMotion = ''
  motionToggle.checked = enabled
  try { localStorage.setItem('gala-motion', enabled ? '1' : '0') } catch { /* 无痕模式忽略 */ }
}
motionToggle.addEventListener('change', () => setMotion(motionToggle.checked))
try { setMotion(localStorage.getItem('gala-motion') !== '0') } catch { setMotion(true) }

// 入场 stagger（≤300ms 总时长）
document.querySelectorAll('.gala-card, .skin-card, .recipe-card').forEach((card, index) => {
  card.style.animationDelay = Math.min(index * 24, 280) + 'ms'
})
`

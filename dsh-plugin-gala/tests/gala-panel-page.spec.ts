import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGalaLayer, type GalaNative } from '../src/gala-host.ts'
import { OFFICIAL_GALAS } from '../src/gala-officials.ts'
import {
  escapeHtml,
  panelViewModel,
  RARITY_LABELS,
  renderPanelPage,
} from '../src/gala-panel-page.ts'
import { sampleCharacter, writeGgal } from './helpers/ggal-fixture.ts'

const workspaces: string[] = []

function layerWith(overrides: Partial<GalaNative> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gala-panel-'))
  workspaces.push(root)
  const profileDir = join(root, 'profile')
  mkdirSync(profileDir, { recursive: true })
  let bundles: readonly string[] = []
  const native: GalaNative = {
    insertCss: async () => 'key',
    removeCss: async () => {},
    openPanel: () => {},
    confirm: async () => true,
    chooseGgal: async () => undefined,
    resolveConflict: async () => ({ action: 'skip' }),
    notify: () => {},
    relaunch: () => {},
    ...overrides,
  }
  const layer = createGalaLayer({
    userDataDir: join(root, 'userData'),
    profileDir,
    packages: [],
    bundles: { read: () => bundles, write: next => { bundles = next } },
    native,
  })
  return { root, layer }
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('面板视图模型', () => {
  it('汇集卡片（含描述/台词/稀有度标签）、皮肤与市场', () => {
    const { layer } = layerWith()
    const model = panelViewModel(layer, 'gallery')

    expect(model.cards.length).toBeGreaterThanOrEqual(10)
    const base = model.cards.find(card => card.id === 'gala:dsh-base')
    expect(base?.name).toBe('阿基')
    expect(base?.quote).toBe('交给我吧，稳稳的哦。')
    expect(base?.rarityLabel).toBe('稀有')
    expect(model.skins.length).toBe(4 + OFFICIAL_GALAS.length) // 经典三件套 + 全员默认 + 一人一肤
    expect(model.defaultSkinId).toBe('gala:skin-ensemble')
    expect(model.skins.every(skin => !skin.active)).toBe(true)
    expect(model.skins.find(skin => skin.id === 'gala:skin-dsh-base')?.art).toMatch(/^(data:image|\/_dsh\/)/)
    expect(model.compose.error).toBeUndefined()
    expect(model.compose.recipes[0]?.id).toBe('gala:atelier-duo')
    expect(model.compose.recipes[0]?.ready).toBe(true)
    expect(model.compose.recipes[0]?.ingredients.map(item => item.name)).toEqual(['阿基', '小窗'])
    expect(model.market).toEqual([])
  })

  it('启用皮肤后视图模型标记 active', async () => {
    const { layer } = layerWith()
    await layer.skin.apply('gala:skin-mint-soda')
    const model = panelViewModel(layer, 'skins')
    expect(model.skins.find(skin => skin.id === 'gala:skin-mint-soda')?.active).toBe(true)
  })

  it('稀有度中文标签唯一事实源：uncommon = 精良', () => {
    expect(RARITY_LABELS.uncommon).toBe('精良')
  })

  it('未知素材回退显示 id 并把配方标记为未齐备', () => {
    const { root, layer } = layerWith()
    mkdirSync(join(root, 'profile', 'gala'), { recursive: true })
    writeFileSync(join(root, 'profile', 'gala', 'recipes.json'), JSON.stringify({
      recipes: [{
        id: 'gala:missing-duo',
        name: '未知搭档',
        type: 'bundle',
        tier: 3,
        ingredients: ['gala:dsh-base', 'gala:not-collected'],
        output: { bundles: ['@deepseek-ai/dsh-base'] },
        description: '测试未知素材。',
      }],
    }))

    const recipe = panelViewModel(layer, 'compose').compose.recipes.find(item => item.id === 'gala:missing-duo')
    expect(recipe?.ready).toBe(false)
    expect(recipe?.ingredients[1]).toEqual({ id: 'gala:not-collected', name: 'gala:not-collected', owned: false })
  })

  it('recipes.json 损坏时工坊降级，不拖垮整个面板', () => {
    const { root, layer } = layerWith()
    mkdirSync(join(root, 'profile', 'gala'), { recursive: true })
    writeFileSync(join(root, 'profile', 'gala', 'recipes.json'), '{broken')

    const model = panelViewModel(layer, 'compose')
    expect(model.cards.length).toBeGreaterThan(0)
    expect(model.compose.recipes).toEqual([])
    expect(model.compose.error).toContain('recipes.json 解析失败')
    expect(renderPanelPage(model, 'n')).toContain('配方暂时无法读取')
  })
})

describe('面板页面渲染', () => {
  it('页面包含四 tab、卡片网格、皮肤卡、合成卡与 nonce 脚本', () => {
    const { layer } = layerWith()
    const html = renderPanelPage(panelViewModel(layer, 'gallery'), 'nonce-123')

    expect(html).toContain('id="tab-gallery"')
    expect(html).toContain('id="tab-skins"')
    expect(html).toContain('id="tab-compose"')
    expect(html).toContain('id="tab-market"')
    expect(html).toContain('data-gala-id="gala:dsh-base"')
    expect(html).toContain('data-skin-id="gala:skin-cream-pink"')
    expect(html).toContain('id="skins-library"')
    expect(html).toContain('id="classic-skins"')
    expect(html).toContain('选择你的 Gala 伙伴')
    expect(html).toContain('恢复全员默认')
    expect(html).toContain('只调整界面颜色，不代表角色')
    expect(html).toContain('data-recipe-id="gala:atelier-duo"')
    expect(html).toContain('data-compose-id="gala:atelier-duo"')
    expect(html).toContain('id="relaunch-overlay"')
    expect(html).toContain('atelier-banner-v2.png')
    expect(html).toContain('<script nonce="nonce-123">')
    expect(html).toContain('id="gala-data" type="application/json"')
    expect(html).toContain('id="motion-toggle"') // §14.3 动画开关
  })

  it('不可信包元数据被转义，JSON 载荷防 </script> 逃逸', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gala-evil-'))
    workspaces.push(root)
    const evil = writeGgal(join(root, 'evil.ggal'), {
      character: sampleCharacter({
        id: 'gala:evil-pkg',
        name: '<img src=x onerror=alert(1)>',
        description: '</script><script>alert(2)</script>',
      }),
    })
    const { layer } = layerWith({ chooseGgal: async () => evil })
    await layer.importPackage()

    const html = renderPanelPage(panelViewModel(layer, 'gallery'), 'n')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
    expect(html).not.toContain('</script><script>alert(2)') // < 转义兜住 JSON 载荷
  })

  it('escapeHtml 覆盖属性上下文的引号', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;',
    )
  })

  it('图鉴为空时给出引导文案', () => {
    const { layer } = layerWith()
    const model = { ...panelViewModel(layer, 'gallery'), cards: [] }
    const html = renderPanelPage(model, 'n')
    expect(html).toContain('还没有收录任何嘎啦')
  })

  it('缺素材配方按钮 disabled，配方文案经过 HTML 转义', () => {
    const { layer } = layerWith()
    const base = panelViewModel(layer, 'compose')
    const html = renderPanelPage({
      ...base,
      compose: {
        recipes: [{
          id: 'gala:unsafe-recipe',
          name: '<img src=x>',
          description: '</script><script>alert(1)</script>',
          tier: 2,
          ingredients: [{ id: 'gala:missing', name: '"坏素材"', owned: false }],
          ready: false,
        }],
      },
    }, 'n')
    expect(html).toContain('&lt;img src=x&gt;')
    expect(html).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('data-compose-id="gala:unsafe-recipe" disabled')
  })
})

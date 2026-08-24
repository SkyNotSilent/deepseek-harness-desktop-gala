import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGalaLayer, type GalaNative } from '../src/gala-host.ts'
import type { ConflictResolution } from '../src/gala-market.ts'
import { OFFICIAL_GALAS } from '../src/gala-officials.ts'
import { sampleCharacter, writeGgal } from './helpers/ggal-fixture.ts'

const OFFICIAL_COUNT = OFFICIAL_GALAS.length
const workspaces: string[] = []

interface NativeLog {
  panels: string[]
  notices: { title: string; body: string }[]
  shortcuts: string[]
  inserted: string[]
  relaunched: number
}

function fakeNative(overrides: Partial<GalaNative> = {}): { native: GalaNative; log: NativeLog } {
  const log: NativeLog = { panels: [], notices: [], shortcuts: [], inserted: [], relaunched: 0 }
  const native: GalaNative = {
    insertCss: async css => {
      log.inserted.push(css)
      return `key-${log.inserted.length}`
    },
    removeCss: async () => {},
    openPanel: view => { log.panels.push(view) },
    registerShortcut: (accelerator, _handler) => {
      log.shortcuts.push(accelerator)
      return () => { log.shortcuts.splice(log.shortcuts.indexOf(accelerator), 1) }
    },
    confirm: async () => true,
    chooseGgal: async () => undefined,
    resolveConflict: async () => ({ action: 'skip' }) as ConflictResolution,
    notify: (title, body) => { log.notices.push({ title, body }) },
    relaunch: () => { log.relaunched += 1 },
    ...overrides,
  }
  return { native, log }
}

function workspace(overrides: Partial<GalaNative> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gala-host-'))
  workspaces.push(root)
  const userDataDir = join(root, 'userData')
  const profileDir = join(root, 'profile')
  mkdirSync(profileDir, { recursive: true })
  const { native, log } = fakeNative(overrides)
  let bundles: readonly string[] = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  const create = (packages: { name: string; dir?: string }[] = []) =>
    createGalaLayer({
      userDataDir,
      profileDir,
      packages,
      bundles: { read: () => bundles, write: next => { bundles = next } },
      native,
    })
  return { root, userDataDir, profileDir, native, log, create, bundles: () => bundles }
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Gala 层装配（ctx.gala 注入点）', () => {
  it('官方全家桶随装配播种进图鉴', () => {
    const { create } = workspace()
    const layer = create()

    expect(layer.registry.list().length).toBe(OFFICIAL_COUNT + 1)
    expect(layer.registry.list()[0]?.id).toBe('gala:stars')
    expect(layer.registry.get('gala:dsh-base')?.name).toBe('阿基')
    expect(layer.registry.get('gala:dsh-llm')?.rarity).toBe('legendary')
    expect(layer.panelCards().length).toBe(OFFICIAL_COUNT + 1)
    expect(layer.panelCards()[0]).toMatchObject({ id: 'gala:stars', isDefault: true })
  })

  it('官方包名映射到官方嘎啦，未知包落 §8.4 缺省嘎啦', () => {
    const { create } = workspace()
    const layer = create([{ name: '@deepseek-ai/dsh-base' }, { name: '@vendor/unknown-plugin' }])

    expect(layer.registry.get('gala:dsh-base')?.name).toBe('阿基') // 官方 override
    expect(layer.registry.get('gala:unknown-plugin')?.name).toBe('@vendor/unknown-plugin')
    expect(layer.registry.list().length).toBe(OFFICIAL_COUNT + 2)
  })

  it('包内自带 gala.json 时优先采用其元数据', () => {
    const { root, create } = workspace()
    const packageDir = join(root, 'packages', 'fancy')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(packageDir, 'gala.json'),
      JSON.stringify(sampleCharacter({ id: 'gala:fancy-one', name: '花哨嘎啦' })),
    )

    const layer = create([{ name: '@vendor/fancy', dir: packageDir }])

    expect(layer.registry.get('gala:fancy-one')?.name).toBe('花哨嘎啦')
  })

  it('自定义角色排在官方角色后，并自动拥有可选皮肤与呈现', async () => {
    const { root, create } = workspace()
    const packageDir = join(root, 'packages', 'custom')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(packageDir, 'gala.json'),
      JSON.stringify(sampleCharacter({ id: 'gala:custom-star', name: '星仔' })),
    )
    const layer = create([{ name: '@user/custom', dir: packageDir }])

    const picker = layer.pickerState()
    expect(picker.girls.at(-1)).toMatchObject({ characterId: 'gala:custom-star', name: '星仔' })
    await layer.skin.apply('gala:skin-custom-star')
    expect(layer.pickerState().persona).toMatchObject({ characterId: 'gala:custom-star', name: '星仔' })
  })

  it('包内 gala.json 损坏时退回缺省而不是整层崩溃', () => {
    const { root, create } = workspace()
    const packageDir = join(root, 'packages', 'broken')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'gala.json'), '{ not json')

    const layer = create([{ name: '@vendor/broken', dir: packageDir }])

    expect(layer.registry.get('gala:broken')?.name).toBe('@vendor/broken')
  })

  it('面板卡片带可显示形象（无立绘文件时回退 SVG data URL）', () => {
    const { create } = workspace()
    const layer = create()

    const cards = layer.panelCards()
    expect(cards.every(card => card.art.length > 0)).toBe(true)
    expect(cards[0]?.art.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('gallery.open 请求打开面板 gallery 视图', () => {
    const { create, log } = workspace()
    const layer = create()

    layer.gallery.open()

    expect(log.panels).toEqual(['gallery'])
  })

  it('activate 注册图鉴快捷键，dispose 释放', async () => {
    const { create, log } = workspace()
    const layer = create()

    await layer.activate()
    expect(log.shortcuts).toEqual(['CommandOrControl+Shift+G'])

    layer.dispose()
    expect(log.shortcuts).toEqual([])
  })
})

describe('交互式导入 .ggal', () => {
  it('选包后导入成功，图鉴出现新嘎啦并提示用户', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gala-import-'))
    workspaces.push(root)
    const ggal = writeGgal(join(root, 'ocean.ggal'), { character: sampleCharacter() })
    const { create, log } = workspace({ chooseGgal: async () => ggal })
    const layer = create()

    await expect(layer.importPackage()).resolves.toBe(true)
    expect(layer.panelCards().map(card => card.id)).toContain('gala:ocean-sprite')
    expect(log.notices[0]?.title).toBe('嘎啦包已导入')
  })

  it('导入的市场包立绘走 asset 路由', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gala-import-'))
    workspaces.push(root)
    const ggal = writeGgal(join(root, 'ocean.ggal'), {
      character: sampleCharacter(),
      extras: [{ path: 'assets/avatar.png', data: Buffer.from([0x89, 0x50]) }],
    })
    const { create } = workspace({ chooseGgal: async () => ggal })
    const layer = create()
    await layer.importPackage()

    const card = layer.panelCards().find(item => item.id === 'gala:ocean-sprite')
    expect(card?.art).toContain('/_dsh/desktop/gala/asset?')
    expect(layer.assetRoot('gala:ocean-sprite')).toBeDefined()
  })

  it('用户取消选包时不导入也不提示', async () => {
    const { create, log } = workspace({ chooseGgal: async () => undefined })
    const layer = create()

    await expect(layer.importPackage()).resolves.toBe(false)
    expect(log.notices).toHaveLength(0)
  })

  it('非法包导入失败时提示错误且图鉴不变', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gala-import-'))
    workspaces.push(root)
    const broken = join(root, 'broken.ggal')
    writeFileSync(broken, 'not a zip')
    const { create, log } = workspace({ chooseGgal: async () => broken })
    const layer = create()

    await expect(layer.importPackage()).resolves.toBe(false)
    expect(layer.panelCards().length).toBe(OFFICIAL_COUNT + 1)
    expect(log.notices[0]?.title).toBe('嘎啦包导入失败')
  })
})

describe('皮肤桥（内置皮肤 + --dsw-* 映射层 + 事件）', () => {
  it('内置皮肤 = 经典三件套 + 全员默认 + 一人一肤角色皮肤', () => {
    const { create } = workspace()
    const layer = create()

    const ids = layer.skinList().map(skin => skin.id)
    expect(ids).toContain('gala:skin-cream-pink')
    expect(ids).toContain('gala:skin-mint-soda')
    expect(ids).toContain('gala:skin-star-purple')
    expect(ids[3]).toBe('gala:skin-stars')
    expect(ids).toContain('gala:skin-dsh-llm')
    expect(ids.length).toBe(4 + OFFICIAL_COUNT)
  })

  it('apply 注入 CSS、生成 --dsw 双值层并广播 skin-changed', async () => {
    const { create, log } = workspace()
    const layer = create()
    const events: string[] = []
    layer.events.subscribe(event => events.push(event))

    await layer.skin.apply('gala:skin-mint-soda')

    expect(log.inserted[0]).toContain('--gala-color-primary: #12a184')
    const tokens = layer.skinTokens()
    expect(tokens['--dsw-alias-brand-primary']?.light).toBe('#12a184')
    expect(tokens['--dsw-alias-bg-base']?.light).toBe('#f2fbf8')
    expect(tokens['--dsw-alias-bg-base']?.dark).not.toBe('#f2fbf8') // dark 值经推导
    expect(events).toEqual(['skin-changed'])
  })

  it('revert 恢复原装并再次广播', async () => {
    const { create } = workspace()
    const layer = create()
    await layer.skin.apply('gala:skin-cream-pink')
    expect(Object.keys(layer.skinTokens()).length).toBeGreaterThan(0)

    await layer.skin.revert()

    expect(layer.skin.current()).toBeUndefined()
    expect(layer.skinTokens()).toEqual({})
  })

  it('重启后 activate 恢复上次皮肤并重建映射层', async () => {
    const { userDataDir, profileDir, native } = workspace()
    let bundles: readonly string[] = []
    const make = () =>
      createGalaLayer({
        userDataDir,
        profileDir,
        packages: [],
        bundles: { read: () => bundles, write: next => { bundles = next } },
        native,
      })
    const first = make()
    await first.skin.apply('gala:skin-star-purple')

    const second = make() // 模拟重启
    expect(second.skinTokens()).toEqual({})
    await second.activate()
    expect(second.skinTokens()['--dsw-alias-brand-primary']?.light).toBe('#8b5cf6')
    second.dispose()
  })
})

describe('选肤弹层状态（pickerState）', () => {
  it('尚未 activate：全员不 active、logo 为 null', () => {
    const { create } = workspace()
    const state = create().pickerState()

    expect(state.girls.length).toBe(OFFICIAL_COUNT + 1)
    expect(state.classics.length).toBe(3)
    expect(state.girls.every(girl => !girl.active)).toBe(true)
    expect(state.activeSkinId).toBeNull()
    expect(state.logo).toBeNull()
    expect(state.persona).toBeNull()
  })

  it('首次 activate 自动穿上全员默认皮肤', async () => {
    const { create } = workspace()
    const layer = create()

    await layer.activate()
    const state = layer.pickerState()

    expect(state.activeSkinId).toBe('gala:skin-stars')
    expect(state.girls[0]).toMatchObject({
      skinId: 'gala:skin-stars',
      characterId: 'gala:stars',
      name: 'GALA·群星',
      isDefault: true,
      active: true,
    })
    expect(state.girls.slice(1).every(girl => !girl.isDefault)).toBe(true)
    expect(state.logo?.name).toBe('GALA·群星')
    expect(state.persona).toMatchObject({
      characterId: 'gala:stars',
      headline: '与群星并肩',
    })
    layer.dispose()
  })

  it('角色皮肤生效：对应少女 active，logo 指向她的立绘', async () => {
    const { create } = workspace()
    const layer = create()
    await layer.skin.apply('gala:skin-dsh-llm')
    const state = layer.pickerState()

    const lingling = state.girls.find(girl => girl.skinId === 'gala:skin-dsh-llm')
    expect(lingling?.active).toBe(true)
    expect(lingling?.name).toBe('灵灵')
    expect(lingling?.rarityLabel).toBe('传说')
    expect(lingling?.quote.length).toBeGreaterThan(0)
    expect(state.activeSkinId).toBe('gala:skin-dsh-llm')
    expect(state.logo?.name).toBe('灵灵')
    expect(state.logo?.art).toBe(lingling?.art)
    expect(state.persona).toMatchObject({
      characterId: 'gala:dsh-llm',
      name: '灵灵',
      headline: '与星海对话',
    })
    expect(state.persona?.tagline.length).toBeGreaterThan(0)
    expect(state.girls.filter(girl => girl.active).length).toBe(1)
  })

  it('经典配色生效：classic active 但 logo 为 null（不换鲸鱼）', async () => {
    const { create } = workspace()
    const layer = create()
    await layer.skin.apply('gala:skin-mint-soda')
    const state = layer.pickerState()

    expect(state.classics.find(classic => classic.skinId === 'gala:skin-mint-soda')?.active).toBe(true)
    expect(state.classics.find(classic => classic.skinId === 'gala:skin-mint-soda')?.swatch).toBe('#12a184')
    expect(state.girls.every(girl => !girl.active)).toBe(true)
    expect(state.logo).toBeNull()
    expect(state.persona).toBeNull()
  })
})

describe('合成服务接线', () => {
  it('官方示例配方开箱即用（素材=官方嘎啦）', async () => {
    const { create, log, bundles } = workspace()
    const layer = create()

    await expect(layer.compose.compose('gala:atelier-duo')).resolves.toBe(true)
    expect(bundles()).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(log.relaunched).toBe(1)
  })

  it('profile 配方与官方配方合并加载', async () => {
    const { profileDir, create } = workspace()
    mkdirSync(join(profileDir, 'gala'), { recursive: true })
    writeFileSync(
      join(profileDir, 'gala', 'recipes.json'),
      JSON.stringify({
        recipes: [
          {
            id: 'gala:custom-trio',
            name: '自定义三重奏',
            type: 'bundle',
            tier: 2,
            ingredients: ['gala:dsh-agent'],
            output: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'extra'] },
            description: '用户自己的配方。',
          },
        ],
      }),
    )
    const layer = create()

    const ids = layer.compose.recipes().map(recipe => recipe.id)
    expect(ids).toContain('gala:atelier-duo')
    expect(ids).toContain('gala:custom-trio')
  })

  it('配方不存在时 compose 抛错', async () => {
    const { create } = workspace()
    const layer = create()

    await expect(layer.compose.compose('gala:nonexistent')).rejects.toThrow('找不到配方')
  })
})

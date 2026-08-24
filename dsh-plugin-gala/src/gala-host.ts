/**
 * Gala 层装配（ctx.gala / ctx.galaSkin / ctx.galaGallery / ctx.galaCompose / ctx.galaMarket）
 * — PRD v4.0 §3.1 / §4.1 / §5.2 / §7.4
 *
 * 把 G0–G4 的各个服务按 §4.1 注入顺序组装成一层；原生能力（窗口 / 快捷键 /
 * 对话框 / CSS 注入）全部经 `GalaNative` 注入，整层 node 可测，Electron 只在
 * gala-electron.ts 出现。§7.4 隔离：本模块只装配不兜底，main.ts 用 try/catch
 * 包住——Gala 挂了只是没有图鉴，主进程照常起。
 *
 * 本层还维护皮肤桥状态：当前皮肤的 `--gala-*` tokens 经 gala-skin-map
 * 翻译成官方 UI 的 `--dsw-*` 双值层，client 桥经 HTTP + SSE 取用。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { galaSvgDataUrl } from './gala-avatar.ts'
import {
  CHARACTER_BY_SKIN,
  CHARACTER_SKINS,
  DEFAULT_GALA_SKIN_ID,
  fallbackSkinForCharacter,
  skinIdForCharacter,
} from './gala-character-skins.ts'
import { createGalaCollectionStore, type GalaCollectionStore } from './gala-collection.ts'
import { createGalaComposeService, type GalaComposeService } from './gala-compose.ts'
import { createGalaGalleryService, type GalaGalleryService, type GalleryCard, type GalleryDetail } from './gala-gallery.ts'
import { createGalaEventHub, type GalaEventHub } from './gala-http.ts'
import {
  createGalaMarketService,
  type ConflictResolution,
  type GalaMarketService,
} from './gala-market.ts'
import {
  STARS_GALA,
  OFFICIAL_GALAS,
  OFFICIAL_RECIPES,
  OFFICIALS_BY_ID,
  OFFICIALS_BY_PACKAGE,
  SELECTABLE_GALAS,
} from './gala-officials.ts'
import { RARITY_LABELS } from './gala-panel-page.ts'
import {
  createGalaPersonaService,
  createGalaPersonaStore,
  personaProfileFor,
  type GalaPersonaProfile,
  type GalaPersonaService,
} from './gala-persona.ts'
import { createGalaRegistry, defaultGalaForPackage, type GalaRegistry } from './gala-registry.ts'
import { mapSkinTokens, type TokenPair } from './gala-skin-map.ts'
import {
  createGalaSkinService,
  createGalaSkinStore,
  type GalaSkinService,
} from './gala-skin.ts'
import { BUILTIN_SKINS } from './gala-skins-builtin.ts'
import { galaSlug } from './protocols/market-manifest.ts'
import { loadComposeRecipes, type ComposeRecipe } from './protocols/compose-protocol.ts'
import { validateGalaJson, type GalaCharacter } from './protocols/gala-json.ts'
import { validateSkinManifest, type SkinManifest } from './protocols/skin-protocol.ts'
import type { GalaWorkspaceHost, PersonaPluginDescriptor } from './gala-workspace.ts'

/** 用户数据目录下的 Gala 子目录（PRD §13.2） */
export const GALA_DATA_DIRNAME = 'gala'
/** profile 内的合成配方文件（PRD §10.3） */
export const RECIPES_RELATIVE_PATH = join('gala', 'recipes.json')

/** 一个参与图鉴的已装载包 */
export interface GalaPackageSource {
  /** npm 包名（缺省嘎啦按 §8.4 由包名生成） */
  name: string
  /** 包目录；存在 `gala.json` 时优先采用其中的元数据 */
  dir?: string | undefined
}

/** 原生能力注入（生产实现见 gala-electron.ts） */
export interface GalaNative {
  /** 向主窗口注入 CSS，返回用于精确移除的 key（webContents.insertCSS） */
  insertCss(css: string): Promise<string>
  /** 按 key 精确移除已注入 CSS */
  removeCss(key: string): Promise<void>
  /** 打开 Gala 面板并深链到指定视图 */
  openPanel(view: string): void
  /** 注册系统级快捷键；缺省则快捷键为 no-op */
  registerShortcut?(accelerator: string, handler: () => void): () => void
  /** 确认对话框（合成前置确认，PRD §7.4） */
  confirm(message: string): Promise<boolean>
  /** 切换角色工作台前的原生确认；明确告知会保存并重启。 */
  confirmWorkspaceSwitch?(name: string): Promise<boolean>
  /** 选择 `.ggal` 文件；用户取消返回 undefined */
  chooseGgal(): Promise<string | undefined>
  /** id 冲突处置（PRD §11.6） */
  resolveConflict(id: string): Promise<ConflictResolution>
  /** 结果提示 */
  notify(title: string, body: string): void
  /** 合成后重启（PRD §10.4） */
  relaunch(): void
}

/** profile bundles 读写（合成与回滚都要改 profile 清单） */
export interface GalaBundleAccess {
  read(): readonly string[]
  write(bundles: readonly string[]): void
}

/** Gala 层装配参数 */
export interface GalaLayerOptions {
  /** 应用用户数据目录（collection.json / skins.json / market/ 的父目录，§13.2） */
  userDataDir: string
  /** 当前 profile 目录（读 gala/recipes.json，§10.3） */
  profileDir: string
  /** 已装载的包，作为图鉴种子（§8.4 缺省规则） */
  packages: readonly GalaPackageSource[]
  /** 官方立绘资产根目录（assets/gala/officials；缺省则官方嘎啦用程序化 SVG） */
  officialsDir?: string | undefined
  bundles: GalaBundleAccess
  native: GalaNative
  /** Workspace-specific appearance document; defaults to the legacy shared file. */
  appearanceStorePath?: string | undefined
  /** Optional Desktop Profile coordinator. */
  workspaces?: GalaWorkspaceHost | undefined
}

/** 面板用的卡片：GalleryCard + 已解析的可显示形象 */
export interface PanelCard extends GalleryCard {
  /** 可直接放进 <img src> 的地址（asset 路由相对路径或 svg data URL） */
  art: string
}

/** 面板用的详情 */
export interface PanelDetail extends GalleryDetail {
  art: string
}

/** 选肤弹层里的一位少女（一人一肤） */
export interface PickerGirl {
  skinId: string
  characterId: string
  name: string
  /** 产品默认 IP（目前只有全体集合）。 */
  isDefault: boolean
  /** 装备台词（lines.onEquip；无则空串） */
  quote: string
  rarity: string
  rarityLabel: string
  family: string
  /** 立绘地址（asset 路由或 SVG data URL） */
  art: string
  active: boolean
  /** 人设原型（无人设为空串） */
  archetype: string
}

/** 选肤弹层里的一套经典配色 */
export interface PickerClassic {
  skinId: string
  name: string
  description: string
  /** 色板主色（--gala-color-primary） */
  swatch: string
  active: boolean
}

/** 当前皮肤对应的页面 logo 替换信息（角色皮肤才有） */
export interface PickerLogo {
  art: string
  name: string
}

/** 当前角色在欢迎页上的完整呈现（经典配色时为空） */
export interface PickerPersona {
  characterId: string
  name: string
  headline: string
  tagline: string
  /** 成年角色场景图；资产尚未落盘时为空，由 client 安全降级为纯色主题 */
  backdrop: string | null
}

/** 选肤弹层与 logo 替换的完整状态（GET /picker） */
export interface PickerState {
  girls: readonly PickerGirl[]
  classics: readonly PickerClassic[]
  activeSkinId: string | null
  logo: PickerLogo | null
  persona: PickerPersona | null
  workspaceMode: 'shared' | 'isolated'
  activeWorkspace: { personaId: string; name: string; profileName: string } | null
  activeAppearance: string | null
  restartRequired: boolean
  plugins: readonly PersonaPluginDescriptor[]
  /** 角色人设对话开关 */
  personaEnabled: boolean
  /** 当前外观对应的人设摘要（原装 / 经典配色 / 全员为 null） */
  activePersona: GalaPersonaProfile | null
}

/** 装配完成的 Gala 层 */
export interface GalaLayer {
  registry: GalaRegistry
  collection: GalaCollectionStore
  gallery: GalaGalleryService
  skin: GalaSkinService
  compose: GalaComposeService
  market: GalaMarketService
  /** 角色人设（提示词段落 + 开关） */
  persona: GalaPersonaService
  events: GalaEventHub
  /** 市场目录（PRD §13.2 gala/market） */
  marketDir: string
  /** 面板卡片（含已解析形象） */
  panelCards(): readonly PanelCard[]
  /** 面板详情 */
  panelDetail(id: string): PanelDetail | undefined
  /** 皮肤列表（内置 + 已导入） */
  skinList(): readonly SkinManifest[]
  /** 当前皮肤映射到官方 UI 的 --dsw-* 双值层（无皮肤时为空对象） */
  skinTokens(): Record<string, TokenPair>
  /** 选肤弹层状态（默认全员 + 单角色 + 经典配色 + 当前 logo） */
  pickerState(): PickerState
  /** 资产路由的包目录解析（官方 / 市场包） */
  assetRoot(packageId: string): string | undefined
  /** 交互式导入：选包 → 导入 → 提示；用户取消返回 false */
  importPackage(): Promise<boolean>
  /** 启动收尾：注册快捷键 + 恢复上次皮肤（§9.4 / G11） */
  activate(): Promise<void>
  /** 释放快捷键等长驻资源 */
  dispose(): void
}

/** 读取包内 `gala.json`；缺失时官方目录兜底，再落 §8.4 缺省嘎啦 */
function characterForPackage(source: GalaPackageSource): GalaCharacter {
  if (source.dir !== undefined) {
    const manifestPath = join(source.dir, 'gala.json')
    if (existsSync(manifestPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (validateGalaJson(parsed)) return parsed
      } catch {
        // 包内元数据坏了不该拖垮图鉴：继续走兜底
      }
    }
  }
  return OFFICIALS_BY_PACKAGE.get(source.name) ?? defaultGalaForPackage(source.name)
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 按 PRD §4.1 的注入顺序装配整个 Gala 层 */
export function createGalaLayer(options: GalaLayerOptions): GalaLayer {
  const { userDataDir, profileDir, packages, officialsDir, bundles, native, workspaces } = options
  const dataDir = join(userDataDir, GALA_DATA_DIRNAME)
  const marketDir = join(dataDir, 'market')
  const events = createGalaEventHub()

  const registry = createGalaRegistry()
  // 官方全家桶先播种；layer 包的 gala.json（同 id）可覆盖
  registry.register(STARS_GALA.character)
  for (const entry of OFFICIAL_GALAS) registry.register(entry.character)
  for (const source of packages) registry.register(characterForPackage(source))

  const collection = createGalaCollectionStore(join(dataDir, 'collection.json'))
  const recipes = (): readonly ComposeRecipe[] => [
    ...OFFICIAL_RECIPES,
    ...loadComposeRecipes(join(profileDir, RECIPES_RELATIVE_PATH)),
  ]

  const market = createGalaMarketService({
    marketDir,
    registry,
    readBundles: () => bundles.read(),
    writeBundles: next => { bundles.write(next) },
    onConflict: id => native.resolveConflict(id),
  })
  market.restore()

  // ── 皮肤 ──────────────────────────────────────────────────────────
  let activeSkinDir: string | undefined
  const skinDirs = new Map<string, string>()
  const skinStore = createGalaSkinStore(options.appearanceStorePath ?? join(dataDir, 'skins.json'))
  const skin = createGalaSkinService({
    host: {
      insertCss: css => native.insertCss(css),
      removeCss: key => native.removeCss(key),
      readCss: cssPath => {
        if (activeSkinDir === undefined) throw new Error('gala: 皮肤包目录未知，无法读取 CSS')
        return readFileSync(join(activeSkinDir, cssPath), 'utf8')
      },
      store: skinStore,
    },
  })
  for (const manifest of BUILTIN_SKINS) skin.register(manifest)
  // 默认全员 + 一人一肤：选中形象 = 换上对应主题
  for (const manifest of CHARACTER_SKINS) skin.register(manifest)
  const characterBySkin = new Map(CHARACTER_BY_SKIN)

  const registerCharacterSkins = (): void => {
    const registered = new Set(skin.list().map(manifest => manifest.id))
    for (const character of registry.list()) {
      if (character.type !== 'character') continue
      const skinId = skinIdForCharacter(character.id)
      characterBySkin.set(skinId, character.id)
      if (registered.has(skinId)) continue
      skin.register(fallbackSkinForCharacter(character))
      registered.add(skinId)
    }
  }
  registerCharacterSkins()

  /** 当前皮肤映射到官方 UI 的双值层（皮肤变更时重算并广播） */
  let dswLayer: Record<string, TokenPair> = {}
  const refreshSkinBridge = (): void => {
    const current = skin.current()
    dswLayer = current === undefined ? {} : mapSkinTokens(current.tokens)
    events.publish('skin-changed')
  }

  /** 市场里的皮肤包注册进皮肤服务（角色包由 market.restore 进图鉴） */
  const registerMarketSkins = (): void => {
    for (const installed of market.list()) {
      if (installed.type !== 'skin') continue
      const manifest: unknown = installed.character
      if (!validateSkinManifest(manifest)) continue
      skinDirs.set((manifest as SkinManifest).id, installed.dir)
      try {
        skin.register(manifest as SkinManifest)
      } catch {
        // 单个皮肤清单不合规不该阻断其余皮肤
      }
    }
  }
  registerMarketSkins()

  const applySkin = async (skinId: string): Promise<void> => {
    activeSkinDir = skinDirs.get(skinId)
    await skin.apply(skinId)
    refreshSkinBridge()
  }
  const revertSkin = async (): Promise<void> => {
    await skin.revert()
    activeSkinDir = undefined
    refreshSkinBridge()
  }

  // ── 人设：当前皮肤 → 角色 → 提示词段落 ─────────────────────────────
  const activeCharacter = (): GalaCharacter | undefined => {
    const skinId = skin.current()?.id
    if (skinId === undefined) return undefined
    const characterId = characterBySkin.get(skinId)
    return characterId === undefined ? undefined : registry.get(characterId)
  }
  const personaService = createGalaPersonaService({
    store: createGalaPersonaStore(join(dataDir, 'persona.json')),
    current: activeCharacter,
    onChange: () => { events.publish('persona-changed') },
  })

  // ── 图鉴与形象 ────────────────────────────────────────────────────
  const assetRoot = (packageId: string): string | undefined => {
    const marketPackage = market.list().find(item => item.id === packageId)
    if (marketPackage !== undefined) return marketPackage.dir
    if (officialsDir !== undefined) {
      const officialDir = join(officialsDir, galaSlug(packageId))
      if (existsSync(officialDir)) return officialDir
    }
    return undefined
  }

  /** 解析卡片形象：包内文件走 asset 路由；否则程序化 SVG（永不坏图） */
  const artFor = (character: Pick<GalaCharacter, 'id' | 'family' | 'rarity'>, avatar: string): string => {
    const root = assetRoot(character.id)
    if (root !== undefined && avatar !== '' && existsSync(join(root, avatar))) {
      const params = new URLSearchParams({ pkg: character.id, path: avatar })
      return `/_dsh/desktop/gala/asset?${params.toString()}`
    }
    return galaSvgDataUrl(character)
  }

  /** 解析可选角色资产；不存在时返回 null，绝不向 client 发坏图地址。 */
  const optionalAssetFor = (characterId: string, relativePath: string): string | null => {
    const root = assetRoot(characterId)
    if (root === undefined || relativePath === '' || !existsSync(join(root, relativePath))) return null
    const params = new URLSearchParams({ pkg: characterId, path: relativePath })
    return `/_dsh/desktop/gala/asset?${params.toString()}`
  }

  const gallery = createGalaGalleryService({
    registry,
    collection,
    recipes,
    openWindow: () => { native.openPanel('gallery') },
    ...(native.registerShortcut ? { registerShortcut: native.registerShortcut.bind(native) } : {}),
  })

  const panelCards = (): readonly PanelCard[] =>
    gallery.list().map(card => {
      const character = registry.get(card.id)
      return {
        ...card,
        art: artFor(
          { id: card.id, family: character?.family ?? 'system', rarity: card.rarity },
          card.avatar,
        ),
      }
    })

  const panelDetail = (id: string): PanelDetail | undefined => {
    const detail = gallery.getDetail(id)
    if (detail === undefined) return undefined
    return { ...detail, art: artFor(detail, detail.avatar) }
  }

  /** 选肤弹层状态：默认全员 + 10 位少女 + 3 套经典配色 + 当前 logo */
  const pickerState = (): PickerState => {
    const activeSkinId = skin.current()?.id ?? null
    const girls = registry.list().filter(character => character.type === 'character').map(character => {
      const skinId = skinIdForCharacter(character.id)
      return {
        skinId,
        characterId: character.id,
        name: character.name,
        isDefault: character.id === STARS_GALA.character.id,
        quote: character.lines?.onEquip ?? '',
        rarity: character.rarity,
        rarityLabel: RARITY_LABELS[character.rarity],
        family: character.family,
        art: artFor(character, character.assets?.avatar ?? ''),
        active: activeSkinId === skinId,
        archetype: personaProfileFor(character)?.archetype ?? '',
      }
    })
    const classics = BUILTIN_SKINS.map(manifest => ({
      skinId: manifest.id,
      name: manifest.name,
      description: manifest.description,
      swatch: manifest.tokens['--gala-color-primary'] ?? '#888888',
      active: activeSkinId === manifest.id,
    }))
    const characterId = activeSkinId === null ? undefined : characterBySkin.get(activeSkinId)
    const logoCharacter = characterId === undefined
      ? undefined
      : registry.get(characterId) ?? OFFICIALS_BY_ID.get(characterId)
    const logo = logoCharacter === undefined
      ? null
      : { art: artFor(logoCharacter, logoCharacter.assets?.avatar ?? ''), name: logoCharacter.name }
    const official = characterId === undefined
      ? undefined
      : SELECTABLE_GALAS.find(entry => entry.character.id === characterId)
    const customCharacter = characterId === undefined ? undefined : registry.get(characterId)
    const persona = official !== undefined
      ? {
          characterId: official.character.id,
          name: official.character.name,
          headline: official.presentation.headline,
          tagline: official.presentation.tagline,
          backdrop: optionalAssetFor(official.character.id, official.presentation.backdrop),
        }
      : customCharacter?.type === 'character'
        ? {
            characterId: customCharacter.id,
            name: customCharacter.name,
            headline: `与${customCharacter.name}同行`,
            tagline: customCharacter.description,
            backdrop: optionalAssetFor(customCharacter.id, customCharacter.assets.avatar),
          }
        : null
    const workspace = workspaces?.summary() ?? {
      mode: 'shared' as const,
      activeWorkspace: null,
      restartRequired: false,
      plugins: [],
    }
    return {
      girls,
      classics,
      activeSkinId,
      logo,
      persona,
      workspaceMode: workspace.mode,
      activeWorkspace: workspace.activeWorkspace,
      activeAppearance: activeSkinId,
      restartRequired: workspace.restartRequired,
      plugins: workspace.plugins,
      personaEnabled: personaService.isEnabled(),
      activePersona: personaService.profile(),
    }
  }

  const compose = createGalaComposeService({
    owned: () => registry.list().map(character => character.id),
    recipes,
    readBundles: () => bundles.read(),
    writeBundles: next => { bundles.write(next) },
    confirm: message => native.confirm(message),
    relaunch: () => { native.relaunch() },
  })

  let releaseShortcut: (() => void) | undefined

  return {
    registry,
    collection,
    gallery,
    skin: { ...skin, apply: applySkin, revert: revertSkin },
    compose,
    market,
    persona: personaService,
    events,
    marketDir,
    panelCards,
    panelDetail,
    skinList: () => skin.list(),
    skinTokens: () => dswLayer,
    pickerState,
    assetRoot,

    importPackage: async () => {
      const ggalPath = await native.chooseGgal()
      if (ggalPath === undefined) return false
      try {
        const result = await market.import(ggalPath)
        if (!result.success) {
          native.notify('未导入嘎啦包', `${result.id} 已存在，本次跳过。`)
          return false
        }
        registerMarketSkins()
        registerCharacterSkins()
        events.publish('collection-changed')
        native.notify('嘎啦包已导入', `${result.id} 已加入图鉴。`)
        return true
      } catch (cause) {
        native.notify('嘎啦包导入失败', messageOf(cause))
        return false
      }
    },

    activate: async () => {
      releaseShortcut = gallery.registerGalleryShortcut()
      const stored = skinStore.getActive()
      try {
        activeSkinDir = typeof stored === 'string' ? skinDirs.get(stored) : undefined
        await skin.restore()
        if (stored === undefined) await applySkin(DEFAULT_GALA_SKIN_ID)
        else refreshSkinBridge()
      } catch (cause) {
        native.notify('皮肤恢复失败', messageOf(cause))
      }
    },

    dispose: () => {
      releaseShortcut?.()
      releaseShortcut = undefined
      collection.save()
    },
  }
}

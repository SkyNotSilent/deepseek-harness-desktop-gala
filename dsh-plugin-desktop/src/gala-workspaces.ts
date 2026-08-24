/** Gala persona workspaces layered over Desktop's restart-safe Profile launcher. */

import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import type {
  GalaWorkspaceHost,
  GalaWorkspaceSummary,
  GalaWorkspaceSwitchResult,
  GalaWorkspaceTarget,
  PersonaPluginDescriptor,
} from 'dsh-plugin-gala'
import { assertDesktopProfileName } from './profile-manager.ts'

const STATE_VERSION = 1
const BASE_BUNDLE = '@deepseek-ai/dsh-base'
const WEB_BUNDLE = '@deepseek-ai/dsh-web-app'
const CORE_BUNDLES = new Set([
  BASE_BUNDLE,
  WEB_BUNDLE,
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-commands',
])

interface ManagedMarker {
  readonly version: 1
  readonly personaId: string
  readonly personaName: string
}

interface WorkspaceBinding {
  readonly profileName: string
  readonly personaName: string
  readonly plugins: Record<string, boolean>
  restartRequired?: boolean
}

interface WorkspaceSeed {
  readonly createdAt: string
  readonly sourceProfile: string
  readonly bundles: readonly string[]
}

interface WorkspaceState {
  readonly version: 1
  mode: 'shared' | 'isolated'
  sharedProfile: string
  seed?: WorkspaceSeed
  bindings: Record<string, WorkspaceBinding>
  catalog: Record<string, string>
  restartRequired: boolean
}

interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: {
    profile?: { bundles?: unknown }
    galaWorkspace?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface GalaWorkspaceCoordinatorOptions {
  readonly userDataDir: string
  readonly homeDir: string
  readonly currentProfileName: string
  readonly currentProfileDir: string
  readonly validateProfile: (name: string) => void
  readonly selectProfile: (name: string) => Promise<void>
  readonly restartCurrentProfile: () => Promise<void>
}

function atomicWrite(filename: string, contents: string): void {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(filename), `.${basename(filename)}.${process.pid}.${randomUUID()}.tmp`)
  writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  renameSync(temporary, filename)
}

function readJsonObject(filename: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(filename, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`gala workspace: expected an object in ${filename}`)
  }
  return value as Record<string, unknown>
}

function readManifest(profileDir: string): ProfileManifest {
  return readJsonObject(join(profileDir, 'package.json')) as ProfileManifest
}

function bundlesOf(manifest: ProfileManifest): string[] {
  const value = manifest.dsh?.profile?.bundles
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('gala workspace: profile must declare a string dsh.profile.bundles list')
  }
  const bundles = [...value] as string[]
  const base = bundles.indexOf(BASE_BUNDLE)
  const web = bundles.indexOf(WEB_BUNDLE)
  if (base < 0 || web <= base) {
    throw new Error(`gala workspace: ${BASE_BUNDLE} must precede ${WEB_BUNDLE}`)
  }
  return bundles
}

function markerOf(manifest: ProfileManifest): ManagedMarker | undefined {
  const value = manifest.dsh?.galaWorkspace
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const marker = value as Partial<ManagedMarker>
  if (marker.version !== 1 || typeof marker.personaId !== 'string' || typeof marker.personaName !== 'string') {
    return undefined
  }
  return marker as ManagedMarker
}

function profileNameFor(personaId: string): string {
  if (/^gala:(?:stars|dsh-[a-z0-9-]{3,48})$/u.test(personaId)) {
    return `gala-${personaId.slice('gala:'.length)}`
  }
  const digest = createHash('sha256').update(personaId).digest('hex').slice(0, 16)
  return `gala-user-${digest}`
}

const SENSITIVE_SETTING_KEY = /(?:api[-_]?key|token|secret|password|credential|authorization|cookie)/iu

/** Keep role settings useful without cloning credentials into every Profile. */
function sanitizeSettingsText(text: string): string {
  const document = parseDocument(text)
  if (document.errors.length > 0) {
    throw new Error(`gala workspace: settings.yaml is invalid: ${document.errors.map(error => error.message).join('; ')}`)
  }
  const clean = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(clean)
    if (input === null || typeof input !== 'object') return input
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_SETTING_KEY.test(key))
      .map(([key, nested]) => [key, clean(nested)]))
  }
  return stringify(clean(document.toJS()))
}

function validState(value: unknown): value is WorkspaceState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<WorkspaceState>
  return state.version === STATE_VERSION
    && (state.mode === 'shared' || state.mode === 'isolated')
    && typeof state.sharedProfile === 'string'
    && typeof state.bindings === 'object' && state.bindings !== null
    && typeof state.catalog === 'object' && state.catalog !== null
    && typeof state.restartRequired === 'boolean'
}

/** Read the managed marker without letting malformed metadata escape discovery. */
export function readGalaWorkspaceMarker(profileDir: string): ManagedMarker | undefined {
  try {
    return markerOf(readManifest(profileDir))
  } catch {
    return undefined
  }
}

export function createGalaWorkspaceCoordinator(options: GalaWorkspaceCoordinatorOptions): GalaWorkspaceHost {
  const dataDir = join(options.userDataDir, 'gala')
  const statePath = join(dataDir, 'workspaces.json')
  const seedDir = join(dataDir, 'workspace-seed')
  const appearancesDir = join(dataDir, 'appearances')
  const sharedAppearancePath = join(dataDir, 'skins.json')

  const defaultState = (): WorkspaceState => ({
    version: STATE_VERSION,
    mode: 'shared',
    sharedProfile: options.currentProfileName,
    bindings: {},
    catalog: {},
    restartRequired: false,
  })
  const load = (): WorkspaceState => {
    if (!existsSync(statePath)) return defaultState()
    const parsed: unknown = JSON.parse(readFileSync(statePath, 'utf8'))
    if (!validState(parsed)) throw new Error('gala workspace: invalid workspaces.json')
    return parsed
  }
  const save = (state: WorkspaceState): void => {
    atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`)
  }

  let state = load()
  let operation: Promise<unknown> | undefined
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    if (operation !== undefined) return Promise.reject(new Error('角色空间正在准备，请不要重复操作'))
    const running = work()
    operation = running
    void running.finally(() => { if (operation === running) operation = undefined }).catch(() => {})
    return running
  }

  const currentMarker = (): ManagedMarker | undefined => readGalaWorkspaceMarker(options.currentProfileDir)
  const appearancePath = (profileName: string): string => join(appearancesDir, `${profileName}.json`)

  const freezeSeed = (): WorkspaceSeed => {
    const manifest = readManifest(options.currentProfileDir)
    const bundles = bundlesOf(manifest)
    mkdirSync(seedDir, { recursive: true, mode: 0o700 })
    const cleanManifest: ProfileManifest = {
      ...manifest,
      dsh: { ...manifest.dsh, galaWorkspace: undefined },
    }
    atomicWrite(join(seedDir, 'package.json'), `${JSON.stringify(cleanManifest, null, 2)}\n`)
    const patch = join(options.currentProfileDir, 'cordis.patch.yml')
    if (existsSync(patch)) copyFileSync(patch, join(seedDir, 'cordis.patch.yml'))
    const sourceSettings = existsSync(join(options.currentProfileDir, 'settings.yaml'))
      ? join(options.currentProfileDir, 'settings.yaml')
      : join(options.homeDir, 'settings.yaml')
    if (existsSync(sourceSettings)) {
      atomicWrite(join(seedDir, 'settings.yaml'), sanitizeSettingsText(readFileSync(sourceSettings, 'utf8')))
    }
    return { createdAt: new Date().toISOString(), sourceProfile: options.currentProfileName, bundles }
  }

  const syncCatalog = (): void => {
    const manifest = readManifest(options.currentProfileDir)
    const currentBundles = bundlesOf(manifest)
    let changed = false
    for (const bundle of currentBundles) {
      if (!(bundle in state.catalog)) {
        state.catalog[bundle] = manifest.dependencies?.[bundle] ?? '*'
        changed = true
      }
    }
    const marker = currentMarker()
    if (marker !== undefined) {
      const binding = state.bindings[marker.personaId]
      if (binding !== undefined) {
        for (const bundle of currentBundles) {
          if (binding.plugins[bundle] !== true) {
            binding.plugins[bundle] = true
            changed = true
          }
        }
      }
    }
    if (changed) save(state)
  }

  const pluginDescriptors = (): PersonaPluginDescriptor[] => {
    syncCatalog()
    const marker = currentMarker()
    const binding = marker === undefined ? undefined : state.bindings[marker.personaId]
    const seedBundles = new Set(state.seed?.bundles ?? [])
    return Object.keys(state.catalog).sort().map(packageName => {
      const locked = CORE_BUNDLES.has(packageName)
      const enabled = locked || (binding?.plugins[packageName] ?? seedBundles.has(packageName))
      return {
        packageName,
        label: packageName.replace(/^@deepseek-ai\//u, ''),
        enabled,
        locked,
        available: true,
        restartRequired: binding?.restartRequired === true,
        ...(locked ? { reason: '系统必需主链，关闭会破坏启动或聊天' } : {}),
      }
    })
  }

  const summary = (): GalaWorkspaceSummary => {
    const marker = currentMarker()
    const binding = marker === undefined ? undefined : state.bindings[marker.personaId]
    return {
      mode: state.mode,
      sharedProfile: state.sharedProfile,
      activeWorkspace: marker === undefined ? null : {
        personaId: marker.personaId,
        name: marker.personaName,
        profileName: options.currentProfileName,
      },
      restartRequired: binding?.restartRequired === true,
      plugins: pluginDescriptors(),
    }
  }

  const materialize = (target: GalaWorkspaceTarget): WorkspaceBinding => {
    if (state.seed === undefined) throw new Error('角色空间种子不存在，请先重新开启独立空间')
    const profileName = state.bindings[target.personaId]?.profileName ?? profileNameFor(target.personaId)
    assertDesktopProfileName(profileName)
    const profileDir = join(options.homeDir, 'profiles', profileName)
    const existing = existsSync(join(profileDir, 'package.json'))
    if (existing) {
      const existingManifest = readManifest(profileDir)
      const marker = markerOf(existingManifest)
      if (marker?.personaId !== target.personaId) {
        throw new Error(`角色空间 Profile ${profileName} 已被其他内容占用`)
      }
      const pluginState = state.bindings[target.personaId]?.plugins
        ?? Object.fromEntries(state.seed.bundles.map(bundle => [bundle, true]))
      const seedBundles = new Set(state.seed.bundles)
      const desiredBundles = Object.keys(state.catalog).filter(name =>
        seedBundles.has(name) || CORE_BUNDLES.has(name) || pluginState[name] === true)
      const dependencies = { ...(existingManifest.dependencies ?? {}) }
      for (const [name, version] of Object.entries(state.catalog)) dependencies[name] = version
      atomicWrite(join(profileDir, 'package.json'), `${JSON.stringify({
        ...existingManifest,
        dependencies,
        dsh: { ...existingManifest.dsh, profile: { ...existingManifest.dsh?.profile, bundles: desiredBundles } },
      }, null, 2)}\n`)
    } else {
      mkdirSync(profileDir, { recursive: true, mode: 0o700 })
      const seedManifest = readJsonObject(join(seedDir, 'package.json')) as ProfileManifest
      const dependencies = { ...(seedManifest.dependencies ?? {}) }
      for (const [name, version] of Object.entries(state.catalog)) dependencies[name] = version
      const seedBundles = state.seed.bundles
      const plugins = Object.fromEntries(seedBundles.map(bundle => [bundle, true]))
      const manifest: ProfileManifest = {
        ...seedManifest,
        name: `dsh-profile-${profileName}`,
        private: true,
        dependencies,
        dsh: {
          ...seedManifest.dsh,
          profile: { ...seedManifest.dsh?.profile, bundles: [...seedBundles] },
          galaWorkspace: { version: 1, personaId: target.personaId, personaName: target.name },
        },
      }
      atomicWrite(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      for (const filename of ['cordis.patch.yml', 'settings.yaml']) {
        const source = join(seedDir, filename)
        if (existsSync(source)) copyFileSync(source, join(profileDir, filename))
      }
      state.bindings[target.personaId] = { profileName, personaName: target.name, plugins }
      save(state)
    }
    if (state.bindings[target.personaId] === undefined) {
      state.bindings[target.personaId] = {
        profileName,
        personaName: target.name,
        plugins: Object.fromEntries((state.seed?.bundles ?? []).map(bundle => [bundle, true])),
      }
      save(state)
    }
    return state.bindings[target.personaId]!
  }

  const writeAppearance = (filename: string, active: string | null): void => {
    atomicWrite(filename, `${JSON.stringify({ version: 2, initialized: true, active }, null, 2)}\n`)
  }

  return {
    get appearanceStorePath() {
      return currentMarker() === undefined ? sharedAppearancePath : appearancePath(options.currentProfileName)
    },
    summary,
    enable: () => exclusive(async () => {
      if (state.mode === 'isolated') return summary()
      syncCatalog()
      state.seed = freezeSeed()
      state.sharedProfile = options.currentProfileName
      state.mode = 'isolated'
      save(state)
      return summary()
    }),
    disable: activeAppearance => exclusive(async (): Promise<GalaWorkspaceSwitchResult> => {
      if (state.mode === 'shared') return { restarted: false, profileName: options.currentProfileName }
      const previous = structuredClone(state)
      try {
        writeAppearance(sharedAppearancePath, activeAppearance)
        state.mode = 'shared'
        save(state)
        if (options.currentProfileName === state.sharedProfile) {
          return { restarted: false, profileName: state.sharedProfile }
        }
        await options.selectProfile(state.sharedProfile)
        return { restarted: true, profileName: state.sharedProfile }
      } catch (cause) {
        state = previous
        save(state)
        throw cause
      }
    }),
    switchWorkspace: (target, appearance) => exclusive(async (): Promise<GalaWorkspaceSwitchResult> => {
      if (state.mode !== 'isolated') throw new Error('角色独立空间尚未开启')
      const binding = materialize(target)
      writeAppearance(appearancePath(binding.profileName), appearance)
      options.validateProfile(binding.profileName)
      if (binding.profileName === options.currentProfileName) {
        return { restarted: false, profileName: binding.profileName }
      }
      await options.selectProfile(binding.profileName)
      return { restarted: true, profileName: binding.profileName }
    }),
    stagePlugins: changes => exclusive(async () => {
      if (state.mode !== 'isolated') throw new Error('公共空间不保存角色插件编队')
      const marker = currentMarker()
      if (marker === undefined) throw new Error('请先进入一个角色工作台')
      const binding = state.bindings[marker.personaId]
      if (binding === undefined) throw new Error('当前角色工作台没有受管记录')
      const pluginStateBefore = { ...binding.plugins }
      const manifest = readManifest(options.currentProfileDir)
      const current = new Set(bundlesOf(manifest))
      for (const [packageName, enabled] of Object.entries(changes)) {
        if (!(packageName in state.catalog)) throw new Error(`插件尚未进入公共目录: ${packageName}`)
        if (CORE_BUNDLES.has(packageName) && !enabled) throw new Error(`系统必需插件不可关闭: ${packageName}`)
        binding.plugins[packageName] = enabled
        if (enabled) current.add(packageName)
        else current.delete(packageName)
      }
      const order = Object.keys(state.catalog)
      const bundles = order.filter(name => current.has(name) || CORE_BUNDLES.has(name))
      const base = bundles.indexOf(BASE_BUNDLE)
      const web = bundles.indexOf(WEB_BUNDLE)
      if (base < 0 || web <= base) throw new Error('插件编队破坏了系统必需加载顺序')
      const before = `${JSON.stringify(manifest, null, 2)}\n`
      atomicWrite(join(options.currentProfileDir, 'package.json'), `${JSON.stringify({
        ...manifest,
        dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } },
      }, null, 2)}\n`)
      try {
        options.validateProfile(options.currentProfileName)
      } catch (cause) {
        atomicWrite(join(options.currentProfileDir, 'package.json'), before)
        for (const key of Object.keys(binding.plugins)) delete binding.plugins[key]
        Object.assign(binding.plugins, pluginStateBefore)
        throw cause
      }
      binding.restartRequired = true
      save(state)
      return summary()
    }),
    applyPlugins: () => exclusive(async () => {
      const marker = currentMarker()
      const binding = marker === undefined ? undefined : state.bindings[marker.personaId]
      if (binding?.restartRequired !== true) return
      options.validateProfile(options.currentProfileName)
      binding.restartRequired = false
      save(state)
      try {
        await options.restartCurrentProfile()
      } catch (cause) {
        binding.restartRequired = true
        save(state)
        throw cause
      }
    }),
  }
}

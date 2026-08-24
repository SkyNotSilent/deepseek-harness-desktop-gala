/** Read-only launch presentation derived from the same persisted appearance as Gala. */

import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { CHARACTER_BY_SKIN, CHARACTER_SKINS, fallbackSkinForCharacter, skinIdForCharacter } from './gala-character-skins.ts'
import { SELECTABLE_GALAS } from './gala-officials.ts'
import { BUILTIN_SKINS } from './gala-skins-builtin.ts'
import { GALA_ENTRY, isSafeEntryPath } from './gala-market.ts'
import { validateGalaJson, type GalaCharacter } from './protocols/gala-json.ts'
import { galaSlug } from './protocols/market-manifest.ts'
import type { SkinManifest } from './protocols/skin-protocol.ts'

export type GalaSplashAppearanceKind = 'character' | 'classic' | 'original'

/** Minimal, trusted data needed to render a launch window without starting Cordis. */
export interface GalaSplashAppearance {
  readonly kind: GalaSplashAppearanceKind
  readonly appearanceId: string | null
  readonly name: string
  readonly message: string
  readonly accent: string
  readonly background: string
  readonly surface: string
  readonly firstRun: boolean
  readonly recovered: boolean
  readonly artPath: string
}

export interface ResolveGalaSplashAppearanceOptions {
  readonly userDataDir: string
  readonly profileName: string
  readonly isolatedWorkspace: boolean
  readonly officialsDir: string
}

interface StoredAppearance {
  readonly active: string | null | undefined
  readonly recovered: boolean
}

const ORIGINAL_ACCENT = '#4d6bfe'
const ORIGINAL_BACKGROUND = '#f5f7ff'
const ORIGINAL_SURFACE = '#e8edff'

function color(manifest: SkinManifest, token: string, fallback: string): string {
  const value = manifest.tokens[token]
  return typeof value === 'string' ? value : fallback
}

function themeOf(manifest: SkinManifest): Pick<GalaSplashAppearance, 'accent' | 'background' | 'surface'> {
  return {
    accent: color(manifest, '--gala-color-primary', ORIGINAL_ACCENT),
    background: color(manifest, '--gala-color-bg', ORIGINAL_BACKGROUND),
    surface: color(manifest, '--gala-color-surface', ORIGINAL_SURFACE),
  }
}

function readStoredAppearance(filename: string): StoredAppearance {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filename, 'utf8'))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { active: undefined, recovered: false }
    }
    return { active: null, recovered: true }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { active: null, recovered: true }
  }
  const record = parsed as Record<string, unknown>
  const active = record.active
  const validActive = active === null || typeof active === 'string'
  const validVersion = record.version === 1 || record.version === 2 && record.initialized === true
  if (!validActive || !validVersion) return { active: null, recovered: true }
  return { active, recovered: false }
}

function installedCharacters(marketDir: string): Array<{ character: GalaCharacter; dir: string }> {
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(marketDir, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    return []
  }
  const characters: Array<{ character: GalaCharacter; dir: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(marketDir, entry.name)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(dir, GALA_ENTRY), 'utf8'))
    } catch {
      continue
    }
    if (!validateGalaJson(parsed) || parsed.type !== 'character') continue
    characters.push({ character: parsed, dir })
  }
  return characters
}

function safeAvatarPath(dir: string, character: GalaCharacter): string | undefined {
  const relative = character.assets.avatar
  if (!isSafeEntryPath(relative)) return undefined
  const avatar = join(dir, relative)
  return existsSync(avatar) ? avatar : undefined
}

function starsArt(officialsDir: string): string {
  const stars = SELECTABLE_GALAS[0]!
  return join(officialsDir, galaSlug(stars.character.id), stars.character.assets.avatar)
}

function originalAppearance(
  options: ResolveGalaSplashAppearanceOptions,
  recovered: boolean,
): GalaSplashAppearance {
  return {
    kind: 'original',
    appearanceId: null,
    name: '原装界面',
    message: recovered ? '外观记录异常，正在安全启动' : '正在恢复上次的原装界面',
    accent: ORIGINAL_ACCENT,
    background: ORIGINAL_BACKGROUND,
    surface: ORIGINAL_SURFACE,
    firstRun: false,
    recovered,
    artPath: starsArt(options.officialsDir),
  }
}

/**
 * Resolve the launch art before Cordis starts.
 *
 * Missing state intentionally means the Stars IP, while persisted `null` means
 * the user explicitly chose the original appearance. A managed role workspace uses
 * its own appearance file and never falls back to the shared workspace by accident.
 */
export function resolveGalaSplashAppearance(
  options: ResolveGalaSplashAppearanceOptions,
): GalaSplashAppearance {
  const safeProfileName = basename(options.profileName) === options.profileName
    ? options.profileName
    : 'desktop'
  const galaDir = join(options.userDataDir, 'gala')
  const storePath = options.isolatedWorkspace
    ? join(galaDir, 'appearances', `${safeProfileName}.json`)
    : join(galaDir, 'skins.json')
  const stored = readStoredAppearance(storePath)
  if (stored.recovered) return originalAppearance(options, true)

  const active = stored.active
  if (active === null) return originalAppearance(options, false)

  const requested = active ?? skinIdForCharacter('gala:stars')
  const characterId = CHARACTER_BY_SKIN.get(requested)
  if (characterId !== undefined) {
    const official = SELECTABLE_GALAS.find(entry => entry.character.id === characterId)!
    const manifest = CHARACTER_SKINS.find(entry => entry.id === requested)!
    const firstRun = active === undefined
    return {
      kind: 'character',
      appearanceId: requested,
      name: official.character.name,
      message: firstRun
        ? '十位伙伴都到齐了，马上出发'
        : '正在恢复上次选择的角色',
      ...themeOf(manifest),
      firstRun,
      recovered: false,
      artPath: join(
        options.officialsDir,
        galaSlug(official.character.id),
        official.character.assets.avatar,
      ),
    }
  }

  const classic = BUILTIN_SKINS.find(manifest => manifest.id === requested)
  if (classic !== undefined) {
    return {
      kind: 'classic',
      appearanceId: requested,
      name: classic.name,
      message: '正在恢复上次选择的配色',
      ...themeOf(classic),
      firstRun: false,
      recovered: false,
      artPath: starsArt(options.officialsDir),
    }
  }

  const custom = installedCharacters(join(galaDir, 'market'))
    .find(entry => skinIdForCharacter(entry.character.id) === requested)
  if (custom !== undefined) {
    const manifest = fallbackSkinForCharacter(custom.character)
    return {
      kind: 'character',
      appearanceId: requested,
      name: custom.character.name,
      message: '正在恢复上次选择的角色',
      ...themeOf(manifest),
      firstRun: false,
      recovered: false,
      artPath: safeAvatarPath(custom.dir, custom.character) ?? starsArt(options.officialsDir),
    }
  }

  return originalAppearance(options, true)
}

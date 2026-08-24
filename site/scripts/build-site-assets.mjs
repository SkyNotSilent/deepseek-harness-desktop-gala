/**
 * Generate the download site's character thumbnails and data file from the
 * Gala workspace. Run after characters, skins, personas or artwork change,
 * then commit the output — GitHub Pages serves the directory as-is.
 *
 *   node site/scripts/build-site-assets.mjs
 *
 * Character copy, personas and palettes are imported straight from the
 * TypeScript registry (Node ≥ 22.18 strips types natively), so the site can
 * never drift from what the app ships.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const require = createRequire(join(repoRoot, 'dsh-plugin-desktop', 'package.json'))
const sharp = require('sharp')

const galaRoot = join(repoRoot, 'dsh-plugin-gala')
const officialsDir = join(galaRoot, 'assets', 'gala', 'officials')
const outDir = join(repoRoot, 'site', 'assets', 'characters')
const dataDir = join(repoRoot, 'site', 'data')

const PORTRAIT_SIZE = 320
const HERO_WIDTH = 1400
const EXPECTED_CHARACTERS = 11

async function importGala(relative) {
  return import(pathToFileURL(join(galaRoot, 'src', relative)).href)
}

/** Build the site's character records from the app's single source of truth. */
export async function loadOfficials() {
  const { SELECTABLE_GALAS } = await importGala('gala-officials.ts')
  const { CHARACTER_SKINS, skinIdForCharacter } = await importGala('gala-character-skins.ts')
  const { deriveDarkValue } = await importGala('gala-skin-map.ts')
  const skinsById = new Map(CHARACTER_SKINS.map(skin => [skin.id, skin]))

  const characters = SELECTABLE_GALAS.map(({ character, presentation }) => {
    const skin = skinsById.get(skinIdForCharacter(character.id))
    if (skin === undefined) throw new Error(`no skin palette for ${character.id}`)
    const token = name => {
      const value = skin.tokens[`--gala-color-${name}`]
      if (value === undefined) throw new Error(`${character.id}: missing --gala-color-${name}`)
      return value
    }
    const light = {
      primary: token('primary'),
      primaryHover: token('primary-hover'),
      bg: token('bg'),
      surface: token('surface'),
      bubble: token('bubble'),
      hover: token('hover'),
    }
    const persona = character.persona === undefined
      ? null
      : {
          archetype: character.persona.archetype,
          story: character.persona.story,
          voice: [...character.persona.voice],
          catchphrases: [...character.persona.catchphrases],
        }
    return {
      slug: character.id.replace(/^gala:/u, ''),
      name: character.name,
      family: character.family,
      rarity: character.rarity,
      description: character.description,
      onEquip: character.lines?.onEquip ?? '',
      headline: presentation.headline,
      tagline: presentation.tagline,
      themeName: skin.name,
      light,
      dark: {
        primary: deriveDarkValue(light.primary, 'brand'),
        primaryHover: deriveDarkValue(light.primaryHover, 'brand'),
        bg: deriveDarkValue(light.bg, 'surface'),
        surface: deriveDarkValue(light.surface, 'surface-raised'),
        bubble: deriveDarkValue(light.bubble, 'surface-raised'),
        hover: deriveDarkValue(light.hover, 'tint'),
      },
      persona,
    }
  })
  if (characters.length !== EXPECTED_CHARACTERS) {
    throw new Error(`expected GALA Stars plus 10 official characters, got ${characters.length}`)
  }
  const withPersona = characters.filter(character => character.persona !== null)
  if (withPersona.length !== EXPECTED_CHARACTERS - 1 || characters[0].persona !== null) {
    throw new Error('expected every official character except GALA Stars to carry a persona')
  }
  return characters
}

async function buildImages(characters) {
  await mkdir(outDir, { recursive: true })
  let total = 0
  for (const { slug } of characters) {
    const assets = join(officialsDir, slug, 'assets')
    const portraitOut = join(outDir, `${slug}-portrait.webp`)
    const heroOut = join(outDir, `${slug}-hero.webp`)
    await sharp(join(assets, 'portrait-v2.webp'))
      .resize({ width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, fit: 'cover', position: 'attention' })
      .webp({ quality: 80 })
      .toFile(portraitOut)
    await sharp(join(assets, 'hero-v2.webp'))
      .resize({ width: HERO_WIDTH })
      .webp({ quality: 78 })
      .toFile(heroOut)
    for (const file of [portraitOut, heroOut]) total += (await stat(file)).size
  }
  return total
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const characters = await loadOfficials()
  const bytes = await buildImages(characters)
  await mkdir(dataDir, { recursive: true })
  await writeFile(join(dataDir, 'characters.json'), `${JSON.stringify(characters, null, 2)}\n`)
  process.stdout.write(`${characters.length} characters, ${(bytes / 1024 / 1024).toFixed(2)} MB of images → site/assets/characters\n`)
}

/**
 * Generate the download site's character thumbnails and data file from the
 * Gala workspace. Run after characters, skins or artwork change, then commit
 * the output — GitHub Pages serves the directory as-is.
 *
 *   node site/scripts/build-site-assets.mjs
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const require = createRequire(join(repoRoot, 'dsh-plugin-desktop', 'package.json'))
const sharp = require('sharp')

const galaRoot = join(repoRoot, 'dsh-plugin-gala')
const officialsDir = join(galaRoot, 'assets', 'gala', 'officials')
const outDir = join(repoRoot, 'site', 'assets', 'characters')
const dataDir = join(repoRoot, 'site', 'data')

const PORTRAIT_SIZE = 320
const HERO_WIDTH = 1400

/** Extract object literals from the TypeScript sources without a TS toolchain. */
async function loadOfficials() {
  const source = await readFile(join(galaRoot, 'src', 'gala-officials.ts'), 'utf8')
  const skins = await readFile(join(galaRoot, 'src', 'gala-character-skins.ts'), 'utf8')
  const field = (block, key) => {
    const match = block.match(new RegExp(`${key}: '([^']+)'`, 'u'))
    if (match === null) throw new Error(`missing ${key} in character block`)
    return match[1]
  }
  const characters = source
    .split(/official\('[^']+', \{/u)
    .slice(1)
    .map((block) => {
      const id = field(block, 'id')
      return {
        slug: id.replace(/^gala:/u, ''),
        name: field(block, 'name'),
        family: field(block, 'family'),
        rarity: field(block, 'rarity'),
        description: field(block, 'description'),
        onEquip: field(block, 'onEquip'),
        headline: field(block, 'headline'),
        tagline: field(block, 'tagline'),
      }
    })
  if (characters.length !== 11) throw new Error(`expected the ensemble plus 10 official characters, parsed ${characters.length}`)

  const palettes = new Map()
  for (const block of skins.split(/'gala:(?=[a-z0-9-]+': \{)/u).slice(1)) {
    const slug = block.match(/^([a-z0-9-]+)/u)[1]
    const hex = key => field(block, key)
    palettes.set(slug, {
      themeName: field(block, 'themeName'),
      light: { primary: hex('primary'), primaryHover: hex('primaryHover'), bg: hex('bg'), surface: hex('surface'), bubble: hex('bubble'), hover: hex('hover') },
    })
  }
  for (const character of characters) {
    const palette = palettes.get(character.slug)
    if (palette === undefined) throw new Error(`no skin palette for ${character.slug}`)
    character.themeName = palette.themeName
    character.light = palette.light
    character.dark = {
      primary: deriveDark(palette.light.primary, 'brand'),
      primaryHover: deriveDark(palette.light.primaryHover, 'brand'),
      bg: deriveDark(palette.light.bg, 'surface'),
      surface: deriveDark(palette.light.surface, 'surface-raised'),
      bubble: deriveDark(palette.light.bubble, 'surface-raised'),
      hover: deriveDark(palette.light.hover, 'tint'),
    }
  }
  return characters
}

/** Mirror of gala-skin-map.ts `deriveDarkValue` so the site matches the app's dark palette. */
function deriveDark(hex, role) {
  const [h, s, l] = hexToHsl(hex)
  let hs = s
  let hl = l
  if (role === 'brand') hl = Math.min(0.72, l + 0.08)
  else if (role === 'surface') { hs = Math.min(0.30, s * 0.35); hl = 0.12 }
  else if (role === 'surface-raised') { hs = Math.min(0.32, s * 0.35); hl = 0.17 }
  else if (role === 'tint') { hs = Math.min(0.40, s * 0.50); hl = 0.24 }
  return hslToHex(h, hs, hl)
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToHex(h, s, l) {
  const hue = (p, q, t) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  let r = l
  let g = l
  let b = l
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue(p, q, h + 1 / 3)
    g = hue(p, q, h)
    b = hue(p, q, h - 1 / 3)
  }
  return `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
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

const characters = await loadOfficials()
const bytes = await buildImages(characters)
await mkdir(dataDir, { recursive: true })
await writeFile(join(dataDir, 'characters.json'), `${JSON.stringify(characters, null, 2)}\n`)
process.stdout.write(`${characters.length} characters, ${(bytes / 1024 / 1024).toFixed(2)} MB of images → site/assets/characters\n`)

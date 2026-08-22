/**
 * 造包 CLI — 把官方嘎啦与内置皮肤打成 `.ggal` 包（PRD §11.1）
 *
 * 产物落 dist/gala-packs/：官方角色包（含立绘资产）+ 内置皮肤包。
 * 打完立即用读侧 src/ggal-zip.ts 读回并校验（读写闭环），坏包直接失败。
 *
 * 用法：node scripts/build-gala-packs.ts [输出目录]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeGgal, type PackEntry } from '../src/ggal-pack.ts'
import { readGgalPackage } from '../src/ggal-zip.ts'
import { OFFICIAL_GALAS } from '../src/gala-officials.ts'
import { BUILTIN_SKINS } from '../src/gala-skins-builtin.ts'
import { galaSlug } from '../src/protocols/market-manifest.ts'
import type { GalaCharacter } from '../src/protocols/gala-json.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const officialsRoot = join(packageRoot, 'assets', 'gala', 'officials')
const outDir = process.argv[2] ?? join(packageRoot, 'dist', 'gala-packs')
mkdirSync(outDir, { recursive: true })

/** 递归收集目录下的文件为包条目 */
function collectEntries(root: string): PackEntry[] {
  if (!existsSync(root)) return []
  const entries: PackEntry[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const absolute = join(dir, name)
      if (statSync(absolute).isDirectory()) {
        walk(absolute)
        continue
      }
      entries.push({ path: relative(root, absolute).replaceAll('\\', '/'), data: readFileSync(absolute) })
    }
  }
  walk(root)
  return entries
}

function buildPack(character: GalaCharacter, extras: readonly PackEntry[]): string {
  const target = join(outDir, `${galaSlug(character.id)}.ggal`)
  writeGgal(target, { character, extras: [...extras] })
  const paths = readGgalPackage(target).map(entry => entry.path) // 读回校验
  if (!paths.includes('manifest.json') || !paths.includes('gala.json')) {
    throw new Error(`build-gala-packs: ${target} 读回校验失败`)
  }
  return target
}

let count = 0
for (const entry of OFFICIAL_GALAS) {
  const assetDir = join(officialsRoot, galaSlug(entry.character.id))
  const extras = collectEntries(assetDir)
  const target = buildPack(entry.character, extras)
  process.stdout.write(`build-gala-packs: ${target}（${String(extras.length)} 个资产）\n`)
  count += 1
}
for (const skin of BUILTIN_SKINS) {
  const target = buildPack(skin as unknown as GalaCharacter, [])
  process.stdout.write(`build-gala-packs: ${target}\n`)
  count += 1
}
process.stdout.write(`build-gala-packs: 完成，共 ${String(count)} 个包 → ${outDir}\n`)

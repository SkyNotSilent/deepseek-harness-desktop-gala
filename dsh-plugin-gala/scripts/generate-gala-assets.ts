/**
 * 生成官方嘎啦立绘 — assets/gala/officials/<slug>/assets/{idle,happy,confused}.png
 *
 * 缺省用程序化软萌 SVG 经 sharp 栅格化为 512px PNG（复用 generate-tray-icons
 * 的 SVG→sharp 模式）。配置了 GALA_ART_API_KEY 时改走生图 API（Agnes），
 * 失败自动回退 SVG。已存在的 PNG 跳过（幂等）；`--force` 全量重生成。
 *
 * 用法：node scripts/generate-gala-assets.ts [--force]
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createEnvArtworkProvider } from '../src/gala-artwork.ts'
import { AVATAR_CANVAS, renderGalaSvg, type GalaExpression } from '../src/gala-avatar.ts'
import { OFFICIAL_GALAS } from '../src/gala-officials.ts'
import { galaSlug } from '../src/protocols/market-manifest.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const officialsRoot = join(packageRoot, 'assets', 'gala', 'officials')
const force = process.argv.includes('--force')

/** gala.json 的 expressions 键 → 形象表情（confused 用 surprised 脸） */
const EXPRESSION_FILES: readonly { file: string; expression: GalaExpression }[] = [
  { file: 'idle.png', expression: 'idle' },
  { file: 'happy.png', expression: 'happy' },
  { file: 'confused.png', expression: 'surprised' },
]

const provider = createEnvArtworkProvider()

async function rasterize(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg, 'utf8'))
    .resize({ width: AVATAR_CANVAS, height: AVATAR_CANVAS, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

let generated = 0
let skipped = 0
let fromApi = 0

/** 单个 (角色, 表情) 任务 */
async function generateOne(entry: (typeof OFFICIAL_GALAS)[number], file: string, expression: GalaExpression): Promise<void> {
  const assetDir = join(officialsRoot, galaSlug(entry.character.id), 'assets')
  mkdirSync(assetDir, { recursive: true })
  const target = join(assetDir, file)
  if (!force && existsSync(target)) {
    skipped += 1
    return
  }
  const artwork = await provider.generate(entry.character, expression)
  const png = artwork.format === 'png'
    ? await sharp(artwork.data).resize({ width: AVATAR_CANVAS, height: AVATAR_CANVAS, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer()
    : await rasterize(artwork.data.toString('utf8'))
  writeFileSync(target, png)
  generated += 1
  if (artwork.source === 'api') fromApi += 1
  process.stdout.write(`gala-assets: ${entry.character.id}/${file} 就绪（${artwork.source}）\n`)
}

const queue = OFFICIAL_GALAS.flatMap(entry =>
  EXPRESSION_FILES.map(({ file, expression }) => ({ entry, file, expression })),
)
const CONCURRENCY = 2
for (let index = 0; index < queue.length; index += CONCURRENCY) {
  await Promise.all(
    queue.slice(index, index + CONCURRENCY).map(task => generateOne(task.entry, task.file, task.expression)),
  )
}

// 面板会为无立绘的角色回退 SVG data URL，这里再兜一层验证产物齐全
for (const entry of OFFICIAL_GALAS) {
  const idle = join(officialsRoot, galaSlug(entry.character.id), 'assets', 'idle.png')
  if (!existsSync(idle)) throw new Error(`gala-assets: 缺少 ${idle}`)
}

// 顺手确认 SVG 渲染器可覆盖全部官方角色（渲染抛错会在此暴露）
for (const entry of OFFICIAL_GALAS) renderGalaSvg(entry.character)

process.stdout.write(
  `gala-assets: 完成 — 生成 ${String(generated)} 张（API ${String(fromApi)} 张），跳过 ${String(skipped)} 张\n`,
)

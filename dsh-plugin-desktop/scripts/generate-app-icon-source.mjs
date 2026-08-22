/**
 * Produce the cross-platform source icon from the Gala artwork that ships with the app.
 *
 * The result is the 1024×1024 RGBA16 PNG with an sRGB profile that
 * `generate-mac-app-icon.mjs` expects as its input. Run it only when the icon
 * artwork changes; the build pipeline derives every platform variant from the
 * committed output.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const ARTWORK = join(packageRoot, '..', 'dsh-plugin-gala', 'assets', 'gala', 'officials', 'dsh-llm', 'assets', 'portrait-v2.webp')
const OUTPUT = join(packageRoot, 'build', 'app-icon.png')

const SIZE = 1024
/** macOS-style continuous corner radius (≈22.4% of the edge). */
const RADIUS = 230

/** Rounded-square coverage with a one-pixel anti-aliased edge. */
function roundedSquareAlpha(size, radius) {
  const alpha = Buffer.alloc(size * size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = x + 0.5
      const cy = y + 0.5
      const dx = Math.max(radius - cx, cx - (size - radius), 0)
      const dy = Math.max(radius - cy, cy - (size - radius), 0)
      const distance = Math.hypot(dx, dy) - radius
      const coverage = Math.min(1, Math.max(0, 0.5 - distance))
      alpha[y * size + x] = Math.round(coverage * 255)
    }
  }
  return alpha
}

const portrait = await sharp(ARTWORK)
  .resize({ width: SIZE, height: SIZE, fit: 'cover', position: 'attention', kernel: sharp.kernel.lanczos3 })
  .removeAlpha()
  .raw()
  .toBuffer()

await sharp(portrait, { raw: { width: SIZE, height: SIZE, channels: 3 } })
  .joinChannel(roundedSquareAlpha(SIZE, RADIUS), { raw: { width: SIZE, height: SIZE, channels: 1 } })
  .toColourspace('rgb16')
  .withIccProfile('srgb')
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT)

const meta = await sharp(OUTPUT).metadata()
process.stdout.write(`app-icon.png: ${meta.width}x${meta.height} ${meta.space} depth=${meta.depth} icc=${meta.icc !== undefined}\n`)

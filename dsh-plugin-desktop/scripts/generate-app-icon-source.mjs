/**
 * Produce the desktop and website icons from the shared Gala brand artwork.
 *
 * The result is the 1024×1024 RGBA8 PNG with an sRGB profile that
 * `generate-mac-app-icon.mjs` expects as its input. Run it only when the icon
 * artwork changes; the build pipeline derives every platform variant from the
 * committed output.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = join(packageRoot, '..')
const ARTWORK = join(repositoryRoot, 'assets', 'gala-whale-app-icon-master.png')
const OUTPUT = join(packageRoot, 'build', 'app-icon.png')
const SITE_ICON = join(repositoryRoot, 'site', 'assets', 'icon.png')
const SITE_FAVICON = join(repositoryRoot, 'site', 'assets', 'favicon-32.png')
const SITE_TOUCH_ICON = join(repositoryRoot, 'site', 'assets', 'apple-touch-icon.png')

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
  .toColourspace('srgb')
  .withIccProfile('srgb')
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT)

async function writeWebsiteIcon(size, output, flatten = false) {
  const resized = await sharp(ARTWORK)
    .resize({ width: size, height: size, fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer()

  let icon = sharp(resized, { raw: { width: size, height: size, channels: 3 } })
    .joinChannel(roundedSquareAlpha(size, Math.round(size * RADIUS / SIZE)), {
      raw: { width: size, height: size, channels: 1 },
    })

  if (flatten) icon = icon.flatten({ background: '#241447' })
  await icon.toColourspace('srgb').png({ compressionLevel: 9 }).toFile(output)
}

await writeWebsiteIcon(256, SITE_ICON)
await writeWebsiteIcon(32, SITE_FAVICON)
await writeWebsiteIcon(180, SITE_TOUCH_ICON, true)

const meta = await sharp(OUTPUT).metadata()
process.stdout.write(`brand icons: app=${meta.width}x${meta.height}, site=256x256, favicon=32x32, touch=180x180\n`)

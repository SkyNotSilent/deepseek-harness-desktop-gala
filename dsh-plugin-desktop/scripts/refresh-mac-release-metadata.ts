/** Rebuild macOS updater metadata after stapling changes the final DMG bytes. */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBlockMap } from 'app-builder-lib/out/targets/blockmap/blockmap.js'
import { parse, stringify } from 'yaml'

interface ArtifactUpdateInfo {
  readonly sha512: string
  readonly size: number
}

interface UpdateFile {
  readonly url?: unknown
  sha512?: unknown
  size?: unknown
}

interface UpdateManifest {
  files?: unknown
  path?: unknown
  sha512?: unknown
}

/** Injectable boundaries for focused release-metadata tests. */
export interface RefreshMacReleaseMetadataOptions {
  readonly distDir: string
  readonly version: string
  readonly arch: 'arm64'
  readonly readText: (path: string) => string
  readonly writeText: (path: string, contents: string) => void
  readonly rebuildBlockMap: (artifactPath: string, blockMapPath: string) => Promise<ArtifactUpdateInfo>
}

function defaultOptions(): RefreshMacReleaseMetadataOptions {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }
  return {
    distDir: join(packageRoot, 'dist'),
    version: manifest.version,
    arch: 'arm64',
    readText: path => readFileSync(path, 'utf8'),
    writeText: (path, contents) => writeFileSync(path, contents, 'utf8'),
    rebuildBlockMap: async (artifactPath, blockMapPath) => {
      const info = await buildBlockMap(artifactPath, 'gzip', blockMapPath)
      if (typeof info.sha512 !== 'string' || typeof info.size !== 'number') {
        throw new Error(`blockmap builder returned incomplete update metadata for ${artifactPath}`)
      }
      return { sha512: info.sha512, size: info.size }
    },
  }
}

/** Refresh the DMG/ZIP blockmaps and latest-mac.yml from the final artifact bytes. */
export async function refreshMacReleaseMetadata(
  options: RefreshMacReleaseMetadataOptions = defaultOptions(),
): Promise<void> {
  const prefix = `DeepSeek-Harness-Desktop-Gala-${options.version}-${options.arch}`
  const manifestPath = join(options.distDir, 'latest-mac.yml')
  const artifactPaths = [join(options.distDir, `${prefix}.zip`), join(options.distDir, `${prefix}.dmg`)]
  const document = parse(options.readText(manifestPath)) as UpdateManifest
  if (!Array.isArray(document.files)) throw new Error('latest-mac.yml files must be an array')
  const files = document.files as UpdateFile[]

  for (const artifactPath of artifactPaths) {
    const name = artifactPath.slice(options.distDir.length + 1)
    const entry = files.find(candidate => candidate.url === name)
    if (entry === undefined) throw new Error(`latest-mac.yml is missing ${name}`)
    const updateInfo = await options.rebuildBlockMap(artifactPath, `${artifactPath}.blockmap`)
    entry.sha512 = updateInfo.sha512
    entry.size = updateInfo.size
    if (name.endsWith('.zip')) {
      document.path = name
      document.sha512 = updateInfo.sha512
    }
  }

  options.writeText(manifestPath, stringify(document, { lineWidth: 0 }))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    await refreshMacReleaseMetadata()
    console.log('macOS release blockmaps and latest-mac.yml refreshed from final artifact bytes')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

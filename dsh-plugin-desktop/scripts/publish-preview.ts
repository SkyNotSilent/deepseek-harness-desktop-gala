/** Upload a verified local macOS release into a draft preview and publish only after re-download. */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = 'SkyNotSilent/deepseek-harness-desktop-gala'

/** Output captured from one command. */
export interface PublishCommandResult {
  readonly stdout: string
  readonly stderr: string
}

/** Injectable release service and filesystem boundary. */
export interface PublishPreviewOptions {
  readonly desktopRoot: string
  readonly version: string
  readonly teamId: string
  readonly platform: NodeJS.Platform
  readonly run: (command: string, args: readonly string[], cwd: string) => PublishCommandResult
  readonly makeTemporaryDirectory: () => string
  readonly removeTemporaryDirectory: (path: string) => void
  readonly listFiles: (path: string) => readonly string[]
  readonly read: (path: string) => Buffer
  readonly write: (path: string, value: string) => void
  readonly size: (path: string) => number
  readonly verifyMac: (distDir: string, teamId: string) => void
  readonly log: (message: string) => void
}

function run(command: string, args: readonly string[], cwd: string): PublishCommandResult {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function defaultOptions(): PublishPreviewOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }
  return {
    desktopRoot,
    version: manifest.version,
    teamId: process.env.DSH_MAC_RELEASE_TEAM_ID?.trim() ?? '',
    platform: process.platform,
    run,
    makeTemporaryDirectory: () => mkdtempSync(join(tmpdir(), 'dsh-preview-assets-')),
    removeTemporaryDirectory: path => rmSync(path, { force: true, recursive: true }),
    listFiles: path => readdirSync(path)
      .map(name => join(path, name))
      .filter(filename => statSync(filename).isFile()),
    read: readFileSync,
    write: (path, value) => writeFileSync(path, value, { encoding: 'utf8', mode: 0o600 }),
    size: path => statSync(path).size,
    verifyMac: (distDir, teamId) => {
      const result = spawnSync(process.execPath, ['scripts/verify-mac-release.ts'], {
        cwd: desktopRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DSH_MAC_RELEASE_DIST_DIR: distDir,
          DSH_MAC_RELEASE_TEAM_ID: teamId,
        },
      })
      if (result.error !== undefined) throw result.error
      if (result.status !== 0) throw new Error(`downloaded macOS verification failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    },
    log: message => console.log(message),
  }
}

/** Exact public assets for one Apple Silicon/Windows x64 preview release. */
export function previewAssetNames(version: string): readonly string[] {
  const mac = `DeepSeek-Harness-Desktop-Gala-${version}-arm64`
  return [
    `${mac}.dmg`,
    `${mac}.dmg.blockmap`,
    `${mac}.zip`,
    `${mac}.zip.blockmap`,
    `DeepSeek-Harness-Desktop-Gala-${version}-x64-Setup.exe`,
    'latest-mac.yml',
  ]
}

function assertExactAssets(
  directory: string,
  expectedNames: readonly string[],
  options: Pick<PublishPreviewOptions, 'listFiles' | 'size'>,
): string[] {
  const paths = [...options.listFiles(directory)]
  const names = paths.map(path => basename(path)).sort()
  const expected = [...expectedNames].sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`release asset whitelist mismatch: expected ${expected.join(', ')}; received ${names.join(', ')}`)
  }
  for (const path of paths) {
    if (options.size(path) <= 0) throw new Error(`release asset is empty: ${basename(path)}`)
  }
  return paths
}

function checksum(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

function checksumManifest(paths: readonly string[], read: (path: string) => Buffer): string {
  return [...paths]
    .sort((left, right) => basename(left).localeCompare(basename(right), 'en'))
    .map(path => `${checksum(read(path))}  ${basename(path)}`)
    .join('\n') + '\n'
}

function verifyChecksumManifest(
  directory: string,
  assetNames: readonly string[],
  read: (path: string) => Buffer,
): void {
  const expected = checksumManifest(assetNames.map(name => join(directory, name)), read)
  const actual = read(join(directory, 'SHA256SUMS.txt')).toString('utf8')
  if (actual !== expected) throw new Error('SHA256SUMS.txt does not match the downloaded release assets')
}

/** Publish a prerelease only after the draft assets survive a fresh download and full verification. */
export function publishPreview(options: PublishPreviewOptions = defaultOptions()): void {
  if (options.platform !== 'darwin') throw new Error('signed preview publishing must run on macOS')
  if (!/^2\.1\.0-preview\.\d+$/u.test(options.version)) throw new Error(`unsupported preview version: ${options.version}`)
  if (!/^[A-Z0-9]{10}$/u.test(options.teamId)) throw new Error('a 10-character DSH_MAC_RELEASE_TEAM_ID is required')
  const tag = `v${options.version}`
  const release = JSON.parse(options.run(
    'gh',
    ['release', 'view', tag, '--repo', REPOSITORY, '--json', 'tagName,isDraft,isPrerelease'],
    options.desktopRoot,
  ).stdout) as { tagName?: unknown; isDraft?: unknown; isPrerelease?: unknown }
  if (release.tagName !== tag || release.isDraft !== true || release.isPrerelease !== true) {
    throw new Error(`${tag} must exist as a draft prerelease before signed assets are uploaded`)
  }

  const expectedAssets = previewAssetNames(options.version)
  const localMacNames = expectedAssets.filter(name => name.endsWith('.dmg') || name.endsWith('.zip') || name.endsWith('.blockmap') || name === 'latest-mac.yml')
  assertExactAssets(
    join(options.desktopRoot, 'dist'),
    localMacNames,
    {
      listFiles: directory => options.listFiles(directory).filter(path => localMacNames.includes(basename(path))),
      size: options.size,
    },
  )
  options.verifyMac(join(options.desktopRoot, 'dist'), options.teamId)
  options.run('gh', [
    'release', 'upload', tag,
    ...localMacNames.map(name => join(options.desktopRoot, 'dist', name)),
    '--repo', REPOSITORY,
    '--clobber',
  ], options.desktopRoot)

  const firstDownload = options.makeTemporaryDirectory()
  const finalDownload = options.makeTemporaryDirectory()
  try {
    options.run('gh', ['release', 'download', tag, '--repo', REPOSITORY, '--dir', firstDownload], options.desktopRoot)
    const downloaded = assertExactAssets(firstDownload, expectedAssets, options)
    const checksums = checksumManifest(downloaded, options.read)
    const checksumPath = join(firstDownload, 'SHA256SUMS.txt')
    options.write(checksumPath, checksums)
    options.run('gh', ['release', 'upload', tag, checksumPath, '--repo', REPOSITORY, '--clobber'], options.desktopRoot)

    options.run('gh', ['release', 'download', tag, '--repo', REPOSITORY, '--dir', finalDownload], options.desktopRoot)
    assertExactAssets(finalDownload, [...expectedAssets, 'SHA256SUMS.txt'], options)
    verifyChecksumManifest(finalDownload, expectedAssets, options.read)
    options.verifyMac(finalDownload, options.teamId)
    options.run('gh', [
      'release', 'edit', tag,
      '--repo', REPOSITORY,
      '--draft=false',
      '--prerelease=true',
    ], options.desktopRoot)
    options.log(`published verified prerelease ${tag}`)
  } finally {
    options.removeTemporaryDirectory(firstDownload)
    options.removeTemporaryDirectory(finalDownload)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    publishPreview()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

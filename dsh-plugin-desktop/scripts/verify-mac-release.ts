/** Verify signed/notarized macOS DMG and ZIP artifacts plus updater metadata. */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { verifyMacSmoke } from './verify-mac-smoke.ts'

/** Captured output from one successful verification command. */
export interface VerificationCommandResult {
  readonly stdout: string
  readonly stderr: string
}

/** Injectable filesystem and command boundaries for release verification. */
export interface MacReleaseVerificationOptions {
  readonly distDir: string
  readonly productName: string
  readonly version: string
  readonly bundleId: string
  readonly teamId: string
  readonly arch: 'arm64'
  readonly listFiles: (distDir: string) => readonly string[]
  readonly makeTemporaryDirectory: (prefix: string) => string
  readonly run: (command: string, args: readonly string[]) => VerificationCommandResult
  readonly removeTemporaryDirectory: (path: string) => void
  readonly verifySmoke: (appPath: string) => void
  readonly read: (path: string) => Buffer
  readonly size: (path: string) => number
}

interface UpdateFile {
  readonly url?: unknown
  readonly sha512?: unknown
  readonly size?: unknown
}

interface UpdateManifest {
  readonly version?: unknown
  readonly path?: unknown
  readonly sha512?: unknown
  readonly files?: unknown
}

function listFiles(distDir: string): readonly string[] {
  return readdirSync(distDir)
    .map(name => join(distDir, name))
    .filter(path => statSync(path).isFile())
}

function run(command: string, args: readonly string[]): VerificationCommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${String(result.status)}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    )
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function defaultOptions(): MacReleaseVerificationOptions {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string; build: { appId: string } }
  const identity = process.env.DSH_MAC_RELEASE_TEAM_ID?.trim()
  if (identity === undefined || identity.length === 0) {
    throw new Error('DSH_MAC_RELEASE_TEAM_ID is required for strict macOS release verification')
  }
  return {
    distDir: process.env.DSH_MAC_RELEASE_DIST_DIR?.trim() || join(packageRoot, 'dist'),
    productName: 'DeepSeek Harness Desktop Gala',
    version: manifest.version,
    bundleId: manifest.build.appId,
    teamId: identity,
    arch: 'arm64',
    listFiles,
    makeTemporaryDirectory: prefix => mkdtempSync(join(tmpdir(), prefix)),
    run,
    removeTemporaryDirectory: path => rmSync(path, { force: true, recursive: true }),
    verifySmoke: verifyMacSmoke,
    read: readFileSync,
    size: path => statSync(path).size,
  }
}

function requireUniqueArtifact(
  files: readonly string[],
  suffix: string,
  description: string,
): string {
  const matches = files.filter(path => basename(path).endsWith(suffix))
  if (matches.length !== 1) {
    throw new Error(`macOS release verification requires exactly one ${description}; found ${String(matches.length)}`)
  }
  return matches[0]!
}

function digest(buffer: Buffer, algorithm: 'sha256' | 'sha512', encoding: 'hex' | 'base64'): string {
  return createHash(algorithm).update(buffer).digest(encoding)
}

function verifyUpdaterMetadata(
  options: MacReleaseVerificationOptions,
  files: readonly string[],
  dmgPath: string,
  zipPath: string,
): void {
  const updatePath = requireUniqueArtifact(files, 'latest-mac.yml', 'latest-mac.yml')
  const document = parse(options.read(updatePath).toString('utf8')) as UpdateManifest
  if (document.version !== options.version) {
    throw new Error(`latest-mac.yml version mismatch: expected ${options.version}, received ${String(document.version)}`)
  }
  if (!Array.isArray(document.files)) throw new Error('latest-mac.yml files must be an array')
  const updateFiles = document.files as UpdateFile[]
  for (const artifactPath of [zipPath, dmgPath]) {
    const name = basename(artifactPath)
    const metadata = updateFiles.find(entry => entry.url === name)
    if (metadata === undefined) throw new Error(`latest-mac.yml is missing ${name}`)
    const contents = options.read(artifactPath)
    const expectedSize = options.size(artifactPath)
    const expectedSha512 = digest(contents, 'sha512', 'base64')
    if (metadata.size !== expectedSize) throw new Error(`latest-mac.yml size mismatch for ${name}`)
    if (metadata.sha512 !== expectedSha512) throw new Error(`latest-mac.yml SHA-512 mismatch for ${name}`)
    const blockmap = `${artifactPath}.blockmap`
    if (!files.includes(blockmap) || options.size(blockmap) <= 0) {
      throw new Error(`macOS release is missing a non-empty blockmap for ${name}`)
    }
  }
  if (document.path !== basename(zipPath)) throw new Error('latest-mac.yml primary path must select the ZIP')
  if (document.sha512 !== digest(options.read(zipPath), 'sha512', 'base64')) {
    throw new Error('latest-mac.yml primary SHA-512 does not match the ZIP')
  }
}

function commandOutput(result: VerificationCommandResult): string {
  return `${result.stdout}\n${result.stderr}`
}

function attachedDiskDevice(result: VerificationCommandResult): string | undefined {
  return /^(\/dev\/disk\d+)(?:s\d+)?\b/mu.exec(commandOutput(result))?.[1]
}

function assertGatekeeperEnabled(options: MacReleaseVerificationOptions): void {
  let output: string
  try {
    output = commandOutput(options.run('spctl', ['--status']))
  } catch {
    throw new Error('Gatekeeper assessments must be enabled before macOS release verification')
  }
  if (!/^assessments enabled$/imu.test(output.trim())) {
    throw new Error('Gatekeeper assessments must be enabled before macOS release verification')
  }
}

function verifyGatekeeper(
  options: MacReleaseVerificationOptions,
  args: readonly string[],
  description: string,
): void {
  const output = commandOutput(options.run('spctl', args))
  if (!/^source=Notarized Developer ID$/imu.test(output)) {
    throw new Error(`${description} was not accepted as a Notarized Developer ID artifact`)
  }
}

function verifyApp(appPath: string, options: MacReleaseVerificationOptions): void {
  options.run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
  const signature = commandOutput(options.run('codesign', ['--display', '--verbose=4', appPath]))
  if (!signature.includes(`Identifier=${options.bundleId}`)) {
    throw new Error(`macOS application bundle ID is not ${options.bundleId}`)
  }
  if (!signature.includes(`TeamIdentifier=${options.teamId}`)) {
    throw new Error(`macOS application Team ID is not ${options.teamId}`)
  }
  if (!/flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/iu.test(signature)) {
    throw new Error('macOS application is not signed with Hardened Runtime')
  }
  const executable = join(appPath, 'Contents', 'MacOS', options.productName)
  const architectures = options.run('lipo', ['-archs', executable]).stdout.trim().split(/\s+/u).filter(Boolean)
  if (architectures.length !== 1 || architectures[0] !== options.arch) {
    throw new Error(`macOS application architecture mismatch: ${architectures.join(' ')}`)
  }
  options.run('syspolicy_check', ['distribution', appPath])
  verifyGatekeeper(
    options,
    ['--assess', '--type', 'execute', '--verbose=4', appPath],
    'macOS application',
  )
  options.run('xcrun', ['stapler', 'validate', appPath])
  options.verifySmoke(appPath)
}

/** Verify signed DMG and ZIP applications, metadata, quarantine handling, and PTY startup. */
export function verifyMacRelease(
  options: MacReleaseVerificationOptions = defaultOptions(),
): { readonly dmgPath: string; readonly zipPath: string } {
  assertGatekeeperEnabled(options)
  const files = options.listFiles(options.distDir)
  const prefix = `DeepSeek-Harness-Desktop-Gala-${options.version}-${options.arch}`
  const dmgPath = requireUniqueArtifact(files, `${prefix}.dmg`, 'versioned arm64 DMG')
  const zipPath = requireUniqueArtifact(files, `${prefix}.zip`, 'versioned arm64 ZIP')
  verifyUpdaterMetadata(options, files, dmgPath, zipPath)

  const mountPoint = options.makeTemporaryDirectory('dsh-desktop-dmg-')
  const zipDirectory = options.makeTemporaryDirectory('dsh-desktop-zip-')
  const quarantineDirectory = options.makeTemporaryDirectory('dsh-desktop-quarantine-')
  let mounted = false
  let mountedDevice: string | undefined
  let failure: unknown
  try {
    options.run('hdiutil', ['verify', dmgPath])
    options.run('codesign', ['--verify', '--strict', '--verbose=4', dmgPath])
    options.run('xcrun', ['stapler', 'validate', dmgPath])
    verifyGatekeeper(
      options,
      ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath],
      'macOS disk image',
    )
    const attachResult = options.run('hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-readonly'])
    mountedDevice = attachedDiskDevice(attachResult)
    mounted = true
    verifyApp(join(mountPoint, `${options.productName}.app`), options)

    options.run('ditto', ['-x', '-k', zipPath, zipDirectory])
    const zipApp = join(zipDirectory, `${options.productName}.app`)
    verifyApp(zipApp, options)

    const quarantinedApp = join(quarantineDirectory, `${options.productName}.app`)
    options.run('ditto', [zipApp, quarantinedApp])
    options.run('xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Codex;Preview3', quarantinedApp])
    verifyApp(quarantinedApp, options)
  } catch (cause) {
    failure = cause
  }

  const cleanupFailures: unknown[] = []
  if (mounted) {
    try {
      options.run('hdiutil', ['detach', mountPoint])
    } catch (cause) {
      if (mountedDevice === undefined) {
        cleanupFailures.push(cause)
      } else {
        const fallbackFailures: unknown[] = []
        try {
          options.run('diskutil', ['unmount', mountPoint])
        } catch (fallbackCause) {
          fallbackFailures.push(fallbackCause)
        }
        try {
          options.run('hdiutil', ['detach', mountedDevice])
        } catch (fallbackCause) {
          fallbackFailures.push(fallbackCause)
        }
        if (fallbackFailures.length > 0) cleanupFailures.push(cause, ...fallbackFailures)
      }
    }
  }
  for (const directory of [mountPoint, zipDirectory, quarantineDirectory]) {
    try {
      options.removeTemporaryDirectory(directory)
    } catch (cause) {
      cleanupFailures.push(cause)
    }
  }
  if (failure !== undefined || cleanupFailures.length > 0) {
    const failures = failure === undefined ? cleanupFailures : [failure, ...cleanupFailures]
    throw new AggregateError(failures, `failed to verify macOS release ${basename(dmgPath)} and ${basename(zipPath)}`)
  }
  return { dmgPath, zipPath }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = verifyMacRelease()
    console.log(`macOS release verification passed: ${verified.dmgPath}; ${verified.zipPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

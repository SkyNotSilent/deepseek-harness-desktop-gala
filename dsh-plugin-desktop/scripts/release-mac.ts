/** Build signed and notarized macOS DMG/ZIP artifacts from validated release credentials. */

import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adaptMacReleaseEnvironment,
  assertMacReleaseReady,
  withoutMacReleaseSecrets,
} from './release-preflight.ts'

/** Injectable release boundary used by focused tests. */
export interface MacReleaseOptions {
  /** Environment containing the selected signing and notarization credentials. */
  readonly env: NodeJS.ProcessEnv
  /** Platform executing the release. */
  readonly platform: NodeJS.Platform
  /** Desktop package root containing package.json. */
  readonly desktopRoot: string
  /** Read code-signing identities with a credential-free environment. */
  readonly listCodeSigningIdentities: (env: NodeJS.ProcessEnv) => string
  /** Execute one release command. */
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
  /** Execute a credential setup command with secret text on standard input, never in argv. */
  readonly runWithInput: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    input: string,
  ) => void
  /** Create an isolated temporary directory for a release-only Keychain. */
  readonly makeTemporaryDirectory: (prefix: string) => string
  /** Remove a release-only temporary directory. */
  readonly removeTemporaryDirectory: (path: string) => void
  /** Generate a non-user credential used only to lock the temporary Keychain file. */
  readonly makeTemporaryKeychainPassword: () => string
  /** Resolve the final DMG that must receive its own notarization ticket. */
  readonly findDmgArtifact: (desktopRoot: string) => string
  /** Report non-secret release progress. */
  readonly log: (message: string) => void
}

function listCodeSigningIdentities(env: NodeJS.ProcessEnv): string {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
    env,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`security find-identity exited with ${String(result.status)}`)
  }
  return result.stdout
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function runWithInput(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input: string,
): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function findDmgArtifact(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }
  return join(
    desktopRoot,
    'dist',
    `DeepSeek-Harness-Desktop-Gala-${manifest.version}-arm64.dmg`,
  )
}

function requiredEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${name} while preparing the DMG notarization command`)
  }
  return value
}

function dmgNotarizationArguments(
  dmgPath: string,
  source: 'api-key' | 'apple-id' | 'keychain-profile',
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const credentials = source === 'keychain-profile'
    ? [
        '--keychain-profile', requiredEnvironmentValue(env, 'APPLE_KEYCHAIN_PROFILE'),
        ...(env.APPLE_KEYCHAIN?.trim() ? ['--keychain', env.APPLE_KEYCHAIN.trim()] : []),
      ]
    : source === 'apple-id'
      ? (() => { throw new Error('Apple ID credentials must be staged through a temporary Keychain profile') })()
      : [
          '--key', requiredEnvironmentValue(env, 'APPLE_API_KEY'),
          '--key-id', requiredEnvironmentValue(env, 'APPLE_API_KEY_ID'),
          '--issuer', requiredEnvironmentValue(env, 'APPLE_API_ISSUER'),
        ]
  return ['notarytool', 'submit', dmgPath, ...credentials, '--wait', '--timeout', '30m']
}

interface TemporaryNotarizationKeychain {
  readonly directory: string
  readonly path: string
  readonly profile: string
}

function keychainNotarizationEnvironment(
  env: NodeJS.ProcessEnv,
  keychain: TemporaryNotarizationKeychain,
): NodeJS.ProcessEnv {
  const staged = { ...env }
  delete staged.APPLE_ID
  delete staged.APPLE_APP_SPECIFIC_PASSWORD
  delete staged.APPLE_TEAM_ID
  staged.APPLE_KEYCHAIN = keychain.path
  staged.APPLE_KEYCHAIN_PROFILE = keychain.profile
  return staged
}

function defaultReleaseOptions(): MacReleaseOptions {
  return {
    env: process.env,
    platform: process.platform,
    desktopRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    listCodeSigningIdentities,
    run,
    runWithInput,
    makeTemporaryDirectory: prefix => mkdtempSync(join(tmpdir(), prefix)),
    removeTemporaryDirectory: path => rmSync(path, { force: true, recursive: true }),
    makeTemporaryKeychainPassword: () => randomBytes(32).toString('base64url'),
    findDmgArtifact,
    log: message => console.log(message),
  }
}

/**
 * Build the macOS artifacts while exposing release secrets only to the signing/notarization steps.
 * @param options - Injectable process and command boundaries.
 */
export function releaseMac(options: MacReleaseOptions = defaultReleaseOptions()): void {
  const releaseEnvironment = adaptMacReleaseEnvironment(options.env)
  const buildEnvironment = withoutMacReleaseSecrets(releaseEnvironment)
  const result = assertMacReleaseReady({
    env: releaseEnvironment,
    platform: options.platform,
    listCodeSigningIdentities: () => options.listCodeSigningIdentities(buildEnvironment),
  })
  options.log(
    `macOS release preflight passed: ${result.identity}; signing via ${result.signing}; notarization via ${result.notarization}`,
  )
  const teamId = /\(([A-Z0-9]{10})\)$/u.exec(result.identity)?.[1]
  if (teamId === undefined) {
    throw new Error(`macOS release identity does not contain a 10-character Team ID: ${result.identity}`)
  }

  // The workspace check includes the package build and repository-layout gate. Signing
  // material is withheld from every build, test, Loader smoke, and layout subprocess.
  // Refuse before an expensive build when this release host cannot perform a real
  // Gatekeeper assessment. The artifact verifier also validates the exact source line.
  options.run('spctl', ['--status'], options.desktopRoot, buildEnvironment)
  options.run('yarn', ['run', 'check'], resolve(options.desktopRoot, '..'), buildEnvironment)
  let notarizationEnvironment = releaseEnvironment
  let notarizationSource = result.notarization
  let temporaryKeychain: TemporaryNotarizationKeychain | undefined
  let keychainCreated = false
  let failure: unknown
  try {
    if (result.notarization === 'apple-id') {
      const directory = options.makeTemporaryDirectory('dsh-notary-keychain-')
      temporaryKeychain = {
        directory,
        path: join(directory, 'notary.keychain-db'),
        profile: 'dsh-release',
      }
      const keychainPassword = options.makeTemporaryKeychainPassword()
      options.run(
        'security',
        ['create-keychain', '-p', keychainPassword, temporaryKeychain.path],
        options.desktopRoot,
        buildEnvironment,
      )
      keychainCreated = true
      options.run(
        'security',
        ['unlock-keychain', '-p', keychainPassword, temporaryKeychain.path],
        options.desktopRoot,
        buildEnvironment,
      )
      options.runWithInput(
        'xcrun',
        [
          'notarytool', 'store-credentials', temporaryKeychain.profile,
          '--apple-id', requiredEnvironmentValue(releaseEnvironment, 'APPLE_ID'),
          '--team-id', requiredEnvironmentValue(releaseEnvironment, 'APPLE_TEAM_ID'),
          '--keychain', temporaryKeychain.path,
          '--no-validate',
        ],
        options.desktopRoot,
        buildEnvironment,
        `${requiredEnvironmentValue(releaseEnvironment, 'APPLE_APP_SPECIFIC_PASSWORD')}\n`,
      )
      notarizationEnvironment = keychainNotarizationEnvironment(releaseEnvironment, temporaryKeychain)
      notarizationSource = 'keychain-profile'
    }

    options.run('yarn', [
      'exec', 'electron-builder', '--mac', 'dmg', 'zip', '--arm64',
      '--config.forceCodeSigning=true', '--config.mac.hardenedRuntime=true',
      '--config.mac.notarize=true', '--config.dmg.sign=true',
      '--config.extraMetadata.desktopUpdateMode=signed-auto',
    ], options.desktopRoot, notarizationEnvironment)
    const dmgPath = options.findDmgArtifact(options.desktopRoot)
    options.run(
      'xcrun',
      dmgNotarizationArguments(dmgPath, notarizationSource, notarizationEnvironment),
      options.desktopRoot,
      notarizationEnvironment,
    )
    options.run('xcrun', ['stapler', 'staple', dmgPath], options.desktopRoot, buildEnvironment)
    options.run(
      process.execPath,
      ['scripts/refresh-mac-release-metadata.ts'],
      options.desktopRoot,
      buildEnvironment,
    )
    options.run(process.execPath, ['scripts/verify-mac-release.ts'], options.desktopRoot, {
      ...buildEnvironment,
      DSH_MAC_RELEASE_TEAM_ID: teamId,
    })
  } catch (cause) {
    failure = cause
  }

  const cleanupFailures: unknown[] = []
  if (temporaryKeychain !== undefined) {
    if (keychainCreated) {
      try {
        options.run(
          'security',
          ['delete-keychain', temporaryKeychain.path],
          options.desktopRoot,
          buildEnvironment,
        )
      } catch (cause) {
        cleanupFailures.push(cause)
      }
    }
    try {
      options.removeTemporaryDirectory(temporaryKeychain.directory)
    } catch (cause) {
      cleanupFailures.push(cause)
    }
  }
  if (failure !== undefined || cleanupFailures.length > 0) {
    const failures = failure === undefined ? cleanupFailures : [failure, ...cleanupFailures]
    throw new AggregateError(failures, 'macOS release build or credential cleanup failed')
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    releaseMac()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

/** Build signed and notarized macOS DMG/ZIP artifacts from validated release credentials. */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
      ? [
          '--apple-id', requiredEnvironmentValue(env, 'APPLE_ID'),
          '--password', requiredEnvironmentValue(env, 'APPLE_APP_SPECIFIC_PASSWORD'),
          '--team-id', requiredEnvironmentValue(env, 'APPLE_TEAM_ID'),
        ]
      : [
          '--key', requiredEnvironmentValue(env, 'APPLE_API_KEY'),
          '--key-id', requiredEnvironmentValue(env, 'APPLE_API_KEY_ID'),
          '--issuer', requiredEnvironmentValue(env, 'APPLE_API_ISSUER'),
        ]
  return ['notarytool', 'submit', dmgPath, ...credentials, '--wait']
}

function defaultReleaseOptions(): MacReleaseOptions {
  return {
    env: process.env,
    platform: process.platform,
    desktopRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    listCodeSigningIdentities,
    run,
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
  options.run('yarn', ['run', 'check'], resolve(options.desktopRoot, '..'), buildEnvironment)
  options.run('yarn', [
    'exec', 'electron-builder', '--mac', 'dmg', 'zip', '--arm64',
    '--config.forceCodeSigning=true', '--config.mac.hardenedRuntime=true',
    '--config.mac.notarize=true', '--config.extraMetadata.desktopUpdateMode=signed-auto',
  ], options.desktopRoot, releaseEnvironment)
  const dmgPath = options.findDmgArtifact(options.desktopRoot)
  options.run(
    'xcrun',
    dmgNotarizationArguments(dmgPath, result.notarization, releaseEnvironment),
    options.desktopRoot,
    releaseEnvironment,
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

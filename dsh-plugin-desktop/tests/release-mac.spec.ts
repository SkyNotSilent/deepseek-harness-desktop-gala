import { describe, expect, it } from 'vitest'
import { releaseMac, type MacReleaseOptions } from '../scripts/release-mac.ts'

const DEVELOPER_ID_OUTPUT = `
  1) 0123456789ABCDEF "Developer ID Application: Example Developer (TEAM123456)"
     1 valid identities found
`

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

interface InputCommandCall extends CommandCall {
  readonly input: string
}

function baseOptions(
  env: NodeJS.ProcessEnv,
  calls: CommandCall[],
  identityEnvironments: NodeJS.ProcessEnv[] = [],
  logs: string[] = [],
  inputCalls: InputCommandCall[] = [],
  removedDirectories: string[] = [],
): MacReleaseOptions {
  return {
    env,
    platform: 'darwin',
    desktopRoot: '/repo/dsh-plugin-desktop',
    listCodeSigningIdentities: identityEnv => {
      identityEnvironments.push({ ...identityEnv })
      return DEVELOPER_ID_OUTPUT
    },
    run: (command, args, cwd, commandEnv) => {
      calls.push({ command, args: [...args], cwd, env: { ...commandEnv } })
    },
    runWithInput: (command, args, cwd, commandEnv, input) => {
      inputCalls.push({ command, args: [...args], cwd, env: { ...commandEnv }, input })
    },
    makeTemporaryDirectory: () => '/private/tmp/dsh-notary-keychain-0',
    removeTemporaryDirectory: path => { removedDirectories.push(path) },
    makeTemporaryKeychainPassword: () => 'temporary-keychain-password',
    findDmgArtifact: () => '/repo/dsh-plugin-desktop/dist/release.dmg',
    log: message => logs.push(message),
  }
}

describe('macOS release command boundary', () => {
  it('stages an Apple ID password through a temporary Keychain instead of argv', () => {
    const calls: CommandCall[] = []
    const identityEnvironments: NodeJS.ProcessEnv[] = []
    const logs: string[] = []
    const inputCalls: InputCommandCall[] = []
    const removedDirectories: string[] = []
    const appPassword = 'notary-password-that-must-not-be-logged'

    releaseMac(baseOptions({
      PATH: '/usr/bin',
      SAFE_BUILD_VALUE: 'kept',
      APPLE_ID: 'developer@example.test',
      APPLE_APP_SPECIFIC_PASSWORD: appPassword,
      APPLE_TEAM_ID: 'TEAM123456',
    }, calls, identityEnvironments, logs, inputCalls, removedDirectories))

    expect(identityEnvironments).toEqual([{ PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' }])
    expect(calls).toHaveLength(10)
    expect(calls[0]).toEqual({
      command: 'spctl',
      args: ['--status'],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[1]).toEqual({
      command: 'yarn',
      args: ['run', 'check'],
      cwd: '/repo',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[2]).toEqual({
      command: 'security',
      args: [
        'create-keychain', '-p', 'temporary-keychain-password',
        '/private/tmp/dsh-notary-keychain-0/notary.keychain-db',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[3]).toEqual({
      command: 'security',
      args: [
        'unlock-keychain', '-p', 'temporary-keychain-password',
        '/private/tmp/dsh-notary-keychain-0/notary.keychain-db',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(inputCalls).toEqual([{
      command: 'xcrun',
      args: [
        'notarytool', 'store-credentials', 'dsh-release',
        '--apple-id', 'developer@example.test', '--team-id', 'TEAM123456',
        '--keychain', '/private/tmp/dsh-notary-keychain-0/notary.keychain-db', '--no-validate',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
      input: `${appPassword}\n`,
    }])
    expect(calls[4]).toEqual({
      command: 'yarn',
      args: [
        'exec', 'electron-builder', '--mac', 'dmg', 'zip', '--arm64',
        '--config.forceCodeSigning=true', '--config.mac.hardenedRuntime=true',
        '--config.mac.notarize=true', '--config.dmg.sign=true',
        '--config.extraMetadata.desktopUpdateMode=signed-auto',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: {
        PATH: '/usr/bin',
        SAFE_BUILD_VALUE: 'kept',
        APPLE_KEYCHAIN: '/private/tmp/dsh-notary-keychain-0/notary.keychain-db',
        APPLE_KEYCHAIN_PROFILE: 'dsh-release',
      },
    })
    expect(calls[5]).toEqual({
      command: 'xcrun',
      args: [
        'notarytool', 'submit', '/repo/dsh-plugin-desktop/dist/release.dmg',
        '--keychain-profile', 'dsh-release',
        '--keychain', '/private/tmp/dsh-notary-keychain-0/notary.keychain-db',
        '--wait', '--timeout', '30m',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: {
        PATH: '/usr/bin',
        SAFE_BUILD_VALUE: 'kept',
        APPLE_KEYCHAIN: '/private/tmp/dsh-notary-keychain-0/notary.keychain-db',
        APPLE_KEYCHAIN_PROFILE: 'dsh-release',
      },
    })
    expect(calls[6]).toEqual({
      command: 'xcrun',
      args: ['stapler', 'staple', '/repo/dsh-plugin-desktop/dist/release.dmg'],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[7]).toEqual({
      command: process.execPath,
      args: ['scripts/refresh-mac-release-metadata.ts'],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[8]).toEqual({
      command: process.execPath,
      args: ['scripts/verify-mac-release.ts'],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept', DSH_MAC_RELEASE_TEAM_ID: 'TEAM123456' },
    })
    expect(calls[9]).toEqual({
      command: 'security',
      args: ['delete-keychain', '/private/tmp/dsh-notary-keychain-0/notary.keychain-db'],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(removedDirectories).toEqual(['/private/tmp/dsh-notary-keychain-0'])
    expect(calls.flatMap(call => call.args)).not.toContain(appPassword)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('signing via keychain; notarization via apple-id')
    expect(logs[0]).not.toContain(appPassword)
  })

  it('adapts the existing P12 variables only for electron-builder', () => {
    const calls: CommandCall[] = []
    const p12Password = 'p12-password-that-must-not-be-logged'
    const p12 = Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]).toString('base64')
    const options: MacReleaseOptions = {
      ...baseOptions({
        PATH: '/usr/bin',
        APPLE_API_KEY: '/private/AuthKey.p8',
        APPLE_API_KEY_ID: 'KEY123',
        APPLE_API_ISSUER: 'issuer-id',
        CSC_KEY_PASSWORD: p12Password,
        MAC_CERT_P12_BASE64: p12,
        MACOS_SIGN_IDENTITY: 'Developer ID Application: Example Developer (TEAM123456)',
      }, calls),
      listCodeSigningIdentities: () => {
        throw new Error('P12 signing must not depend on a Keychain identity')
      },
    }

    releaseMac(options)

    expect(calls).toHaveLength(7)
    expect(calls[0]?.env).toEqual({ PATH: '/usr/bin' })
    expect(calls[1]?.env).toEqual({ PATH: '/usr/bin' })
    expect(calls[2]?.env.CSC_LINK).toBe(`data:application/x-pkcs12;base64,${p12}`)
    expect(calls[2]?.env.CSC_NAME).toBe('Example Developer (TEAM123456)')
    expect(calls[2]?.env.CSC_KEY_PASSWORD).toBe(p12Password)
    expect(calls[2]?.env.MAC_CERT_P12_BASE64).toBeUndefined()
    expect(calls[2]?.env.MACOS_SIGN_IDENTITY).toBeUndefined()
    expect(calls[3]?.args).toEqual([
      'notarytool', 'submit', '/repo/dsh-plugin-desktop/dist/release.dmg',
      '--key', '/private/AuthKey.p8', '--key-id', 'KEY123', '--issuer', 'issuer-id',
      '--wait', '--timeout', '30m',
    ])
    expect(calls[4]?.env).toEqual({ PATH: '/usr/bin' })
    expect(calls[5]?.env).toEqual({ PATH: '/usr/bin' })
    expect(calls[6]?.env).toEqual({ PATH: '/usr/bin', DSH_MAC_RELEASE_TEAM_ID: 'TEAM123456' })
  })

  it('submits and staples the final DMG with the configured Keychain profile', () => {
    const calls: CommandCall[] = []

    releaseMac(baseOptions({
      PATH: '/usr/bin',
      APPLE_KEYCHAIN_PROFILE: 'dsh-notary',
      APPLE_KEYCHAIN: '/private/release.keychain-db',
    }, calls))

    expect(calls[3]).toMatchObject({
      command: 'xcrun',
      args: [
        'notarytool', 'submit', '/repo/dsh-plugin-desktop/dist/release.dmg',
        '--keychain-profile', 'dsh-notary', '--keychain', '/private/release.keychain-db',
        '--wait', '--timeout', '30m',
      ],
    })
    expect(calls[4]).toEqual({
      command: 'xcrun',
      args: ['stapler', 'staple', '/repo/dsh-plugin-desktop/dist/release.dmg'],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin' },
    })
  })

  it('rejects development signing before running any command', () => {
    const calls: CommandCall[] = []
    const options = baseOptions({
      APPLE_KEYCHAIN_PROFILE: 'dsh-notary',
      CSC_NAME: 'Apple Development: Developer (TEAM123456)',
    }, calls)

    expect(() => releaseMac(options)).toThrow('Developer ID Application')
    expect(calls).toEqual([])
  })

  it('refuses release before building when Gatekeeper assessments are disabled', () => {
    const calls: CommandCall[] = []
    const options: MacReleaseOptions = {
      ...baseOptions({ APPLE_KEYCHAIN_PROFILE: 'dsh-notary' }, calls),
      run: (command, args, cwd, commandEnv) => {
        calls.push({ command, args: [...args], cwd, env: { ...commandEnv } })
        if (command === 'spctl') throw new Error('assessments disabled')
      },
    }

    expect(() => releaseMac(options)).toThrow('assessments disabled')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ command: 'spctl', args: ['--status'] })
  })

  it('does not invoke electron-builder after a failed credential-free check', () => {
    const calls: CommandCall[] = []
    const options: MacReleaseOptions = {
      ...baseOptions({
        APPLE_KEYCHAIN_PROFILE: 'dsh-notary',
      }, calls),
      run: (command, args, cwd, commandEnv) => {
        calls.push({ command, args: [...args], cwd, env: { ...commandEnv } })
        if (command === 'yarn') throw new Error('headless check failed')
      },
    }

    expect(() => releaseMac(options)).toThrow('headless check failed')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.args).toEqual(['--status'])
    expect(calls[1]?.args).toEqual(['run', 'check'])
    expect(calls[1]?.cwd).toBe('/repo')
  })
})

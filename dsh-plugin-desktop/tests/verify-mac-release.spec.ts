import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  verifyMacRelease,
  type MacReleaseVerificationOptions,
  type VerificationCommandResult,
} from '../scripts/verify-mac-release.ts'

const DIST = '/release/dist'
const VERSION = '2.1.0-preview.3'
const PREFIX = `DeepSeek-Harness-Desktop-Gala-${VERSION}-arm64`
const DMG = `${DIST}/${PREFIX}.dmg`
const ZIP = `${DIST}/${PREFIX}.zip`
const DMG_BLOCKMAP = `${DMG}.blockmap`
const ZIP_BLOCKMAP = `${ZIP}.blockmap`
const UPDATE = `${DIST}/latest-mac.yml`
const CONTENTS: Record<string, Buffer> = {
  [DMG]: Buffer.from('signed dmg'),
  [ZIP]: Buffer.from('signed zip'),
  [DMG_BLOCKMAP]: Buffer.from('dmg blockmap'),
  [ZIP_BLOCKMAP]: Buffer.from('zip blockmap'),
}

function sha512(value: Buffer): string {
  return createHash('sha512').update(value).digest('base64')
}

CONTENTS[UPDATE] = Buffer.from([
  `version: ${VERSION}`,
  'files:',
  `  - url: ${PREFIX}.zip`,
  `    sha512: ${sha512(CONTENTS[ZIP]!)}`,
  `    size: ${CONTENTS[ZIP]!.length}`,
  `  - url: ${PREFIX}.dmg`,
  `    sha512: ${sha512(CONTENTS[DMG]!)}`,
  `    size: ${CONTENTS[DMG]!.length}`,
  `path: ${PREFIX}.zip`,
  `sha512: ${sha512(CONTENTS[ZIP]!)}`,
  '',
].join('\n'))

function options(overrides: Partial<MacReleaseVerificationOptions> = {}) {
  const calls: Array<{ command: string; args: readonly string[] }> = []
  const removed: string[] = []
  const smokes: string[] = []
  let temporary = 0
  const value: MacReleaseVerificationOptions = {
    distDir: DIST,
    productName: 'DeepSeek Harness Desktop Gala',
    version: VERSION,
    bundleId: 'io.github.skynotsilent.harnessgala',
    teamId: 'TEAM123456',
    arch: 'arm64',
    listFiles: () => Object.keys(CONTENTS),
    makeTemporaryDirectory: prefix => `/private/tmp/${prefix}${temporary++}`,
    run: (command, args) => {
      calls.push({ command, args: [...args] })
      if (command === 'spctl' && args[0] === '--status') {
        return { stdout: 'assessments enabled\n', stderr: '' }
      }
      if (command === 'spctl' && args[0] === '--assess') {
        return { stdout: '', stderr: 'accepted\nsource=Notarized Developer ID\n' }
      }
      if (command === 'codesign' && args[0] === '--display') {
        return {
          stdout: '',
          stderr: 'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)',
        }
      }
      if (command === 'lipo') return { stdout: 'arm64\n', stderr: '' }
      return { stdout: '', stderr: '' }
    },
    removeTemporaryDirectory: path => { removed.push(path) },
    verifySmoke: async path => { smokes.push(path) },
    read: path => CONTENTS[path] ?? Buffer.alloc(0),
    size: path => (CONTENTS[path] ?? Buffer.alloc(0)).length,
    ...overrides,
  }
  return { calls, removed, smokes, value }
}

describe('macOS release artifact verification', () => {
  it('verifies DMG, ZIP, signature identity, Hardened Runtime, tickets, metadata, quarantine, and PTY', async () => {
    const harness = options()
    await expect(verifyMacRelease(harness.value)).resolves.toEqual({ dmgPath: DMG, zipPath: ZIP })

    expect(harness.calls[0]).toEqual({ command: 'spctl', args: ['--status'] })
    expect(harness.calls).toContainEqual({ command: 'hdiutil', args: ['verify', DMG] })
    expect(harness.calls).toContainEqual({
      command: 'codesign',
      args: ['--verify', '--strict', '--verbose=4', DMG],
    })
    expect(harness.calls).toContainEqual({ command: 'xcrun', args: ['stapler', 'validate', DMG] })
    expect(harness.calls).toContainEqual({
      command: 'ditto',
      args: ['-x', '-k', ZIP, '/private/tmp/dsh-desktop-zip-1'],
    })
    expect(harness.calls).toContainEqual({
      command: 'xattr',
      args: [
        '-w', 'com.apple.quarantine', '0081;00000000;Codex;Preview3',
        '/private/tmp/dsh-desktop-quarantine-2/DeepSeek Harness Desktop Gala.app',
      ],
    })
    expect(harness.calls.filter(call => call.command === 'codesign' && call.args[0] === '--verify')).toHaveLength(4)
    expect(harness.calls.filter(call => call.command === 'syspolicy_check')).toHaveLength(3)
    expect(harness.smokes).toHaveLength(3)
    expect(harness.calls.at(-1)).toEqual({
      command: 'hdiutil',
      args: ['detach', '/private/tmp/dsh-desktop-dmg-0'],
    })
    expect(harness.removed).toEqual([
      '/private/tmp/dsh-desktop-dmg-0',
      '/private/tmp/dsh-desktop-zip-1',
      '/private/tmp/dsh-desktop-quarantine-2',
    ])
  })

  it('keeps mounted and extracted applications alive until the asynchronous PTY smoke finishes', async () => {
    let releaseSmoke!: () => void
    const smokeGate = new Promise<void>(resolve => { releaseSmoke = resolve })
    let smokeCount = 0
    const harness = options({
      verifySmoke: async path => {
        harness.smokes.push(path)
        smokeCount += 1
        if (smokeCount === 1) await smokeGate
      },
    })

    const verification = verifyMacRelease(harness.value)
    expect(harness.smokes).toHaveLength(1)
    expect(harness.removed).toEqual([])
    expect(harness.calls).not.toContainEqual({
      command: 'hdiutil',
      args: ['detach', '/private/tmp/dsh-desktop-dmg-0'],
    })

    releaseSmoke()
    await expect(verification).resolves.toEqual({ dmgPath: DMG, zipPath: ZIP })
    expect(harness.smokes).toHaveLength(3)
    expect(harness.removed).toHaveLength(3)
  })

  it('rejects missing blockmaps or mismatched updater hashes before mounting', async () => {
    const noBlockmap = options({ listFiles: () => Object.keys(CONTENTS).filter(path => path !== ZIP_BLOCKMAP) })
    await expect(verifyMacRelease(noBlockmap.value)).rejects.toThrow('missing a non-empty blockmap')
    expect(noBlockmap.calls).toEqual([{ command: 'spctl', args: ['--status'] }])

    const badUpdate = Buffer.from(CONTENTS[UPDATE]!.toString('utf8').replace(sha512(CONTENTS[ZIP]!), 'invalid'))
    const badMetadata = options({
      read: path => path === UPDATE ? badUpdate : CONTENTS[path]!,
      size: path => (path === UPDATE ? badUpdate : CONTENTS[path]!).length,
    })
    await expect(verifyMacRelease(badMetadata.value)).rejects.toThrow('SHA-512 mismatch')
  })

  it('refuses verification when Gatekeeper is disabled or does not identify notarization', async () => {
    const disabled = options({
      run: (command, args) => {
        disabled.calls.push({ command, args: [...args] })
        if (command === 'spctl' && args[0] === '--status') {
          return { stdout: 'assessments disabled\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      },
    })
    await expect(verifyMacRelease(disabled.value)).rejects.toThrow('Gatekeeper assessments must be enabled')
    expect(disabled.calls).toEqual([{ command: 'spctl', args: ['--status'] }])

    const missingSource = options({
      run: (command, args) => {
        missingSource.calls.push({ command, args: [...args] })
        if (command === 'spctl' && args[0] === '--status') {
          return { stdout: 'assessments enabled\n', stderr: '' }
        }
        if (command === 'codesign' && args[0] === '--display') {
          return {
            stdout: '',
            stderr: 'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)',
          }
        }
        if (command === 'lipo') return { stdout: 'arm64\n', stderr: '' }
        if (command === 'spctl' && args[0] === '--assess') {
          return { stdout: '', stderr: 'accepted\nsource=Unnotarized Developer ID\n' }
        }
        return { stdout: '', stderr: '' }
      },
    })
    const failure = await (async () => {
      try {
        await verifyMacRelease(missingSource.value)
      } catch (cause) {
        return cause
      }
    })()
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors[0]).toEqual(
      expect.objectContaining({ message: expect.stringContaining('Notarized Developer ID') }),
    )
  })

  it('rejects a wrong Team ID, runtime flag, or architecture', async () => {
    for (const output of [
      'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=WRONGTEAM1\nflags=0x10000(runtime)',
      'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x0(none)',
    ]) {
      const harness = options({
        run: (command, args): VerificationCommandResult => {
          harness.calls.push({ command, args: [...args] })
          if (command === 'codesign' && args[0] === '--display') return { stdout: '', stderr: output }
          if (command === 'lipo') return { stdout: 'arm64\n', stderr: '' }
          if (command === 'spctl' && args[0] === '--status') return { stdout: 'assessments enabled\n', stderr: '' }
          if (command === 'spctl' && args[0] === '--assess') return { stdout: '', stderr: 'source=Notarized Developer ID\n' }
          return { stdout: '', stderr: '' }
        },
      })
      await expect(verifyMacRelease(harness.value)).rejects.toThrow(AggregateError)
    }
    const wrongArch = options({
      run: (command, args) => {
        wrongArch.calls.push({ command, args: [...args] })
        if (command === 'codesign' && args[0] === '--display') {
          return { stdout: '', stderr: 'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)' }
        }
        if (command === 'lipo') return { stdout: 'x86_64 arm64\n', stderr: '' }
        if (command === 'spctl' && args[0] === '--status') return { stdout: 'assessments enabled\n', stderr: '' }
        if (command === 'spctl' && args[0] === '--assess') return { stdout: '', stderr: 'source=Notarized Developer ID\n' }
        return { stdout: '', stderr: '' }
      },
    })
    await expect(verifyMacRelease(wrongArch.value)).rejects.toThrow(AggregateError)
  })

  it('detaches the image and preserves verification and cleanup failures', async () => {
    const verifyFailure = new Error('Gatekeeper rejected the app')
    const detachFailure = new Error('detach failed')
    const fallbackFailure = new Error('device detach failed')
    const harness = options({
      run: (command, args) => {
        harness.calls.push({ command, args: [...args] })
        if (command === 'codesign' && args[0] === '--display') {
          return { stdout: '', stderr: 'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)' }
        }
        if (command === 'lipo') return { stdout: 'arm64', stderr: '' }
        if (command === 'spctl' && args[0] === '--status') return { stdout: 'assessments enabled\n', stderr: '' }
        if (command === 'spctl' && args[0] === '--assess' && args[2] !== 'execute') {
          return { stdout: '', stderr: 'source=Notarized Developer ID\n' }
        }
        if (command === 'spctl' && args[1] === '--type' && args[2] === 'execute') throw verifyFailure
        if (command === 'hdiutil' && args[0] === 'attach') {
          return { stdout: '/dev/disk27\tGUID_partition_scheme\n/dev/disk27s1\tApple_HFS\n', stderr: '' }
        }
        if (command === 'hdiutil' && args[0] === 'detach' && args[1]?.startsWith('/private/tmp/')) {
          throw detachFailure
        }
        if (command === 'hdiutil' && args[0] === 'detach' && args[1] === '/dev/disk27') {
          throw fallbackFailure
        }
        return { stdout: '', stderr: '' }
      },
    })

    let caught: unknown
    try {
      await verifyMacRelease(harness.value)
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([verifyFailure, detachFailure, fallbackFailure])
    expect(harness.calls).toContainEqual({
      command: 'diskutil',
      args: ['unmount', '/private/tmp/dsh-desktop-dmg-0'],
    })
    expect(harness.calls).toContainEqual({ command: 'hdiutil', args: ['detach', '/dev/disk27'] })
    expect(harness.removed).toHaveLength(3)
  })

  it('recovers a busy mountpoint by unmounting and detaching the exact attached device', async () => {
    const harness = options({
      run: (command, args) => {
        harness.calls.push({ command, args: [...args] })
        if (command === 'spctl' && args[0] === '--status') return { stdout: 'assessments enabled\n', stderr: '' }
        if (command === 'spctl' && args[0] === '--assess') {
          return { stdout: '', stderr: 'source=Notarized Developer ID\n' }
        }
        if (command === 'codesign' && args[0] === '--display') {
          return {
            stdout: '',
            stderr: 'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)',
          }
        }
        if (command === 'lipo') return { stdout: 'arm64\n', stderr: '' }
        if (command === 'hdiutil' && args[0] === 'attach') {
          return { stdout: '/dev/disk31s1\tApple_HFS\t/private/tmp/dsh-desktop-dmg-0\n', stderr: '' }
        }
        if (command === 'hdiutil' && args[0] === 'detach' && args[1]?.startsWith('/private/tmp/')) {
          throw new Error('resource busy')
        }
        return { stdout: '', stderr: '' }
      },
    })

    await expect(verifyMacRelease(harness.value)).resolves.toEqual({ dmgPath: DMG, zipPath: ZIP })
    expect(harness.calls).toContainEqual({
      command: 'diskutil',
      args: ['unmount', '/private/tmp/dsh-desktop-dmg-0'],
    })
    expect(harness.calls).toContainEqual({ command: 'hdiutil', args: ['detach', '/dev/disk31'] })
  })
})

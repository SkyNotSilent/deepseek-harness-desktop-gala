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
    verifySmoke: path => { smokes.push(path) },
    read: path => CONTENTS[path] ?? Buffer.alloc(0),
    size: path => (CONTENTS[path] ?? Buffer.alloc(0)).length,
    ...overrides,
  }
  return { calls, removed, smokes, value }
}

describe('macOS release artifact verification', () => {
  it('verifies DMG, ZIP, signature identity, Hardened Runtime, tickets, metadata, quarantine, and PTY', () => {
    const harness = options()
    expect(verifyMacRelease(harness.value)).toEqual({ dmgPath: DMG, zipPath: ZIP })

    expect(harness.calls).toContainEqual({ command: 'hdiutil', args: ['verify', DMG] })
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
    expect(harness.calls.filter(call => call.command === 'codesign' && call.args[0] === '--verify')).toHaveLength(3)
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

  it('rejects missing blockmaps or mismatched updater hashes before mounting', () => {
    const noBlockmap = options({ listFiles: () => Object.keys(CONTENTS).filter(path => path !== ZIP_BLOCKMAP) })
    expect(() => verifyMacRelease(noBlockmap.value)).toThrow('missing a non-empty blockmap')
    expect(noBlockmap.calls).toEqual([])

    const badUpdate = Buffer.from(CONTENTS[UPDATE]!.toString('utf8').replace(sha512(CONTENTS[ZIP]!), 'invalid'))
    const badMetadata = options({
      read: path => path === UPDATE ? badUpdate : CONTENTS[path]!,
      size: path => (path === UPDATE ? badUpdate : CONTENTS[path]!).length,
    })
    expect(() => verifyMacRelease(badMetadata.value)).toThrow('SHA-512 mismatch')
  })

  it('rejects a wrong Team ID, runtime flag, or architecture', () => {
    for (const output of [
      'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=WRONGTEAM1\nflags=0x10000(runtime)',
      'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x0(none)',
    ]) {
      const harness = options({
        run: (command, args): VerificationCommandResult => {
          harness.calls.push({ command, args: [...args] })
          if (command === 'codesign' && args[0] === '--display') return { stdout: '', stderr: output }
          if (command === 'lipo') return { stdout: 'arm64\n', stderr: '' }
          return { stdout: '', stderr: '' }
        },
      })
      expect(() => verifyMacRelease(harness.value)).toThrow(AggregateError)
    }
    const wrongArch = options({
      run: (command, args) => {
        wrongArch.calls.push({ command, args: [...args] })
        if (command === 'codesign' && args[0] === '--display') {
          return { stdout: '', stderr: 'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)' }
        }
        if (command === 'lipo') return { stdout: 'x86_64 arm64\n', stderr: '' }
        return { stdout: '', stderr: '' }
      },
    })
    expect(() => verifyMacRelease(wrongArch.value)).toThrow(AggregateError)
  })

  it('detaches the image and preserves verification and cleanup failures', () => {
    const verifyFailure = new Error('Gatekeeper rejected the app')
    const detachFailure = new Error('detach failed')
    const harness = options({
      run: (command, args) => {
        harness.calls.push({ command, args: [...args] })
        if (command === 'codesign' && args[0] === '--display') {
          return { stdout: '', stderr: 'Identifier=io.github.skynotsilent.harnessgala\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)' }
        }
        if (command === 'lipo') return { stdout: 'arm64', stderr: '' }
        if (command === 'spctl' && args[1] === '--type' && args[2] === 'execute') throw verifyFailure
        if (command === 'hdiutil' && args[0] === 'detach') throw detachFailure
        return { stdout: '', stderr: '' }
      },
    })

    let caught: unknown
    try {
      verifyMacRelease(harness.value)
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([verifyFailure, detachFailure])
    expect(harness.removed).toHaveLength(3)
  })
})

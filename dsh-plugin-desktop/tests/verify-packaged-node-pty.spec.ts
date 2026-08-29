import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  verifyPackagedNodePty,
  type PackagedNodePtyProbes,
} from '../scripts/verify-packaged-node-pty.ts'

function probes(overrides: Partial<PackagedNodePtyProbes> = {}): PackagedNodePtyProbes {
  return {
    exists: () => true,
    executable: () => true,
    read: () => [
      "!helperPath.includes('app.asar.unpacked')",
      "!helperPath.includes('node_modules.asar.unpacked')",
      'node-pty: spawn-helper not found at',
      'NODE_PTY_SPAWN_HELPER_MISSING',
    ].join('\n'),
    ...overrides,
  }
}

describe('packaged node-pty structure', () => {
  it('checks the loader-selected native module and executable helper on Apple Silicon', () => {
    const seen: string[] = []
    verifyPackagedNodePty('/app.asar.unpacked', 'darwin', 'arm64', probes({
      exists: path => { seen.push(path); return true },
    }))
    expect(seen).toContain(join('/app.asar.unpacked', 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node'))
    expect(seen).toContain(join('/app.asar.unpacked', 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'))
  })

  it('rejects an unpatched loader and a non-executable helper', () => {
    expect(() => verifyPackagedNodePty('/bundle', 'darwin', 'arm64', probes({ read: () => 'unpatched' })))
      .toThrow('patch marker is missing')
    expect(() => verifyPackagedNodePty('/bundle', 'darwin', 'arm64', probes({ executable: () => false })))
      .toThrow('spawn-helper is not executable')
  })

  it('does not require a macOS-only helper from Linux prebuilds', () => {
    const helper = join('/bundle', 'node_modules/node-pty/prebuilds/linux-x64/spawn-helper')
    expect(() => verifyPackagedNodePty('/bundle', 'linux', 'x64', probes({
      exists: path => path !== helper,
    }))).not.toThrow()
  })
})

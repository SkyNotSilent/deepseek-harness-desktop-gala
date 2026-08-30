import { describe, expect, it, vi } from 'vitest'
import {
  PACKAGED_PTY_PROBE,
  verifyMacSmoke,
  type MacSmokeOptions,
} from '../scripts/verify-mac-smoke.ts'

function options(overrides: Partial<MacSmokeOptions> = {}): MacSmokeOptions {
  return {
    makeWorkDir: vi.fn(() => '/private/tmp/dsh-pty-smoke-test'),
    makeDirectory: vi.fn(),
    listExecutables: () => ['/Applications/Gala.app/Contents/MacOS/Gala'],
    link: vi.fn(),
    run: vi.fn(() => ({
      status: 0,
      signal: null,
      stdout: '__dsh_packaged_pty_ok__\n',
      stderr: '',
    })),
    remove: vi.fn(),
    ...overrides,
  }
}

describe('packaged macOS PTY smoke', () => {
  it('runs Electron as Node through a profile-shaped app.asar.unpacked symlink', () => {
    const harness = options()
    verifyMacSmoke('/Applications/Gala.app', harness)

    expect(harness.makeDirectory).toHaveBeenCalledWith('/private/tmp/dsh-pty-smoke-test/node_modules')
    expect(harness.link).toHaveBeenCalledWith(
      '/Applications/Gala.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty',
      '/private/tmp/dsh-pty-smoke-test/node_modules/node-pty',
    )
    expect(harness.run).toHaveBeenCalledWith(
      '/Applications/Gala.app/Contents/MacOS/Gala',
      ['-e', PACKAGED_PTY_PROBE],
      expect.objectContaining({
        ELECTRON_RUN_AS_NODE: '1',
        DSH_PACKAGED_UNPACKED_ROOT: '/Applications/Gala.app/Contents/Resources/app.asar.unpacked',
        DSH_PTY_SMOKE_ROOT: '/private/tmp/dsh-pty-smoke-test',
      }),
    )
    expect(harness.remove).toHaveBeenCalledOnce()
  })

  it('fails loud and still removes temporary state when PTY creation fails', () => {
    const harness = options({
      run: () => ({ status: 3, signal: null, stdout: '', stderr: 'spawn-helper not found' }),
    })
    expect(() => verifyMacSmoke('/Applications/Gala.app', harness)).toThrow('spawn-helper not found')
    expect(harness.remove).toHaveBeenCalledOnce()
  })

  it('rejects ambiguous app executables before creating profile state', () => {
    const harness = options({ listExecutables: () => [] })
    expect(() => verifyMacSmoke('/Applications/Gala.app', harness)).toThrow('exactly one app executable')
    expect(harness.makeWorkDir).not.toHaveBeenCalled()
  })
})

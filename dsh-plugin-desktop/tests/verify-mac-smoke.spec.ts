import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MAC_SMOKE_TIMEOUT_MS,
  PACKAGED_COMMAND_TIMEOUT_MS,
  PACKAGED_PTY_PROBE,
  PACKAGED_PTY_TIMEOUT_MS,
  runFileBackedProcess,
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
      MAC_SMOKE_TIMEOUT_MS,
    )
    expect(PACKAGED_PTY_PROBE).toContain(`}, ${PACKAGED_PTY_TIMEOUT_MS});`)
    expect(PACKAGED_PTY_PROBE.match(new RegExp(`timeout: ${PACKAGED_COMMAND_TIMEOUT_MS}`, 'gu')))
      .toHaveLength(3)
    expect(PACKAGED_PTY_PROBE).toContain("stdio: ['ignore', stdoutFd, stderrFd]")
    expect(MAC_SMOKE_TIMEOUT_MS).toBeGreaterThan(
      PACKAGED_PTY_TIMEOUT_MS + (3 * PACKAGED_COMMAND_TIMEOUT_MS),
    )
    expect(harness.remove).toHaveBeenCalledOnce()
  })

  it('does not wait for inherited output handles held by a detached descendant', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-file-backed-smoke-'))
    let descendantPid: number | undefined
    const descendant = [
      "const { spawn } = require('node:child_process')",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], {",
      "  detached: true, stdio: ['ignore', process.stdout, process.stderr],",
      '})',
      'child.unref()',
      "process.stdout.write('parent-complete:' + child.pid)",
    ].join('\n')
    const started = Date.now()
    try {
      const result = runFileBackedProcess(
        process.execPath,
        ['-e', descendant],
        process.env,
        1_000,
        directory,
      )

      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      const match = /^parent-complete:(\d+)$/u.exec(result.stdout)
      expect(match).not.toBeNull()
      if (match === null) throw new Error(`missing descendant pid in ${JSON.stringify(result.stdout)}`)
      descendantPid = Number(match[1])
      expect(descendantPid).toBeGreaterThan(0)
      expect(Date.now() - started).toBeLessThan(1_000)
    } finally {
      if (descendantPid !== undefined) {
        try {
          process.kill(descendantPid, 'SIGKILL')
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause
        }
      }
      rmSync(directory, { force: true, recursive: true })
    }
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

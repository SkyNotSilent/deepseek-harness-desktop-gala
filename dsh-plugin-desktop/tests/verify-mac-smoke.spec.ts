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
  const dispose = vi.fn()
  return {
    makeWorkDir: vi.fn(() => '/private/tmp/dsh-pty-smoke-test'),
    makeDirectory: vi.fn(),
    listExecutables: () => ['/Applications/Gala.app/Contents/MacOS/Gala'],
    link: vi.fn(),
    run: vi.fn((_executable, _args, _env, _timeout, logStem) => ({
      status: 0,
      signal: null,
      stdout: logStem === 'packaged-pty'
        ? '__dsh_packaged_pty_ok__{"node":"v24.0.0","electron":"43.4.0"}\n'
        : logStem === 'node-version'
          ? 'v24.0.0\n'
          : logStem === 'pnpm-version'
            ? '10.17.1\n'
            : '',
      stderr: '',
    })),
    readText: vi.fn(path => path.endsWith('/pnpm/package.json')
      ? '{"version":"10.17.1"}'
      : '{"node":"v24.0.0","runnerEnvironment":[]}'),
    writeText: vi.fn(),
    installRuntime: vi.fn(async () => ({
      pathDir: '/private/tmp/dsh-pty-smoke-test/runtime-commands/bin',
      pnpmShimPath: '/private/tmp/dsh-pty-smoke-test/runtime-commands/bin/pnpm',
      nodeBinDir: '/private/tmp/dsh-pty-smoke-test/runtime-commands/bin',
      nodeShimPath: '/private/tmp/dsh-pty-smoke-test/runtime-commands/bin/node',
      cacheDir: '/private/tmp/dsh-pty-smoke-test/cache',
      clearEnvironmentPath: '/private/tmp/dsh-pty-smoke-test/runtime-commands/private/clear-env.mjs',
      dispose,
    })),
    remove: vi.fn(),
    ...overrides,
  }
}

describe('packaged macOS PTY smoke', () => {
  it('runs Electron as Node through a profile-shaped app.asar.unpacked symlink', async () => {
    const harness = options()
    await verifyMacSmoke('/Applications/Gala.app', harness)

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
        DSH_PTY_SMOKE_ROOT: '/private/tmp/dsh-pty-smoke-test',
      }),
      MAC_SMOKE_TIMEOUT_MS,
      'packaged-pty',
    )
    expect(PACKAGED_PTY_PROBE).toContain(`}, ${PACKAGED_PTY_TIMEOUT_MS});`)
    expect(PACKAGED_PTY_PROBE).not.toContain('pnpm')
    expect(MAC_SMOKE_TIMEOUT_MS).toBe(PACKAGED_PTY_TIMEOUT_MS)
    expect(harness.run).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'build'],
      expect.objectContaining({
        DSH_PTY_SMOKE_ROOT: '/private/tmp/dsh-pty-smoke-test',
        pnpm_config_verify_deps_before_run: 'install',
      }),
      PACKAGED_COMMAND_TIMEOUT_MS,
      'short-build',
      '/private/tmp/dsh-pty-smoke-test/short-process-build',
    )
    expect(harness.installRuntime).toHaveBeenCalledWith(
      '/Applications/Gala.app/Contents/Resources/app.asar.unpacked/lib/desktop-runtime-environment.js',
      expect.objectContaining({
        appExecutable: '/Applications/Gala.app/Contents/Frameworks/Gala Helper.app/Contents/MacOS/Gala Helper',
        electronVersion: '43.4.0',
      }),
    )
    const runtime = await vi.mocked(harness.installRuntime).mock.results[0]?.value
    expect(runtime?.dispose).toHaveBeenCalledOnce()
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
        'detached-parent',
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

  it('fails loud and still removes temporary state when PTY creation fails', async () => {
    const harness = options({
      run: () => ({ status: 3, signal: null, stdout: '', stderr: 'spawn-helper not found' }),
    })
    await expect(verifyMacSmoke('/Applications/Gala.app', harness)).rejects.toThrow('spawn-helper not found')
    expect(harness.remove).toHaveBeenCalledOnce()
  })

  it('disposes the packaged command runtime when the short build fails', async () => {
    const harness = options()
    const successfulRun = harness.run
    harness.run = vi.fn((executable, args, env, timeout, logStem, cwd) => {
      if (logStem === 'short-build') {
        return { status: 7, signal: null, stdout: '', stderr: 'injected build failure' }
      }
      return successfulRun(executable, args, env, timeout, logStem, cwd)
    })

    await expect(verifyMacSmoke('/Applications/Gala.app', harness)).rejects.toThrow(
      'injected build failure',
    )
    const runtime = await vi.mocked(harness.installRuntime).mock.results[0]?.value
    expect(runtime?.dispose).toHaveBeenCalledOnce()
    expect(harness.remove).toHaveBeenCalledOnce()
  })

  it('rejects ambiguous app executables before creating profile state', async () => {
    const harness = options({ listExecutables: () => [] })
    await expect(verifyMacSmoke('/Applications/Gala.app', harness)).rejects.toThrow('exactly one app executable')
    expect(harness.makeWorkDir).not.toHaveBeenCalled()
  })
})

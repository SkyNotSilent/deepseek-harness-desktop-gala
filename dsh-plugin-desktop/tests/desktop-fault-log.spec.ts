import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installDesktopFaultMonitor,
  openDesktopFaultLog,
  type DesktopFaultFilesystem,
} from '../src/desktop-fault-log.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-fault-log-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('local desktop fault diagnostics', () => {
  it('redacts credentials and home paths without recording unrelated process data', () => {
    const logDir = temporaryDirectory()
    const log = openDesktopFaultLog({
      logDir,
      version: '2.1.0-preview.3',
      platform: 'darwin',
      homeDir: '/Users/alice',
      now: () => new Date('2026-08-29T01:02:03.000Z'),
    })
    log.write('pty-failure', new Error(
      'API_KEY=visible-no-more Authorization: Bearer abc.def.ghi at /Users/alice/project/app.js',
    ), { processType: 'main', bundlePath: 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper' })

    const raw = readFileSync(log.path, 'utf8')
    const entry = JSON.parse(raw.trim()) as Record<string, unknown>
    expect(entry).toMatchObject({
      time: '2026-08-29T01:02:03.000Z',
      event: 'pty-failure',
      version: '2.1.0-preview.3',
      platform: 'darwin',
      processType: 'main',
    })
    expect(raw).toContain('API_KEY=[REDACTED]')
    expect(raw).toContain('Bearer [REDACTED]')
    expect(raw).toContain('~/project/app.js')
    expect(raw).not.toContain('visible-no-more')
    expect(statSync(log.path).mode & 0o777).toBe(0o600)
  })

  it('rotates to exactly one previous 2 MiB file', () => {
    const logDir = temporaryDirectory()
    const log = openDesktopFaultLog({
      logDir,
      version: 'test',
      platform: 'darwin',
      homeDir: '/Users/alice',
    })
    const large = new Error('x'.repeat(20_000))
    for (let index = 0; index < 190; index += 1) log.write('large', large)

    expect(statSync(log.path).size).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(statSync(`${log.path}.1`).size).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(() => statSync(`${log.path}.2`)).toThrow()
  })

  it('degrades when logging fails and does not replace fatal exception semantics', () => {
    const filesystem: DesktopFaultFilesystem = {
      mkdir: vi.fn(() => { throw new Error('readonly') }),
      size: vi.fn(() => { throw new Error('readonly') }),
      append: vi.fn(() => { throw new Error('readonly') }),
      replace: vi.fn(() => { throw new Error('readonly') }),
    }
    const log = openDesktopFaultLog({
      logDir: '/readonly/logs',
      version: 'test',
      platform: 'darwin',
      homeDir: '/Users/alice',
      filesystem,
    })
    expect(() => log.write('failure', new Error('still fatal elsewhere'))).not.toThrow()

    let monitor: ((cause: unknown) => void) | undefined
    const proc = {
      on: vi.fn((_event: string, listener: (cause: unknown) => void) => { monitor = listener }),
      off: vi.fn(),
    }
    const remove = installDesktopFaultMonitor(proc as never, log)
    monitor?.(new Error('observed only'))
    remove()
    expect(proc.on).toHaveBeenCalledWith('uncaughtExceptionMonitor', expect.any(Function))
    expect(proc.off).toHaveBeenCalledWith('uncaughtExceptionMonitor', monitor)
  })

  it('records only a bounded fail-loud summary and delegates stderr unchanged', () => {
    const logDir = temporaryDirectory()
    const delegate = { write: vi.fn(() => true) }
    const log = openDesktopFaultLog({ logDir, version: 'test', platform: 'darwin', homeDir: '/Users/a' })
    const wrapped = log.failLoudStderr(delegate)
    const original = 'fatal secret-free summary\n  at first.js:1:2\nfull tool output that must not be copied'
    expect(wrapped.write(original)).toBe(true)
    expect(delegate.write).toHaveBeenCalledWith(original)
    const raw = readFileSync(log.path, 'utf8')
    expect(raw).toContain('fatal secret-free summary')
    expect(raw).toContain('at first.js:1:2')
    expect(raw).not.toContain('full tool output')
  })
})

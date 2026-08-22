import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopRuntime, DesktopUpdateAdapter, DesktopUpdateMode } from '../src/runtime.ts'
import { DESKTOP_RELEASES_URL } from '../src/update-checker.ts'
import { apply, type Config } from '../src/updates.ts'

const roots: string[] = []

const config: Config = {
  enabled: true,
  initialDelayMs: 25,
  intervalMs: 1_000,
  requestTimeoutMs: 100,
  downloadTimeoutMs: 50,
}

function release(version: string): object {
  return {
    tag_name: `v${version}`,
    html_url: `${DESKTOP_RELEASES_URL}/tag/v${version}`,
    draft: false,
    prerelease: version.includes('-'),
  }
}

interface Harness {
  adapter: DesktopUpdateAdapter
  tray: { label(): string; invoke(): void | Promise<void> }
  openRelease: ReturnType<typeof vi.fn>
  confirmDownload: ReturnType<typeof vi.fn>
  prepareAutoUpdate: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  confirmInstall: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
  showManualCheckResult: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  dispose(): Promise<void>
}

async function harness(options: {
  mode?: DesktopUpdateMode
  currentVersion?: string
  packaged?: boolean
  responses?: readonly string[]
  confirmDownload?: boolean
  prepareAutoUpdate?: boolean
  confirmInstall?: boolean
  downloadUpdate?: (version: string, signal: AbortSignal) => Promise<void>
  state?: string
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-updates-'))
  roots.push(root)
  const statePath = join(root, 'updates', 'state.json')
  if (options.state !== undefined) {
    await mkdir(join(root, 'updates'), { recursive: true })
    await writeFile(statePath, options.state, 'utf8')
  }
  const versions = [...(options.responses ?? [options.mode === 'signed-auto' ? '2.1.1' : '2.1.0-preview.2'])]
  const request = vi.fn(async () => Response.json([release(versions.shift() ?? versions.at(-1) ?? '2.1.1')]))
  const openRelease = vi.fn(async () => {})
  const confirmDownload = vi.fn(async () => options.confirmDownload ?? true)
  const prepareAutoUpdate = vi.fn(async () => options.prepareAutoUpdate ?? true)
  const downloadUpdate = vi.fn(options.downloadUpdate ?? (async () => {}))
  const confirmInstall = vi.fn(async () => options.confirmInstall ?? true)
  const quitAndInstall = vi.fn()
  const showManualCheckResult = vi.fn(async () => {})
  const notify = vi.fn()
  const adapter: DesktopUpdateAdapter = {
    isPackaged: options.packaged ?? false,
    mode: options.mode ?? 'manual-release',
    currentVersion: options.currentVersion ?? (options.mode === 'signed-auto' ? '2.1.0' : '2.1.0-preview.1'),
    statePath,
    request,
    openRelease,
    confirmDownload,
    prepareAutoUpdate,
    downloadUpdate,
    confirmInstall,
    quitAndInstall,
    showManualCheckResult,
    notify,
  }
  let tray!: Harness['tray']
  let disposer: (() => void | Promise<void>) | undefined
  const runtime = {
    updates: adapter,
    registerTrayItem: (item: Harness['tray']) => {
      tray = item
      return { refresh: vi.fn(), dispose: vi.fn() }
    },
  } as unknown as DesktopRuntime
  const ctx = {
    desktopRuntime: runtime,
    effect: (factory: () => () => void | Promise<void>) => { disposer = factory() },
  } as unknown as Context
  apply(ctx, config)
  return {
    adapter,
    tray,
    openRelease,
    confirmDownload,
    prepareAutoUpdate,
    downloadUpdate,
    confirmInstall,
    quitAndInstall,
    showManualCheckResult,
    notify,
    dispose: async () => { await disposer?.() },
  }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Desktop update security modes', () => {
  it('manual-release opens GitHub and never touches executable update APIs', async () => {
    const value = await harness()
    await value.tray.invoke()
    expect(value.openRelease).toHaveBeenCalledWith(`${DESKTOP_RELEASES_URL}/tag/v2.1.0-preview.2`)
    expect(value.prepareAutoUpdate).not.toHaveBeenCalled()
    expect(value.downloadUpdate).not.toHaveBeenCalled()
    expect(value.quitAndInstall).not.toHaveBeenCalled()
    await value.dispose()
  })

  it('manual-release background checks notify but never open or download automatically', async () => {
    vi.useFakeTimers()
    const value = await harness({ packaged: true })
    await vi.advanceTimersByTimeAsync(config.initialDelayMs)
    await vi.waitFor(() => { expect(value.notify).toHaveBeenCalledOnce() })
    expect(value.openRelease).not.toHaveBeenCalled()
    expect(value.downloadUpdate).not.toHaveBeenCalled()
    expect(value.quitAndInstall).not.toHaveBeenCalled()
    await value.dispose()
  })

  it('signed-auto respects download cancellation', async () => {
    const value = await harness({ mode: 'signed-auto', confirmDownload: false })
    await value.tray.invoke()
    expect(value.confirmDownload).toHaveBeenCalledWith('2.1.1')
    expect(value.prepareAutoUpdate).not.toHaveBeenCalled()
    expect(value.downloadUpdate).not.toHaveBeenCalled()
    expect(value.quitAndInstall).not.toHaveBeenCalled()
    await value.dispose()
  })

  it('rechecks and refuses a version that changed after confirmation', async () => {
    const value = await harness({ mode: 'signed-auto', responses: ['2.1.1', '2.1.2'] })
    await value.tray.invoke()
    expect(value.prepareAutoUpdate).not.toHaveBeenCalled()
    expect(value.downloadUpdate).not.toHaveBeenCalled()
    await value.dispose()
  })

  it('requires electron-updater to prepare the exact signed version', async () => {
    const value = await harness({ mode: 'signed-auto', responses: ['2.1.1', '2.1.1'], prepareAutoUpdate: false })
    await value.tray.invoke()
    expect(value.prepareAutoUpdate).toHaveBeenCalledWith('2.1.1')
    expect(value.downloadUpdate).not.toHaveBeenCalled()
    await value.dispose()
  })

  it('supports later install without calling quitAndInstall', async () => {
    const value = await harness({ mode: 'signed-auto', responses: ['2.1.1', '2.1.1'], confirmInstall: false })
    await value.tray.invoke()
    expect(value.downloadUpdate).toHaveBeenCalledOnce()
    expect(value.confirmInstall).toHaveBeenCalledWith('2.1.1')
    expect(value.quitAndInstall).not.toHaveBeenCalled()
    await value.dispose()
  })

  it('downloads and restarts only after both confirmations', async () => {
    const value = await harness({ mode: 'signed-auto', responses: ['2.1.1', '2.1.1'] })
    await value.tray.invoke()
    expect(value.downloadUpdate).toHaveBeenCalledOnce()
    expect(value.quitAndInstall).toHaveBeenCalledOnce()
    await value.dispose()
  })

  it('cancels a timed-out signed download and reports failure', async () => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    const value = await harness({
      mode: 'signed-auto',
      responses: ['2.1.1', '2.1.1'],
      downloadUpdate: async (_version, signal) => new Promise<void>((_resolve, reject) => {
        observedSignal = signal
        signal.addEventListener('abort', () => { reject(new Error('timed out')) }, { once: true })
      }),
    })
    const action = value.tray.invoke()
    await vi.waitFor(() => { expect(value.downloadUpdate).toHaveBeenCalledOnce() })
    await vi.advanceTimersByTimeAsync(config.downloadTimeoutMs)
    await action
    expect(observedSignal?.aborted).toBe(true)
    expect(value.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'DeepSeek Harness Desktop Gala Update Failed' }))
    expect(value.quitAndInstall).not.toHaveBeenCalled()
    await value.dispose()
  })

  it('reports up-to-date and failed manual checks without opening GitHub', async () => {
    const current = await harness({ responses: ['2.1.0-preview.1'] })
    await current.tray.invoke()
    expect(current.showManualCheckResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'up-to-date' }))
    expect(current.openRelease).not.toHaveBeenCalled()
    await current.dispose()
  })
})

/** Cordis coordinator for manual Preview releases and signed automatic updates. */

import { open } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import z from '@deepseek-ai/schemastery'
import type {} from './runtime.ts'
import { checkForStableUpdate, parseSemVer, type UpdateCheckResult } from './update-checker.ts'

export const name = 'desktop-updates'
export const inject = ['desktopRuntime']

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_STATE_BYTES = 4 * 1024

export interface Config {
  enabled: boolean
  initialDelayMs: number
  intervalMs: number
  requestTimeoutMs: number
  downloadTimeoutMs: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  initialDelayMs: z.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
  intervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(6 * 60 * 60 * 1000),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
  downloadTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(30 * 60 * 1000),
})

interface UpdateStateV3 {
  readonly version: 3
  readonly lastPromptedVersion?: string
}

const EMPTY_STATE: UpdateStateV3 = { version: 3 }

export function apply(ctx: Context, config: Config): void {
  const adapter = ctx.desktopRuntime.updates
  ctx.effect(() => {
    let disposed = false
    let checking = false
    let installing = false
    let available: Extract<UpdateCheckResult, { status: 'update-available' }> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let requestTimer: ReturnType<typeof setTimeout> | undefined
    let downloadTimer: ReturnType<typeof setTimeout> | undefined
    let requestController: AbortController | undefined
    let downloadController: AbortController | undefined
    let checkTask: Promise<UpdateCheckResult | null> | undefined
    let actionTask: Promise<void> | undefined
    let state: UpdateStateV3 = EMPTY_STATE
    let refreshTray = (): void => {}

    const persistState = async (): Promise<void> => {
      try {
        await writeFileAtomic(adapter.statePath, `${JSON.stringify(state, null, 2)}\n`, {
          mode: 0o600,
          dirMode: 0o700,
        })
      } catch {
        // Prompt history is optional and must never break startup.
      }
    }

    const stateReady = (async () => {
      try {
        state = parseState(await readState(adapter.statePath))
      } catch (cause) {
        if (isEnoent(cause)) return
        state = EMPTY_STATE
        if (!disposed) await persistState()
      }
    })()

    const rememberPrompt = async (version: string): Promise<void> => {
      await stateReady
      if (state.lastPromptedVersion === version) return
      state = { version: 3, lastPromptedVersion: version }
      await persistState()
    }

    const startCheck = (): Promise<UpdateCheckResult | null> => {
      if (checkTask !== undefined) return checkTask
      checking = true
      refreshTray()
      const controller = new AbortController()
      requestController = controller
      const task = (async () => {
        requestTimer = setTimeout(() => { controller.abort() }, config.requestTimeoutMs)
        return checkForStableUpdate({
          currentVersion: adapter.currentVersion,
          signal: controller.signal,
          request: adapter.request,
        })
      })().catch(() => null).finally(() => {
        if (requestTimer !== undefined) clearTimeout(requestTimer)
        requestTimer = undefined
        if (requestController === controller) requestController = undefined
        if (checkTask === task) checkTask = undefined
        checking = false
        refreshTray()
      })
      checkTask = task
      return task
    }

    const observe = (result: UpdateCheckResult | null): typeof available => {
      available = result?.status === 'update-available' ? result : undefined
      refreshTray()
      return available
    }

    const offerSignedUpdate = async (release: NonNullable<typeof available>): Promise<void> => {
      if (adapter.mode !== 'signed-auto' || disposed || installing) return
      let confirmed = false
      try {
        confirmed = await adapter.confirmDownload(release.latestVersion)
      } catch {
        return
      }
      if (!confirmed || disposed) return

      const fresh = observe(await startCheck())
      if (fresh?.latestVersion !== release.latestVersion || disposed) return
      if (!await adapter.prepareAutoUpdate(release.latestVersion) || disposed) return

      const controller = new AbortController()
      downloadController = controller
      installing = true
      refreshTray()
      downloadTimer = setTimeout(() => { controller.abort() }, config.downloadTimeoutMs)
      try {
        await adapter.downloadUpdate(release.latestVersion, controller.signal)
        if (disposed || controller.signal.aborted) return
        const installNow = await adapter.confirmInstall(release.latestVersion)
        if (!disposed && installNow) adapter.quitAndInstall()
      } catch {
        if (!disposed) adapter.notify({
          title: 'DeepSeek Harness Desktop Gala Update Failed',
          body: 'The signed update could not be downloaded or installed. Try again later.',
        })
      } finally {
        if (downloadTimer !== undefined) clearTimeout(downloadTimer)
        downloadTimer = undefined
        if (downloadController === controller) downloadController = undefined
        installing = false
        refreshTray()
      }
    }

    const runManualCheck = (): Promise<void> => {
      actionTask ??= (async () => {
        const result: UpdateCheckResult | null = available ?? await startCheck()
        const release = result?.status === 'update-available' ? observe(result) : undefined
        if (disposed) return
        if (release === undefined) {
          await adapter.showManualCheckResult(result)
        } else if (adapter.mode === 'manual-release') {
          await rememberPrompt(release.latestVersion)
          await adapter.openRelease(release.releaseUrl)
        } else {
          await rememberPrompt(release.latestVersion)
          await offerSignedUpdate(release)
        }
      })().catch(() => undefined).finally(() => { actionTask = undefined })
      return actionTask
    }

    const runBackgroundCheck = async (): Promise<void> => {
      if (checkTask !== undefined || disposed) return
      const release = observe(await startCheck())
      if (release === undefined || disposed) return
      await stateReady
      if (state.lastPromptedVersion === release.latestVersion || disposed) return
      await rememberPrompt(release.latestVersion)
      if (adapter.mode === 'manual-release') {
        adapter.notify({
          title: `DeepSeek Harness Desktop Gala ${release.latestVersion} Available`,
          body: 'Open Check for Updates to view this public GitHub Release.',
        })
      } else {
        await offerSignedUpdate(release)
      }
    }

    const schedule = (delayMs: number): void => {
      pollTimer = setTimeout(() => {
        pollTimer = undefined
        void runBackgroundCheck().finally(() => {
          if (!disposed) schedule(config.intervalMs)
        })
      }, delayMs)
    }

    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'status',
      order: 10,
      label: () => installing
        ? 'Installing DeepSeek Harness Desktop Gala Update…'
        : available === undefined
          ? checking ? 'Checking for Updates…' : 'Check for Updates…'
          : `DeepSeek Harness Desktop Gala ${available.latestVersion} Available`,
      invoke: runManualCheck,
    })
    refreshTray = registration.refresh
    if (adapter.isPackaged && config.enabled) schedule(config.initialDelayMs)

    return async () => {
      disposed = true
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      if (requestTimer !== undefined) clearTimeout(requestTimer)
      if (downloadTimer !== undefined) clearTimeout(downloadTimer)
      requestController?.abort()
      downloadController?.abort()
      registration.dispose()
      const pending: Promise<unknown>[] = [stateReady]
      if (checkTask !== undefined) pending.push(checkTask)
      await Promise.allSettled(pending)
    }
  }, 'dsh-plugin-desktop: GitHub release checks and signed update handoff')
}

function parseState(text: string): UpdateStateV3 {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)
    || value.version !== 3
    || (value.lastPromptedVersion !== undefined && !isCanonicalVersion(value.lastPromptedVersion))
    || Object.keys(value).some(key => !['version', 'lastPromptedVersion'].includes(key))) {
    throw new Error('invalid v3 update state')
  }
  return value.lastPromptedVersion === undefined
    ? EMPTY_STATE
    : { version: 3, lastPromptedVersion: value.lastPromptedVersion as string }
}

async function readState(filename: string): Promise<string> {
  const handle = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > MAX_STATE_BYTES) throw new Error(`update state exceeds ${MAX_STATE_BYTES} bytes`)
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

function isCanonicalVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = parseSemVer(value)
  return parsed !== null && parsed.version === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnoent(value: unknown): boolean {
  return isRecord(value) && value.code === 'ENOENT'
}

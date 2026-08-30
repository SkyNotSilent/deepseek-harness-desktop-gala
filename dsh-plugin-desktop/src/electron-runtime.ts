/** Electron implementation of the launcher-provided desktop runtime capability. */

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  shell,
  Tray,
} from 'electron'
import { spawn } from 'node:child_process'
// electron-updater is CommonJS and exposes `autoUpdater` through a getter, which
// Node's ESM named-export detection cannot see; read it from the default export.
import electronUpdater, { CancellationToken } from 'electron-updater'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopTerminalStateDirectory, openDesktopTerminal } from './desktop-terminal.ts'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
import type {
  DesktopNotification,
  DesktopPlatform,
  DesktopRuntime,
  DesktopShellSpec,
  DesktopTerminalSpec,
  DesktopThemeSource,
  DesktopTrayItem,
  DesktopTrayItemGroup,
  DesktopTrayItemRegistration,
  DesktopUpdateAdapter,
} from './runtime.ts'
import type { RendererBootReport } from './renderer-boot-contract.ts'
import { prepareTrayIcon } from './tray-icons.ts'
import { GITHUB_OWNER, GITHUB_REPOSITORY, parseSemVer, type UpdateCheckResult } from './update-checker.ts'
import { desktopWindowOptions } from './window-options.ts'

const { autoUpdater } = electronUpdater

const RENDERER_LOAD_RETRY_DELAYS_MS = [100, 200, 400, 800] as const

/** Only retry the loopback race Electron reports while the local Web surface is coming online. */
export function isTransientRendererLoadFailure(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  return (cause as Error & { code?: number }).code === -102
    || cause.message.includes('ERR_CONNECTION_REFUSED')
}

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

/** Return the presentation mode opposite the active generation. */
export function nextDesktopShellMode(mode: DesktopShellSpec['mode']): DesktopShellSpec['mode'] {
  return mode === 'compatibility' ? 'advanced' : 'compatibility'
}

/** Return the tray command describing the mode that will be activated. */
export function modeToggleLabel(mode: DesktopShellSpec['mode']): string {
  return mode === 'compatibility'
    ? 'Switch to Advanced Mode'
    : 'Switch to Compatibility Mode'
}

/**
 * Read the desktop package version instead of Electron's development-app version.
 * @param moduleUrl - module below the package's `src` or `lib` directory.
 * @returns validated desktop product version.
 */
interface DesktopProductMetadata {
  readonly version: string
  readonly desktopUpdateMode?: string
}

/** Read the product version and build-time update policy from the packaged manifest. */
export function desktopProductMetadata(moduleUrl: string = import.meta.url): DesktopProductMetadata {
  const value: unknown = JSON.parse(readFileSync(new URL('../package.json', moduleUrl), 'utf8'))
  if (value === null || typeof value !== 'object' || typeof (value as { version?: unknown }).version !== 'string') {
    throw new Error('dsh-plugin-desktop: package.json has no product version')
  }
  const manifest = value as { version: string; desktopUpdateMode?: unknown }
  if (manifest.desktopUpdateMode !== undefined && typeof manifest.desktopUpdateMode !== 'string') {
    throw new Error('dsh-plugin-desktop: package.json has an invalid desktop update mode')
  }
  return {
    version: manifest.version,
    ...(manifest.desktopUpdateMode === undefined ? {} : { desktopUpdateMode: manifest.desktopUpdateMode }),
  }
}

export function desktopProductVersion(moduleUrl: string = import.meta.url): string {
  return desktopProductMetadata(moduleUrl).version
}

const PRODUCT_METADATA = desktopProductMetadata()
const PRODUCT_VERSION = PRODUCT_METADATA.version

/** Refuse automatic installation unless a packaged stable build opts in explicitly. */
export function desktopUpdateMode(
  isPackaged: boolean,
  version: string,
  requested: string | undefined,
  platform: NodeJS.Platform = process.platform,
): DesktopUpdateAdapter['mode'] {
  const parsed = parseSemVer(version)
  return isPackaged
    && requested === 'signed-auto'
    && (platform === 'darwin' || platform === 'win32')
    && parsed !== null
    && parsed.prerelease.length === 0
    && parsed.version === version
    ? 'signed-auto'
    : 'manual-release'
}

/** Native adapter used by the DeepSeek Harness Desktop Gala launcher and owned by its Cordis shell plugin. */
export class ElectronDesktopRuntime implements DesktopRuntime {
  readonly platform: DesktopPlatform
  readonly updates: DesktopUpdateAdapter = {
    get isPackaged() { return app.isPackaged },
    get mode() { return desktopUpdateMode(app.isPackaged, PRODUCT_VERSION, PRODUCT_METADATA.desktopUpdateMode) },
    get currentVersion() { return PRODUCT_VERSION },
    get statePath() { return join(app.getPath('userData'), 'updates', 'state.json') },
    request: (url, init) => net.fetch(url, init),
    openRelease: url => this.openUpdateRelease(url),
    confirmDownload: version => this.confirmUpdateDownload(version),
    showManualCheckResult: result => this.showManualUpdateCheckResult(result),
    prepareAutoUpdate: version => this.prepareAutoUpdate(version),
    downloadUpdate: (version, signal) => this.downloadSignedUpdate(version, signal),
    confirmInstall: version => this.confirmUpdateInstall(version),
    quitAndInstall: () => {
      this.quitting = true
      autoUpdater.quitAndInstall(false, true)
    },
    notify: notification => { this.showNotification(notification) },
  }

  private window: BrowserWindow | undefined
  private tray: Tray | undefined
  private scheduled: DesktopShellSpec | undefined
  private mountTask: Promise<void> | undefined
  private release: (() => Promise<void>) | undefined
  private quitting = false
  private readonly trayItems = new Map<symbol, DesktopTrayItem>()
  private terminalSpec: DesktopTerminalSpec | undefined
  private rendererBootReported = false

  constructor(
    private readonly restart: () => Promise<void>,
    private readonly onRendererBoot: (report: RendererBootReport) => void = () => {},
    private readonly waitBeforeRendererRetry: (delayMs: number) => Promise<void> = wait,
  ) {
    if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux') {
      throw new Error(`dsh-plugin-desktop: unsupported Electron platform ${process.platform}`)
    }
    this.platform = process.platform
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
  }

  /** @inheritdoc */
  schedule(spec: DesktopShellSpec): () => Promise<void> {
    if (this.scheduled !== undefined || this.mountTask !== undefined) {
      throw new Error('dsh-plugin-desktop: a native shell generation is already registered')
    }
    const previousThemeSource = nativeTheme.themeSource
    this.scheduled = spec
    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      try {
        await this.mountTask
      } finally {
        try {
          await this.release?.()
        } finally {
          this.release = undefined
          this.mountTask = undefined
          if (this.scheduled === spec) {
            if (spec.mode === 'advanced') nativeTheme.themeSource = previousThemeSource
            this.scheduled = undefined
          }
        }
      }
    }
  }

  /** @inheritdoc */
  mountScheduled(beforeInteractive?: () => void): Promise<void> {
    const spec = this.scheduled
    if (spec === undefined) {
      return Promise.reject(new Error('dsh-plugin-desktop: the Cordis shell plugin did not register a window'))
    }
    this.mountTask ??= this.mount(spec, beforeInteractive).then((release) => { this.release = release })
    return this.mountTask
  }

  /** @inheritdoc */
  show(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  /** @inheritdoc */
  registerTrayItem(item: DesktopTrayItem): DesktopTrayItemRegistration {
    const key = Symbol()
    this.trayItems.set(key, item)
    this.rebuildTrayMenu()
    let active = true
    return {
      refresh: () => {
        if (active) this.rebuildTrayMenu()
      },
      dispose: () => {
        if (!active) return
        active = false
        this.trayItems.delete(key)
        this.rebuildTrayMenu()
      },
    }
  }

  /**
   * Fix the profile identity before Cordis plugins can contribute terminal commands.
   * @param spec - launcher-resolved desktop profile and Harness home.
   */
  configureTerminal(spec: DesktopTerminalSpec): void {
    if (this.terminalSpec !== undefined) {
      throw new Error('dsh-plugin-desktop: terminal profile is already configured')
    }
    this.terminalSpec = { ...spec }
  }

  /** @inheritdoc */
  openTerminal(): void {
    try {
      const spec = this.terminalSpec
      if (spec === undefined) {
        throw new Error('dsh-plugin-desktop: terminal profile is not configured')
      }
      const electronVersion = process.versions.electron
      if (electronVersion === undefined) {
        throw new Error('dsh-plugin-desktop: terminal requires the Electron runtime version')
      }
      openDesktopTerminal({
        platform: this.platform,
        appExecutable: process.execPath,
        dshBootstrapPath: fileURLToPath(new URL('./desktop-cli.js', import.meta.url)),
        pnpmBinPath: packagedDependencyPath(import.meta.url, 'pnpm/bin/pnpm.mjs'),
        electronVersion,
        profileName: spec.profileName,
        productVersion: PRODUCT_VERSION,
        profileDir: spec.profileDir,
        homeDir: spec.homeDir,
        stateDir: desktopTerminalStateDirectory(app.getPath('userData'), spec.profileName),
        spawn,
        onLaunchError: cause => { this.reportTerminalLaunchError(cause) },
      })
    } catch (cause) {
      this.reportTerminalLaunchError(cause)
    }
  }

  /** @inheritdoc */
  reportRendererBoot(report: RendererBootReport): void {
    if (this.rendererBootReported) return
    this.rendererBootReported = true
    try {
      this.onRendererBoot(report)
    } catch (cause) {
      process.stderr.write(`dsh-plugin-desktop: failed to persist renderer boot health: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    }
    if (report.status === 'failed') {
      void this.showRendererBootRecovery(report).catch((cause: unknown) => {
        process.stderr.write(`dsh-plugin-desktop: failed to show plugin recovery: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      })
    }
  }

  /** @inheritdoc */
  setThemeSource(source: DesktopThemeSource): void {
    if (this.scheduled?.mode === 'advanced' && this.window !== undefined) {
      nativeTheme.themeSource = source
    }
  }

  /** @inheritdoc */
  async requestRestart(): Promise<void> {
    await this.restart()
  }

  /** @inheritdoc */
  prepareToQuit(): void {
    this.quitting = true
  }

  private async showRendererBootRecovery(report: Extract<RendererBootReport, { status: 'failed' }>): Promise<void> {
    const plugins = report.plugins.length === 0
      ? 'Unknown client plugin'
      : report.plugins.map(plugin => `- ${plugin}`).join('\n')
    const error = report.error === undefined ? 'The client Loader did not provide an error message.' : report.error
    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'Plugin Recovery',
      message: 'DeepSeek Harness Desktop Gala could not load all plugins.',
      detail: `Failed plugins:\n${plugins}\n\n${error}\n\nOpen DSH Terminal to update or remove the failing third-party plugin, then restart DeepSeek Harness Desktop Gala.`,
      buttons: ['Open DSH Terminal', 'Restart DeepSeek Harness Desktop Gala', 'Dismiss'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    if (result.response === 0) this.openTerminal()
    else if (result.response === 1) await this.requestRestart()
  }

  private contributedTrayItems(group: DesktopTrayItemGroup): Electron.MenuItemConstructorOptions[] {
    return [...this.trayItems.values()]
      .filter(item => item.group === group)
      .sort((left, right) => left.order - right.order)
      .map((item): Electron.MenuItemConstructorOptions => {
        const common = {
          label: item.label(),
          enabled: item.enabled?.() ?? true,
        }
        if (item.submenu !== undefined) {
          return {
            ...common,
            submenu: item.submenu().map(command => ({
              label: command.label(),
              enabled: command.enabled?.() ?? true,
              ...(command.type === undefined ? {} : { type: command.type }),
              ...(command.checked === undefined ? {} : { checked: command.checked() }),
              click: this.trayCommand(() => command.invoke()),
            })),
          }
        }
        return {
          ...common,
          click: this.trayCommand(() => item.invoke()),
        }
      })
  }

  /** Contain asynchronous contribution failures outside Electron menu callbacks. */
  private trayCommand(invoke: () => void | Promise<void>): () => void {
    return () => {
      void Promise.resolve().then(invoke).catch((cause: unknown) => {
        process.stderr.write(`dsh-plugin-desktop: tray command failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      })
    }
  }

  private showNotification(notification: DesktopNotification): void {
    if (!Notification.isSupported()) return
    const nativeNotification = new Notification({
      title: notification.title,
      body: notification.body,
    })
    nativeNotification.show()
  }

  /** Ask before making the fixed download endpoint's counted request. */
  private async confirmUpdateDownload(version: string): Promise<boolean> {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'DeepSeek Harness Desktop Gala Update Available',
      message: `DeepSeek Harness Desktop Gala ${version} is available.`,
      detail: 'Download this update now?',
      buttons: ['Download', 'Later'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0
  }

  /** Report one user-triggered check without exposing network or response details. */
  private async showManualUpdateCheckResult(result: UpdateCheckResult | null): Promise<void> {
    if (result === null) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Unable to Check for Updates',
        message: 'DeepSeek Harness Desktop Gala could not check for updates.',
        detail: 'Please try again later.',
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      })
      return
    }

    if (result.status === 'up-to-date') {
      await dialog.showMessageBox({
        type: 'info',
        title: 'DeepSeek Harness Desktop Gala Is Up to Date',
        message: 'No newer version of DeepSeek Harness Desktop Gala is available.',
        detail: `Installed version: ${result.currentVersion}`,
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      })
      return
    }

    await dialog.showMessageBox({
      type: 'info',
      title: 'DeepSeek Harness Desktop Gala Update Available',
      message: `DeepSeek Harness Desktop Gala ${result.latestVersion} is available.`,
      detail: 'Open the public GitHub Release to download this version.',
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    })
  }

  private async openUpdateRelease(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:'
      || parsed.hostname !== 'github.com'
      || parsed.username !== ''
      || parsed.password !== ''
      || !parsed.pathname.startsWith(`/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/`)) {
      throw new Error('dsh-plugin-desktop: refused an untrusted update release URL')
    }
    await shell.openExternal(parsed.href)
  }

  private async prepareAutoUpdate(version: string): Promise<boolean> {
    if (this.updates.mode !== 'signed-auto') return false
    const result = await autoUpdater.checkForUpdates()
    return result?.updateInfo.version === version
  }

  private async downloadSignedUpdate(version: string, signal: AbortSignal): Promise<void> {
    if (this.updates.mode !== 'signed-auto') {
      throw new Error('dsh-plugin-desktop: unsigned builds cannot download executable updates')
    }
    const token = new CancellationToken()
    const cancel = (): void => { token.cancel() }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      const files = await autoUpdater.downloadUpdate(token)
      signal.throwIfAborted()
      if (files.length === 0) throw new Error(`dsh-plugin-desktop: updater returned no files for ${version}`)
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }

  private async confirmUpdateInstall(version: string): Promise<boolean> {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'DeepSeek Harness Desktop Gala Update Downloaded',
      message: `DeepSeek Harness Desktop Gala ${version} is ready to install.`,
      detail: 'Restart DeepSeek Harness Desktop Gala and install the signed update now?',
      buttons: ['Restart and Install', 'Later'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0
  }

  /** Keep native-terminal launch failures visible in a packaged GUI process. */
  private reportTerminalLaunchError(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    process.stderr.write(`dsh-plugin-desktop: failed to open terminal: ${error.message}\n`)
    try {
      dialog.showErrorBox('Unable to Open DSH Terminal', error.message)
    } catch (dialogCause) {
      process.stderr.write(`dsh-plugin-desktop: failed to show terminal error: ${dialogCause instanceof Error ? dialogCause.message : String(dialogCause)}\n`)
    }
  }

  private rebuildTrayMenu(): void {
    const tray = this.tray
    const spec = this.scheduled
    if (tray === undefined || spec === undefined) return

    const show = (): void => { this.show() }
    const tools = this.contributedTrayItems('tools')
    const profiles = this.contributedTrayItems('profiles')
    const status = this.contributedTrayItems('status')
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: `Open ${spec.productName}`, click: show },
    ]
    if (tools.length > 0) template.push({ type: 'separator' }, ...tools)
    if (profiles.length > 0) template.push({ type: 'separator' }, ...profiles)
    if (status.length > 0) template.push({ type: 'separator' }, ...status)
    template.push(
      { type: 'separator' },
      {
        label: modeToggleLabel(spec.mode),
        enabled: this.platform !== 'linux',
        click: () => {
          void spec.requestModeChange(nextDesktopShellMode(spec.mode)).catch((cause: unknown) => {
            process.stderr.write(`dsh-plugin-desktop: failed to change shell mode: ${cause instanceof Error ? cause.message : String(cause)}\n`)
          })
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { spec.requestQuit(0) } },
    )
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  private async mount(
    spec: DesktopShellSpec,
    beforeInteractive: (() => void) | undefined,
  ): Promise<() => Promise<void>> {
    const icon = nativeImage.createFromPath(spec.iconPath)
    if (icon.isEmpty()) {
      throw new Error(`dsh-plugin-desktop: failed to load application icon ${spec.iconPath}`)
    }
    if (this.platform === 'darwin') app.dock?.setIcon(icon)
    const origin = new URL(spec.url).origin
    if (spec.mode === 'advanced') nativeTheme.themeSource = spec.readThemeSource()
    const window = new BrowserWindow(desktopWindowOptions(spec, icon, this.platform))
    window.accessibleTitle = spec.windowTitle
    if (this.platform === 'win32') window.removeMenu()
    this.window = window

    const show = (): void => { this.show() }
    const close = (event: Electron.Event): void => {
      if (this.quitting) return
      event.preventDefault()
      window.hide()
    }
    const preserveBlankTitle = (event: Electron.Event): void => { event.preventDefault() }
    const navigate = (event: Electron.Event<{ url: string }>): void => {
      let targetOrigin: string | undefined
      try {
        targetOrigin = new URL(event.url).origin
      } catch {
        targetOrigin = undefined
      }
      if (targetOrigin !== origin) event.preventDefault()
    }

    app.on('activate', show)
    window.on('close', close)
    window.on('page-title-updated', preserveBlankTitle)
    window.webContents.on('will-frame-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url)
        if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
          void shell.openExternal(target.href).catch((cause: unknown) => {
            process.stderr.write(`dsh-plugin-desktop: failed to open external link: ${cause instanceof Error ? cause.message : String(cause)}\n`)
          })
        }
      } catch {
        // A malformed target is rejected with the same deny result.
      }
      return { action: 'deny' }
    })

    window.once('ready-to-show', show)
    let tray: Tray | undefined
    try {
      await this.authenticateRenderer(window, spec.authenticationUrl)
      await this.loadRenderer(window, spec.url)
      tray = new Tray(prepareTrayIcon(spec.trayIcons, this.platform))
      this.tray = tray
      tray.setToolTip(spec.productName)
      this.rebuildTrayMenu()
      tray.on('click', show)
      beforeInteractive?.()
    } catch (cause) {
      app.off('activate', show)
      window.off('page-title-updated', preserveBlankTitle)
      tray?.off('click', show)
      tray?.destroy()
      window.destroy()
      this.tray = undefined
      this.window = undefined
      throw cause
    }

    if (tray === undefined) {
      throw new Error('dsh-plugin-desktop: native tray did not mount')
    }
    const mountedTray = tray

    let released = false
    return async () => {
      if (released) return
      released = true
      app.off('activate', show)
      window.off('close', close)
      window.off('page-title-updated', preserveBlankTitle)
      window.webContents.off('will-frame-navigate', navigate)
      window.webContents.off('will-redirect', navigate)
      mountedTray.off('click', show)
      mountedTray.destroy()
      if (!window.isDestroyed()) window.destroy()
      if (this.tray === mountedTray) this.tray = undefined
      if (this.window === window) this.window = undefined
    }
  }

  /** Exchange the one-time launch token inside the exact Electron session used by the renderer. */
  private async authenticateRenderer(window: BrowserWindow, authenticationUrl: string): Promise<void> {
    const response = await window.webContents.session.fetch(authenticationUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`dsh-plugin-desktop: renderer authentication failed with HTTP ${String(response.status)}`)
    }
  }

  /** Absorb a bounded loopback-listener race without hiding real renderer failures. */
  private async loadRenderer(window: BrowserWindow, url: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await window.loadURL(url)
        return
      } catch (cause) {
        const delayMs = RENDERER_LOAD_RETRY_DELAYS_MS[attempt]
        if (delayMs === undefined || !isTransientRendererLoadFailure(cause)) throw cause
        await this.waitBeforeRendererRetry(delayMs)
      }
    }
  }
}

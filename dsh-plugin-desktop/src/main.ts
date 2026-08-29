/** DeepSeek Harness Desktop Gala executable: minimal Electron bootstrap around the Host Cordis root. */

import { app, BrowserWindow, crashReporter, dialog } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import {
  defaultOfficialsDir,
  resolveGalaSplashAppearance,
  type GalaService,
} from 'dsh-plugin-gala'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boot,
  installFailLoud,
  loadLayeredEnv,
  type FailLoudProcess,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { installDesktopPnpmRuntime } from './desktop-runtime-environment.ts'
import { installDesktopFaultMonitor, openDesktopFaultLog } from './desktop-fault-log.ts'
import { recoverGuiPath } from './gui-path.ts'
import { desktopProductVersion, ElectronDesktopRuntime } from './electron-runtime.ts'
import { createGalaHostAdapter } from './gala-electron.ts'
import { createGalaWorkspaceCoordinator } from './gala-workspaces.ts'
import { readProfileBundles, writeProfileBundles } from './profile-bundles.ts'
import {
  openSplash,
  SPLASH_HEIGHT,
  SPLASH_WIDTH,
  splashPresentationFromAppearance,
  type SplashController,
  type SplashPresentation,
} from './splash.ts'
import { installProfilePackageResolver } from './module-resolution.ts'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
import {
  beginDesktopProfileStartup,
  cancelDesktopProfileSelection,
  listDesktopProfiles,
  markDesktopProfileFailed,
  markDesktopProfileHealthy,
  selectDesktopProfile,
  type DesktopProfileStartup,
} from './profile-manager.ts'
import { DesktopProfileService } from './profile-service.ts'
import { prepareDesktopProfile, type SkippedOptionalEntry } from './profile.ts'
import type { DesktopPnpmBootstrap } from './pnpm.ts'
import {
  createDesktopExitCoordinator,
  createDesktopShutdown,
  installShutdownRequests,
  type DesktopShutdown,
} from './shutdown.ts'
import {
  diagnoseWindowsVolumes,
  formatWindowsVolumeConcern,
  type WindowsVolumeConcern,
} from './windows-volume-diagnostics.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const PRODUCT_NAME = 'DeepSeek Harness Desktop Gala'

/** Report profile recovery without changing startup or rollback outcomes. */
function notifyProfileRecovery(runtime: ElectronDesktopRuntime, body: string): void {
  try {
    runtime.updates.notify({ title: 'Unable to Open Profile', body })
  } catch (cause) {
    process.stderr.write(
      `${BIN_NAME}: failed to show profile recovery notification: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    )
  }
}

/** Report optional user UI plugins skipped to keep startup recoverable. */
function notifySkippedOptionalEntries(
  runtime: ElectronDesktopRuntime,
  entries: readonly SkippedOptionalEntry[],
): void {
  if (entries.length === 0) return
  const names = entries.map(entry => entry.name)
  const suffix = names.length > 1 ? ` and ${names.length - 1} more` : ''
  try {
    runtime.updates.notify({
      title: 'Skipped Unavailable UI Plugin',
      body: `${names[0]} is not installed in this profile${suffix}.`,
    })
  } catch (cause) {
    process.stderr.write(
      `${BIN_NAME}: failed to show skipped plugin notification: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    )
  }
}

/** Surface path/volume risks that otherwise become obscure sandbox or pnpm failures later. */
function warnWindowsVolumeConcerns(concerns: readonly WindowsVolumeConcern[]): void {
  for (const concern of concerns) {
    process.stderr.write(`${BIN_NAME}: Windows volume warning: ${formatWindowsVolumeConcern(concern)}\n`)
  }
}

/** Notify once after the UI is ready; stderr carries the exact paths. */
function notifyWindowsVolumeConcerns(
  runtime: ElectronDesktopRuntime,
  concerns: readonly WindowsVolumeConcern[],
): void {
  if (concerns.length === 0) return
  try {
    runtime.updates.notify({
      title: 'Storage May Be Unsupported',
      body: `${concerns[0]?.label ?? 'A configured path'} is on a volume that may break sandboxed commands or plugin installs.`,
    })
  } catch (cause) {
    process.stderr.write(
      `${BIN_NAME}: failed to show Windows volume warning: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    )
  }
}

/** Open the splash window; every failure degrades to a stderr note. */
function openSplashWindow(presentation: SplashPresentation): SplashController {
  return openSplash({
    open: html => {
      const window = new BrowserWindow({
        width: SPLASH_WIDTH,
        height: SPLASH_HEIGHT,
        frame: false,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      let resolveShown!: () => void
      let rejectShown!: (cause: unknown) => void
      const shown = new Promise<void>((resolve, reject) => {
        resolveShown = resolve
        rejectShown = reject
      })
      window.webContents.once('did-finish-load', () => {
        if (window.isDestroyed()) return
        window.center()
        window.setAlwaysOnTop(true, 'floating')
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        window.show()
        resolveShown()
      })
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(rejectShown)
      return {
        shown,
        close: () => {
          if (!window.isDestroyed()) window.destroy()
        },
      }
    },
  }, { presentation })
}

/** Start one Electron process and leave lifetime to the mounted desktop plugin. */
async function start(): Promise<void> {
  app.setName(PRODUCT_NAME)
  const faultLog = openDesktopFaultLog({
    logDir: app.getPath('logs'),
    version: desktopProductVersion(),
    platform: process.platform,
    homeDir: app.getPath('home'),
    bundleRoot: process.resourcesPath,
  })
  const removeFaultMonitor = installDesktopFaultMonitor(process, faultLog)
  const helperWarning = (warning: Error): void => {
    if ((warning as Error & { code?: string }).code === 'NODE_PTY_SPAWN_HELPER_MISSING') {
      faultLog.write('pty-creation-failure', warning)
    }
  }
  process.on('warning', helperWarning)
  const removeFaultObservers = (): void => {
    process.off('warning', helperWarning)
    removeFaultMonitor()
  }
  crashReporter.start({
    companyName: 'SkyNotSilent',
    productName: PRODUCT_NAME,
    uploadToServer: false,
    compress: false,
  })
  faultLog.write('process-start', undefined, { packaged: app.isPackaged })
  app.on('render-process-gone', (_event, _contents, details) => {
    faultLog.write('render-process-gone', undefined, {
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })
  app.on('child-process-gone', (_event, details) => {
    faultLog.write('child-process-gone', undefined, {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      ...(details.serviceName === undefined ? {} : { serviceName: details.serviceName }),
    })
  })
  if (!app.requestSingleInstanceLock()) {
    removeFaultObservers()
    app.quit()
    return
  }

  let current: Context | undefined
  let profileStartup: DesktopProfileStartup | undefined
  let profileStatePath: string | undefined
  let shutdown: DesktopShutdown | undefined
  let removeShutdownRequests: (() => void) | undefined
  let disposePnpmRuntime: (() => void) | undefined
  let runtime!: ElectronDesktopRuntime
  const nativeExit = createDesktopExitCoordinator(
    {
      prepareToQuit: () => { runtime.prepareToQuit() },
      relaunch: () => { app.relaunch() },
      exit: code => { app.exit(code) },
    },
    () => {
      removeShutdownRequests?.()
      removeFaultObservers()
    },
  )
  let restartRequested = false
  runtime = new ElectronDesktopRuntime(async () => {
    if (shutdown === undefined) {
      throw new Error('dsh-plugin-desktop: shutdown coordinator is not ready')
    }
    if (restartRequested) return
    restartRequested = true
    nativeExit.requestRelaunch()
    await shutdown.request(0)
  }, (report) => {
    if (profileStartup === undefined || profileStatePath === undefined) {
      throw new Error('dsh-plugin-desktop: renderer boot health arrived before profile startup')
    }
    if (report.status === 'healthy') {
      markDesktopProfileHealthy(profileStatePath, profileStartup.profileName)
      faultLog.write('renderer-healthy')
    } else {
      markDesktopProfileFailed(profileStatePath, profileStartup.profileName)
    }
  })
  const finalExit = (code: number): void => { nativeExit.finish(code) }
  shutdown = createDesktopShutdown(
    async () => {
      try {
        await current?.fiber.dispose()
      } finally {
        disposePnpmRuntime?.()
      }
    },
    finalExit,
  )
  const requestQuit = (code: number): void => { void shutdown.request(code) }
  removeShutdownRequests = installShutdownRequests(process, app, requestQuit)

  app.on('second-instance', () => { runtime.show() })
  await app.whenReady()
  let splash: SplashController = { settle: () => {} }
  if (process.platform === 'win32') app.setAppUserModelId('io.github.skynotsilent.harnessgala')
  if (app.isPackaged && process.cwd() === '/') process.chdir(app.getPath('home'))
  const homeDir = resolveDshHome()
  const windowsVolumeConcerns = diagnoseWindowsVolumes(process.platform, [
    { label: 'application install', path: process.execPath },
    { label: 'desktop user data', path: app.getPath('userData') },
    { label: 'DSH home', path: homeDir },
  ])
  warnWindowsVolumeConcerns(windowsVolumeConcerns)

  const failLoudProcess: FailLoudProcess = {
    on: (event, handler) => process.on(event, handler),
    off: (event, handler) => process.off(event, handler),
    stderr: faultLog.failLoudStderr(process.stderr),
    exit: code => {
      dialog.showErrorBox(
        'DeepSeek Harness Desktop Gala 遇到内部错误',
        `应用已安全停止。诊断日志保存在：\n${faultLog.path}`,
      )
      finalExit(code)
    },
  }
  installFailLoud(BIN_NAME, failLoudProcess, async () => {
    try {
      await current?.fiber.dispose()
    } finally {
      disposePnpmRuntime?.()
    }
  })

  try {
    const selectionStatePath = join(app.getPath('userData'), 'profile-selection', 'state.json')
    profileStatePath = selectionStatePath
    profileStartup = beginDesktopProfileStartup(selectionStatePath, homeDir)
    const activeProfileName = profileStartup.profileName
    const activeProfile = listDesktopProfiles(homeDir).find(profile => profile.name === activeProfileName)
    splash = openSplashWindow(splashPresentationFromAppearance(resolveGalaSplashAppearance({
      userDataDir: app.getPath('userData'),
      profileName: activeProfileName,
      isolatedWorkspace: activeProfile?.managedBy === 'gala',
      officialsDir: defaultOfficialsDir(),
    })))

    const environment = loadLayeredEnv(BIN_NAME, process.cwd())
    const electronVersion = process.versions.electron
    if (electronVersion === undefined) {
      throw new Error(`${BIN_NAME}: plugin runtime requires the Electron runtime version`)
    }
    const pnpmBinPath = packagedDependencyPath(import.meta.url, 'pnpm/bin/pnpm.mjs')
    const pnpmRuntime = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: process.execPath,
      pnpmBinPath,
      electronVersion,
      stateDir: join(app.getPath('userData'), 'runtime-commands'),
      environment: process.env,
    })
    const releasePnpmRuntime = (): void => { pnpmRuntime.dispose() }
    disposePnpmRuntime = releasePnpmRuntime
    if (app.isPackaged && process.platform === 'darwin') {
      const recoveredPath = recoverGuiPath({
        platform: process.platform,
        currentPath: process.env.PATH,
        appCommandDir: pnpmRuntime.pathDir,
        homeDir: app.getPath('home'),
      })
      process.env.PATH = recoveredPath.value
      faultLog.write('gui-path-recovered', undefined, {
        source: recoveredPath.source,
        added: recoveredPath.added,
      })
    }
    const prepared = prepareDesktopProfile(
      process.env.DSH_TELEMETRY_DISABLED,
      homeDir,
      process.platform,
      activeProfileName,
    )
    const desktopPnpmBootstrap: DesktopPnpmBootstrap = {
      activeProfileName,
      activeProfileDir: prepared.profile.dir,
      homeDir,
      appExecutable: process.execPath,
      pnpmBinPath,
      electronVersion,
      nodeBinDir: pnpmRuntime.nodeBinDir,
      nodeShimPath: pnpmRuntime.nodeShimPath,
      clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
      dshBootstrapPath: fileURLToPath(new URL('./desktop-cli.js', import.meta.url)),
    }
    const galaWorkspaces = createGalaWorkspaceCoordinator({
      userDataDir: app.getPath('userData'),
      homeDir,
      currentProfileName: activeProfileName,
      currentProfileDir: prepared.profile.dir,
      validateProfile: name => {
        prepareDesktopProfile(process.env.DSH_TELEMETRY_DISABLED, homeDir, process.platform, name)
      },
      selectProfile: async name => {
        selectDesktopProfile(selectionStatePath, homeDir, name)
        try {
          await runtime.requestRestart()
        } catch (cause) {
          cancelDesktopProfileSelection(selectionStatePath, name)
          throw cause
        }
      },
      restartCurrentProfile: () => runtime.requestRestart(),
    })
    const releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
    const ctx = await boot(
      BIN_NAME,
      prepared.rootConfig,
      prepared.patches,
      async (hostCtx) => {
        hostCtx.effect(
          () => releasePnpmRuntime,
          'dsh-plugin-desktop: packaged pnpm runtime PATH',
        )
        current = hostCtx
        hostCtx.effect(
          () => releasePackageResolver,
          'dsh-plugin-desktop: profile package resolution',
        )
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
        hostCtx.provide('desktopRuntime', runtime)
        hostCtx.provide('desktopPnpmBootstrap', desktopPnpmBootstrap)
        const profileDir = prepared.profile.dir
        hostCtx.provide('galaHost', createGalaHostAdapter({
          runtime,
          userDataDir: app.getPath('userData'),
          profileDir,
          packages: prepared.profile.layers.map(layer => ({
            name: layer.packageName,
            dir: layer.packageDir,
          })),
          bundles: {
            read: () => readProfileBundles(profileDir),
            write: bundles => { writeProfileBundles(profileDir, bundles) },
          },
          workspaces: galaWorkspaces,
        }))
        await hostCtx.plugin(DesktopProfileService, {
          current: {
            name: activeProfileName,
            dir: prepared.profile.dir,
          },
          list: () => listDesktopProfiles(homeDir),
          persistSelection: name => { selectDesktopProfile(selectionStatePath, homeDir, name) },
          requestRestart: () => runtime.requestRestart(),
        })
        provideCmdline(hostCtx, {
          args: ['--host', '127.0.0.1', '--port', '0', '--no-open'],
          exit: requestQuit,
        })
      },
      prepared.bareModuleBaseUrl,
    ).catch((cause: unknown) => {
      releasePackageResolver()
      throw cause
    })
    current = ctx
    runtime.configureTerminal({
      profileName: activeProfileName,
      profileDir: prepared.profile.dir,
      homeDir: prepared.homeDir,
    })
    await runtime.mountScheduled()
    splash.settle()
    await (ctx as Context & { gala: GalaService }).gala.activate().catch((cause: unknown) => {
      process.stderr.write(
        `${BIN_NAME}: gala activation disabled: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      )
    })
    notifySkippedOptionalEntries(runtime, prepared.skippedOptionalEntries)
    notifyWindowsVolumeConcerns(runtime, windowsVolumeConcerns)
    if (profileStartup.rolledBackFrom !== undefined) {
      notifyProfileRecovery(
        runtime,
        `Reopened last-known-good profile ${activeProfileName}.`,
      )
    }
  } catch (cause) {
    splash.settle()
    faultLog.write('startup-failure', cause)
    process.stderr.write(`${BIN_NAME}: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    let exitCode = 1
    if (profileStartup !== undefined && profileStatePath !== undefined) {
      const retryLastKnownGood = profileStartup.profileName !== profileStartup.state.lastKnownGood
      try {
        markDesktopProfileFailed(profileStatePath, profileStartup.profileName)
        if (retryLastKnownGood) {
          nativeExit.requestRelaunch()
          exitCode = 0
          notifyProfileRecovery(
            runtime,
            `Reopening last-known-good profile ${profileStartup.state.lastKnownGood}.`,
          )
        }
      } catch (stateCause) {
        process.stderr.write(`${BIN_NAME}: failed to roll back desktop profile state: ${stateCause instanceof Error ? stateCause.message : String(stateCause)}\n`)
      }
    }
    await shutdown.request(exitCode)
  }
}

void start()

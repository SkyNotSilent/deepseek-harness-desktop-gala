/** Electron smoke for the assembled alpha.2 renderer's real New Session button. */

import { BrowserWindow, app } from 'electron'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { healDesktopProfileModuleFallback, prepareDesktopProfile } from '../lib/profile.js'
import { DesktopProfileService } from '../lib/profile-service.js'

const BIN_NAME = 'dsh-plugin-desktop-assembled-sidebar-smoke'
const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-sidebar-'))
const workspacePath = join(home, 'assembled-workspace')
const userDataPath = join(home, 'electron-user-data')
const originalDshHome = process.env.DSH_HOME
process.env.DSH_HOME = home
mkdirSync(workspacePath, { recursive: true })
mkdirSync(userDataPath, { recursive: true })
app.setPath('userData', userDataPath)

let ctx
let window
let releasePackageResolver
let pnpmRuntime
const rendererFailures = []

process.stdout.write('verify-assembled-sidebar: Electron entry loaded\n')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForSessionRows(expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  const signal = new AbortController().signal
  while (Date.now() < deadline) {
    const listed = await ctx.sessionController.list({}, signal)
    if (listed.items.length === expected) return listed.items
    if (listed.items.length > expected) {
      throw new Error(`assembled sidebar created ${String(listed.items.length)} sessions; expected ${String(expected)}`)
    }
    await delay(100)
  }
  const listed = await ctx.sessionController.list({}, signal)
  throw new Error(`assembled sidebar timed out with ${String(listed.items.length)} session rows`)
}

function assertAlpha2ClientPackage(prepared, packageName) {
  const segments = packageName.split('/')
  const candidates = [
    join(home, 'profiles', 'node_modules', ...segments, 'package.json'),
    join(prepared.profile.dir, 'node_modules', ...segments, 'package.json'),
  ]
  for (const candidate of candidates) {
    try {
      const version = JSON.parse(readFileSync(candidate, 'utf8')).version
      if (version !== '0.1.2-alpha.2') {
        throw new Error(`${packageName} resolved to ${String(version)} instead of 0.1.2-alpha.2`)
      }
      return
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`${packageName} was not installed in the assembled profile closure`)
}

async function run() {
  await app.whenReady()
  process.stdout.write('verify-assembled-sidebar: Electron ready\n')
  if (resolveDshHome() !== home) {
    throw new Error(`DSH_HOME isolation failed: expected ${home}, received ${resolveDshHome()}`)
  }
  const platform = process.platform
  if (!['darwin', 'win32', 'linux'].includes(platform)) {
    throw new Error(`unsupported Electron platform ${platform}`)
  }
  await healDesktopProfileModuleFallback(home)
  const prepared = prepareDesktopProfile('1', home, platform)
  await healDesktopProfileModuleFallback(home, prepared.profile)
  for (const packageName of [
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-web-app',
  ]) assertAlpha2ClientPackage(prepared, packageName)
  const packageRoot = new URL('../', import.meta.url)
  const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
  const electronVersion = process.versions.electron
  if (electronVersion === undefined) throw new Error('assembled sidebar smoke requires Electron')

  pnpmRuntime = installDesktopPnpmRuntime({
    platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    electronVersion,
    stateDir: join(home, 'runtime-commands'),
    environment: process.env,
  })
  releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)

  let shellSpec
  const runtime = {
    platform,
    updates: {
      isPackaged: false,
      mode: 'manual-release',
      currentVersion: '2.2.0-preview.1',
      statePath: join(home, 'update-state.json'),
      request: async () => { throw new Error('assembled sidebar smoke must not check releases') },
      openRelease: async () => {},
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      prepareAutoUpdate: async () => false,
      downloadUpdate: async () => {},
      confirmInstall: async () => false,
      quitAndInstall() {},
      notify() {},
    },
    schedule(spec) {
      shellSpec = spec
      return async () => {}
    },
    async mountScheduled() {
      if (shellSpec === undefined) throw new Error('desktop shell was not registered')
    },
    show() {},
    registerTrayItem() {
      return { refresh() {}, dispose() {} }
    },
    openTerminal() {},
    reportRendererBoot(report) {
      if (report.status !== 'healthy') {
        throw new Error(`assembled renderer reported failure: ${JSON.stringify(report)}`)
      }
    },
    setThemeSource() {},
    async requestRestart() {},
    prepareToQuit() {},
  }

  ctx = await boot(
    BIN_NAME,
    prepared.rootConfig,
    prepared.patches,
    async (host) => {
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
      host.provide('desktopRuntime', runtime)
      host.provide('desktopPnpmBootstrap', {
        activeProfileName: 'desktop',
        activeProfileDir: prepared.profile.dir,
        homeDir: prepared.homeDir,
        appExecutable: process.execPath,
        pnpmBinPath,
        electronVersion,
        nodeBinDir: pnpmRuntime.nodeBinDir,
        nodeShimPath: pnpmRuntime.nodeShimPath,
        clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
        dshBootstrapPath: fileURLToPath(new URL('../lib/desktop-cli.js', import.meta.url)),
      })
      await host.plugin(DesktopProfileService, {
        current: { name: 'desktop', dir: prepared.profile.dir },
        list: () => [{
          name: 'desktop',
          dir: prepared.profile.dir,
          exists: true,
          bundles: prepared.profile.layers.map(layer => layer.packageName),
          webCapable: true,
        }],
        persistSelection: () => {},
        requestRestart: () => {},
      })
      provideCmdline(host, {
        args: ['--host', '127.0.0.1', '--port', '0', '--no-open'],
        exit: () => {},
      })
    },
    prepared.bareModuleBaseUrl,
  )
  await runtime.mountScheduled()

  const workspace = await ctx.workspaceController.create({ path: workspacePath })
  const first = await ctx.sessionController.create({ workspaceId: workspace.workspace.workspaceId })
  const initialRows = await waitForSessionRows(1)
  if (initialRows[0]?.sessionId !== first.sessionId || initialRows[0]?.blank !== true) {
    throw new Error(`seeded session was not one visible blank row: ${JSON.stringify(initialRows)}`)
  }

  window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 840,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.on('console-message', (details) => {
    if (details.level !== 'error') return
    rendererFailures.push(`console error: ${String(details.message)}`)
    process.stderr.write(`renderer: ${String(details.message)}\n`)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) rendererFailures.push(`load failed (${String(code)}): ${description} at ${url}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererFailures.push(`renderer process gone: ${JSON.stringify(details)}`)
  })

  const authenticated = await window.webContents.session.fetch(shellSpec.authenticationUrl, {
    method: 'GET',
    credentials: 'include',
    redirect: 'follow',
    cache: 'no-store',
  })
  if (!authenticated.ok) {
    throw new Error(`renderer authentication failed with HTTP ${String(authenticated.status)}`)
  }
  await window.loadURL(shellSpec.url)

  const clicked = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const inspect = () => {
      const workspaceVisible = (document.body.innerText || '').includes('assembled-workspace');
      const buttons = [...document.querySelectorAll('button')]
        .filter(node => /^(?:New session|新建会话)$/i.test(node.getAttribute('aria-label') || ''));
      if (workspaceVisible && buttons.length > 0) {
        buttons[buttons.length - 1].click();
        resolve({ buttonCount: buttons.length, workspaceVisible });
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('official sidebar did not become clickable: ' + JSON.stringify({
          text: (document.body.innerText || '').slice(0, 2000),
          buttons: [...document.querySelectorAll('button')].map(node => node.getAttribute('aria-label')),
          selected: [...document.querySelectorAll('[aria-selected="true"]')].map(node => (node.textContent || '').trim()),
        })));
        return;
      }
      setTimeout(inspect, 50);
    };
    inspect();
  })`)
  if (clicked?.workspaceVisible !== true || clicked.buttonCount < 1) {
    throw new Error(`official sidebar click returned an invalid receipt: ${JSON.stringify(clicked)}`)
  }

  const finalRows = await waitForSessionRows(2)
  const ids = finalRows.map(row => row.sessionId)
  if (!ids.includes(first.sessionId) || new Set(ids).size !== 2) {
    throw new Error(`official sidebar did not create a distinct Session id: ${JSON.stringify(ids)}`)
  }
  const createdId = ids.find(id => id !== first.sessionId)
  await delay(250)
  if (rendererFailures.length > 0) {
    throw new Error(`assembled renderer emitted failures: ${JSON.stringify(rendererFailures)}`)
  }
  process.stdout.write(`verify-assembled-sidebar: official alpha.2 sidebar click created ${createdId} beside ${first.sessionId}\n`)
}

async function finish(exitCode, cause) {
  if (cause !== undefined) {
    process.stderr.write(`${BIN_NAME}: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
  }
  if (window !== undefined && !window.isDestroyed()) window.destroy()
  await ctx?.fiber.dispose().catch(() => {})
  releasePackageResolver?.()
  pnpmRuntime?.dispose()
  rmSync(home, { recursive: true, force: true })
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  app.exit(exitCode)
}

void run().then(
  () => finish(0),
  cause => finish(1, cause),
)

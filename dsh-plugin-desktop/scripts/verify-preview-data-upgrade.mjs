/** Verify alpha.2 can read, append, and reopen a genuine Preview.4 data copy. */

import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN_NAME = 'dsh-plugin-desktop-preview-data-upgrade'
const fixtureRoot = fileURLToPath(new URL('../tests/fixtures/preview-2.1.0-data/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8'))
const home = mkdtempSync(join(tmpdir(), 'dsh-preview-data-upgrade-'))
const originalDshHome = process.env.DSH_HOME
process.env.DSH_HOME = home

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function treeDigest(root) {
  const files = []
  const visit = (dir, prefix = '') => {
    for (const name of readdirSync(dir).sort()) {
      const absolute = join(dir, name)
      const relative = prefix.length === 0 ? name : `${prefix}/${name}`
      const stat = statSync(absolute)
      if (stat.isDirectory()) visit(absolute, relative)
      else if (stat.isFile()) files.push([relative, sha256(readFileSync(absolute))])
      else throw new Error(`fixture contains unsupported entry ${relative}`)
    }
  }
  visit(root)
  return sha256(JSON.stringify(files))
}

function reconstructFixture() {
  for (const relative of ['storages/workspace.json', 'storages/session_projcache.json']) {
    const bytes = readFileSync(join(fixtureRoot, relative))
    if (sha256(bytes) !== manifest.files[relative]) {
      throw new Error(`Preview.4 fixture checksum mismatch for ${relative}`)
    }
    const target = join(home, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  const compressed = Buffer.from(
    readFileSync(join(fixtureRoot, 'session.jsonl.zstd.base64'), 'utf8').replaceAll(/\s/gu, ''),
    'base64',
  )
  if (sha256(compressed) !== manifest.files['session.jsonl.zstd']) {
    throw new Error('Preview.4 fixture checksum mismatch for session.jsonl.zstd')
  }
  const target = join(
    home,
    'sessions',
    manifest.sessionDirectory,
    manifest.sessionId,
    'session.jsonl.zstd',
  )
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, compressed)
}

async function bootCandidate() {
  const { boot } = await import('@deepseek-ai/dsh-app-boot')
  const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline')
  const { resolveDshHome } = await import('@deepseek-ai/dsh-home-paths')
  const {
    createLaunchEnvironmentSnapshot,
    DSH_LAUNCH_ENVIRONMENT_KEY,
  } = await import('@deepseek-ai/dsh-launch-environment')
  const { installDesktopPnpmRuntime } = await import('../lib/desktop-runtime-environment.js')
  const { installProfilePackageResolver } = await import('../lib/module-resolution.js')
  const { healDesktopProfileModuleFallback, prepareDesktopProfile } = await import('../lib/profile.js')
  const { DesktopProfileService } = await import('../lib/profile-service.js')

  if (resolveDshHome() !== home) {
    throw new Error(`DSH_HOME isolation failed: expected ${home}, received ${resolveDshHome()}`)
  }
  const platform = process.platform
  await healDesktopProfileModuleFallback(home)
  const prepared = prepareDesktopProfile('1', home, platform)
  await healDesktopProfileModuleFallback(home, prepared.profile)
  const packageRoot = new URL('../', import.meta.url)
  const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
  const electronVersion = JSON.parse(
    readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8'),
  ).version
  const pnpmRuntime = installDesktopPnpmRuntime({
    platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    electronVersion,
    stateDir: join(home, 'runtime-commands'),
    environment: process.env,
  })
  const releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
  let shellSpec
  const runtime = {
    platform,
    updates: {
      isPackaged: false,
      mode: 'manual-release',
      currentVersion: '2.2.0-preview.1',
      statePath: join(home, 'update-state.json'),
      request: async () => { throw new Error('data upgrade smoke must not check releases') },
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
    registerTrayItem() { return { refresh() {}, dispose() {} } },
    openTerminal() {},
    reportRendererBoot() {},
    setThemeSource() {},
    async requestRestart() {},
    prepareToQuit() {},
  }

  const ctx = await boot(
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
  return {
    ctx,
    async dispose() {
      await ctx.fiber.dispose()
      releasePackageResolver()
      pnpmRuntime.dispose()
    },
  }
}

const sourceDigest = treeDigest(fixtureRoot)
let candidate
try {
  reconstructFixture()
  candidate = await bootCandidate()
  const signal = new AbortController().signal
  const before = await candidate.ctx.sessionController.list({}, signal)
  const oldRow = before.items.find(row => row.sessionId === manifest.sessionId)
  if (oldRow === undefined
    || oldRow.blank !== true
    || oldRow.projections?.values.title !== null) {
    throw new Error(`alpha.2 did not cold-list the Preview.4 blank Session: ${JSON.stringify(before.items)}`)
  }
  const workspace = candidate.ctx.workspaceRegistry.get(manifest.workspaceId)
  // The original absolute workspace directory deliberately does not exist on the
  // verifier machine. Alpha.2 therefore filters its public sessionIds projection,
  // but must retain the durable Workspace identity and the separately discoverable Session.
  if (workspace?.title !== 'Preview 2.1.0 Fixture 中文'
    || !workspace.path.endsWith('/workspace with spaces 中文')) {
    throw new Error(`alpha.2 did not retain the Preview.4 Workspace projection: ${JSON.stringify(workspace)}`)
  }
  const inspected = await candidate.ctx.sessionController.inspect(manifest.sessionId, signal)
  if (inspected.meta.id !== manifest.sessionId || inspected.meta.version !== 0) {
    throw new Error(`alpha.2 returned an unexpected Preview.4 Session header: ${JSON.stringify(inspected.meta)}`)
  }

  const renamed = await candidate.ctx.sessionController.rename({
    sessionId: manifest.sessionId,
    title: 'Continued on alpha.2 中文',
  })
  if (renamed.title !== 'Continued on alpha.2 中文') {
    throw new Error(`alpha.2 rejected the continued title: ${JSON.stringify(renamed)}`)
  }
  const live = candidate.ctx.sessions.get(manifest.sessionId)
  if (live === undefined || !(await candidate.ctx.sessions.flush(live))) {
    throw new Error('alpha.2 did not durably flush the continued Preview.4 Session')
  }
  await candidate.dispose()
  candidate = undefined

  candidate = await bootCandidate()
  const reopened = await candidate.ctx.sessionController.list({}, signal)
  const reopenedRow = reopened.items.find(row => row.sessionId === manifest.sessionId)
  if (reopenedRow?.projections?.values.title !== 'Continued on alpha.2 中文'
    || reopenedRow.blank !== true) {
    throw new Error(`continued Preview.4 Session did not survive restart: ${JSON.stringify(reopened.items)}`)
  }
  const reopenedSession = await candidate.ctx.sessionController.inspect(manifest.sessionId, signal)
  if (!reopenedSession.events.some(event => (
    event.type === 'session/title'
      && event.data?.title === 'Continued on alpha.2 中文'
  ))) {
    throw new Error(`continued title event was not persisted: ${JSON.stringify(reopenedSession.events)}`)
  }
  if (treeDigest(fixtureRoot) !== sourceDigest) {
    throw new Error('read/append verification mutated the pristine Preview.4 fixture')
  }
  process.stdout.write(
    `verify-preview-data-upgrade: ${manifest.productVersion}/${manifest.runtimeVersion} data read, appended, and reopened by alpha.2\n`,
  )
} finally {
  await candidate?.dispose().catch(() => {})
  rmSync(home, { recursive: true, force: true })
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
}

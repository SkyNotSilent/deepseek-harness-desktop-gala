/** Verify alpha.2 can read, append, and reopen genuine non-blank Preview.4 data. */

import { createHash } from 'node:crypto'
import {
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
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'

const BIN_NAME = 'dsh-plugin-desktop-preview-data-upgrade'
const fixtureRoot = fileURLToPath(new URL('../tests/fixtures/preview-2.1.0-data/', import.meta.url))
const generatorPath = fileURLToPath(new URL('./generate-preview-data-fixture.mjs', import.meta.url))
const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8'))
const home = mkdtempSync(join(tmpdir(), 'dsh-preview-data-upgrade-'))
const userData = mkdtempSync(join(tmpdir(), 'dsh-preview-user-data-upgrade-'))
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

function copyFixture() {
  if (manifest.format !== 2 || manifest.expected.eventCount < 10) {
    throw new Error('Preview.4 migration fixture must be the provenance-bearing non-blank format')
  }
  if (sha256(readFileSync(generatorPath)) !== manifest.generator.sha256) {
    throw new Error('Preview.4 fixture generator checksum does not match its manifest')
  }
  for (const [relative, expectedHash] of Object.entries(manifest.files)) {
    if (relative === 'session.jsonl.zstd') continue
    const source = join(fixtureRoot, relative)
    const bytes = readFileSync(source)
    if (sha256(bytes) !== expectedHash) {
      throw new Error(`Preview.4 fixture checksum mismatch for ${relative}`)
    }
    const target = relative.startsWith('user-data/')
      ? join(userData, relative.slice('user-data/'.length))
      : join(home, relative)
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

async function bootCandidate(profileName) {
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
  const prepared = prepareDesktopProfile('1', home, platform, profileName)
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
        activeProfileName: profileName,
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
        current: { name: profileName, dir: prepared.profile.dir },
        list: () => [{
          name: profileName,
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

function requireEvent(events, type, predicate = () => true) {
  const event = events.find(value => value.type === type && predicate(value.data))
  if (event === undefined) throw new Error(`missing expected ${type} event in migrated history`)
  return event
}

function assertOldHistory(events) {
  if (events.length < manifest.expected.eventCount) {
    throw new Error(`expected at least ${manifest.expected.eventCount} old events, received ${events.length}`)
  }
  requireEvent(events, 'turn/start', data => data.turn === 1)
  requireEvent(events, 'step/start', data => data.turn === 1 && data.step === 1)
  requireEvent(events, 'user/message', data => JSON.stringify(data).includes(manifest.expected.userText))
  requireEvent(events, 'assistant/message', data => (
    JSON.stringify(data).includes('我先读取文件。')
      && JSON.stringify(data).includes(manifest.expected.toolCallId)
  ))
  requireEvent(events, 'tool/call', data => (
    data.callId === manifest.expected.toolCallId && data.name === manifest.expected.toolName
  ))
  requireEvent(events, 'tool/result', data => (
    JSON.stringify(data).includes(manifest.expected.toolResultText)
      && data.meta?.source === 'preview.4-fixture'
  ))
  requireEvent(events, 'assistant/message', data => JSON.stringify(data).includes(manifest.expected.assistantText))
  requireEvent(events, 'turn/end', data => data.turn === 1 && data.reason?.kind === 'completed')
  requireEvent(events, 'session/title', data => data.title === manifest.expected.title)
}

const sourceDigest = treeDigest(fixtureRoot)
let candidate
try {
  copyFixture()
  const { beginDesktopProfileStartup, readDesktopProfileState } = await import('../lib/profile-manager.js')
  const statePath = join(userData, 'profile-selection', 'state.json')
  const startup = beginDesktopProfileStartup(statePath, home)
  if (startup.profileName !== manifest.expected.profileName
    || startup.recoveredState
    || startup.rolledBackFrom !== undefined) {
    throw new Error(`candidate rejected old profile selection state: ${JSON.stringify(startup)}`)
  }
  if (readDesktopProfileState(statePath).lastKnownGood !== manifest.expected.profileName) {
    throw new Error('candidate did not preserve the old last-known-good profile')
  }

  candidate = await bootCandidate(startup.profileName)
  const settings = candidate.ctx.settings.get('dsh-desktop')
  if (settings?.mode !== manifest.expected.settingsMode) {
    throw new Error(`candidate did not load Preview.4 settings: ${JSON.stringify(settings)}`)
  }
  const signal = new AbortController().signal
  const before = await candidate.ctx.sessionController.list({}, signal)
  const oldRow = before.items.find(row => row.sessionId === manifest.sessionId)
  if (oldRow === undefined
    || oldRow.blank !== false
    || oldRow.projections?.values.title !== manifest.expected.title) {
    throw new Error(`alpha.2 did not cold-list the non-blank Preview.4 Session: ${JSON.stringify(before.items)}`)
  }
  const workspace = candidate.ctx.workspaceRegistry.get(manifest.workspaceId)
  if (workspace?.title !== 'Preview 2.1.0 Fixture 中文'
    || !workspace.path.endsWith('/workspace with spaces 中文')) {
    throw new Error(`alpha.2 did not retain the Preview.4 Workspace projection: ${JSON.stringify(workspace)}`)
  }
  const inspected = await candidate.ctx.sessionController.inspect(manifest.sessionId, signal)
  if (inspected.meta.id !== manifest.sessionId || inspected.meta.version !== 0) {
    throw new Error(`alpha.2 returned an unexpected Preview.4 Session header: ${JSON.stringify(inspected.meta)}`)
  }
  if (inspected.events.length !== manifest.expected.eventCount) {
    throw new Error(`cold Preview.4 event count changed: ${inspected.events.length}`)
  }
  assertOldHistory(inspected.events)
  const pristineOldEvents = JSON.stringify(inspected.events)

  await candidate.ctx.sessionController.rename({
    sessionId: manifest.sessionId,
    title: 'Continued on alpha.2 中文',
  })
  const live = candidate.ctx.sessions.get(manifest.sessionId)
  if (live === undefined || live.deriveMessages().length !== 4) {
    throw new Error(`alpha.2 did not resume the four-message Preview.4 history: ${JSON.stringify(live?.deriveMessages())}`)
  }
  live.append('turn/start', { turn: 2 })
  live.append('step/start', { turn: 2, step: 1 })
  live.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'alpha.2 继续追问 中文' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  live.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'alpha.2 已继续并持久化。' }],
      source: { provider: 'deepseek', model: 'deepseek-chat' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  live.append('step/end', { turn: 2, step: 1 })
  live.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  if (!(await candidate.ctx.sessions.flush(live))) {
    throw new Error('alpha.2 did not durably flush the continued Preview.4 Session')
  }
  // The cache's normal turn/end checkpoint is intentionally fire-and-forget.
  // Make this migration gate wait for that separate durable surface as well.
  await candidate.ctx.sessionProjectionCache.write(live)
  await candidate.dispose()
  candidate = undefined

  candidate = await bootCandidate(startup.profileName)
  const reopened = await candidate.ctx.sessionController.list({}, signal)
  const reopenedRow = reopened.items.find(row => row.sessionId === manifest.sessionId)
  if (reopenedRow?.projections?.values.title !== 'Continued on alpha.2 中文'
    || reopenedRow.blank !== false) {
    throw new Error(`continued Preview.4 Session did not survive restart: ${JSON.stringify(reopened.items)}`)
  }
  const reopenedSession = await candidate.ctx.sessionController.inspect(manifest.sessionId, signal)
  if (JSON.stringify(reopenedSession.events.slice(0, manifest.expected.eventCount)) !== pristineOldEvents) {
    throw new Error('alpha.2 changed the original Preview.4 event prefix during the in-place upgrade')
  }
  assertOldHistory(reopenedSession.events)
  requireEvent(reopenedSession.events, 'user/message', data => JSON.stringify(data).includes('alpha.2 继续追问 中文'))
  requireEvent(reopenedSession.events, 'assistant/message', data => JSON.stringify(data).includes('alpha.2 已继续并持久化。'))
  requireEvent(reopenedSession.events, 'turn/end', data => data.turn === 2 && data.reason?.kind === 'completed')
  requireEvent(reopenedSession.events, 'session/title', data => data.title === 'Continued on alpha.2 中文')
  if (candidate.ctx.settings.get('dsh-desktop')?.mode !== manifest.expected.settingsMode) {
    throw new Error('Preview.4 compatibility setting did not survive candidate restart')
  }
  if (treeDigest(fixtureRoot) !== sourceDigest) {
    throw new Error('read/append verification mutated the pristine Preview.4 fixture')
  }
  process.stdout.write(
    `verify-preview-data-upgrade: genuine ${manifest.productVersion}/${manifest.runtimeVersion} non-blank data read, appended, and reopened by alpha.2\n`,
  )
} finally {
  await candidate?.dispose().catch(() => {})
  rmSync(home, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
}

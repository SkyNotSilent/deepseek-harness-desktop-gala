/**
 * Generate the non-blank migration fixture with the genuine Preview.4/rc.2 runtime.
 *
 * This script is intentionally committed with the alpha.2 verifier, but it must be
 * copied into an exact v2.1.0-preview.4 checkout, installed immutably, built, and
 * run there. It refuses every other source revision or published package set.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { prepareDesktopProfile } from '../lib/profile.js'
import { DesktopProfileService } from '../lib/profile-service.js'
import { beginDesktopProfileStartup, markDesktopProfileHealthy } from '../lib/profile-manager.js'

const SOURCE = Object.freeze({
  tag: 'v2.1.0-preview.4',
  commit: 'a42cc4dccfeb63d45d05f3c3f8f2115fc9b7d4f8',
  tree: '04b0c8f3f4744a89999c9912488bec493bac5697',
  productVersion: '2.1.0-preview.4',
  runtimeVersion: '0.1.1-rc.2',
  registryIntegrities: {
    '@deepseek-ai/dsh-app-boot': 'sha512-eynZWb0oNPKc4OO3HPokqFfz4b5sUEq+EjqhKE2TUWsUsOTgFO43l2Ai3LibqLu6XTpYeHCTbsRLM4Aqg0deBQ==',
    '@deepseek-ai/dsh-session': 'sha512-4/cv6X9HPhm47eyRhCu/WZwzrtJKegk5J+0xaxcZ9i8S0smdxP57tqy8a0jkSshLQn7BzMFxneQrlYExrLrDhQ==',
    '@deepseek-ai/dsh-session-persistence-jsonl': 'sha512-1H+boST8tlc8fu5VVClcCRFGI18dH1EOAzfC+HsQZ+GiC7jhPN112oJWyzxKot1P07bmKdKev3un4VR2Chr/aw==',
    '@deepseek-ai/dsh-session-projection-cache': 'sha512-UvCRpIb+LoQI/nCLof17xc2P2KuZoucU3VuzfAukfsF3dYZAy5OP7jrCRdVZIvjRfvFUd7G+awdS9sWbnjcolg==',
    '@deepseek-ai/dsh-workspace': 'sha512-jBUob4H5TZAiExq9YNVCglKAFmAKMtd1UbyqFfnZZ1Owm+3c3NbAXY947MHiD6NwCwFEW1y7FjrFj66UQvG90A==',
  },
})

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function verifySource() {
  const packageRoot = fileURLToPath(new URL('../', import.meta.url))
  const product = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (product.version !== SOURCE.productVersion) {
    throw new Error(`fixture generator requires product ${SOURCE.productVersion}, received ${product.version}`)
  }
  if (git('rev-parse', 'HEAD') !== SOURCE.commit || git('rev-parse', 'HEAD^{tree}') !== SOURCE.tree) {
    throw new Error(`fixture generator requires the exact ${SOURCE.tag} source commit and tree`)
  }
  for (const [name, integrity] of Object.entries(SOURCE.registryIntegrities)) {
    const installed = JSON.parse(readFileSync(join(packageRoot, 'node_modules', name, 'package.json'), 'utf8'))
    if (installed.version !== SOURCE.runtimeVersion) {
      throw new Error(`${name} must be ${SOURCE.runtimeVersion}, received ${installed.version}`)
    }
    const result = spawnSync('npm', ['view', `${name}@${SOURCE.runtimeVersion}`, 'dist.integrity', '--json'], {
      encoding: 'utf8',
    })
    if (result.status !== 0 || JSON.parse(result.stdout) !== integrity) {
      throw new Error(`${name}@${SOURCE.runtimeVersion} registry integrity does not match the recorded source`)
    }
  }
}

verifySource()

const home = mkdtempSync(join(tmpdir(), 'dsh-preview-2.1.0-nonblank-'))
const userData = mkdtempSync(join(tmpdir(), 'dsh-preview-2.1.0-user-data-'))
const workspacePath = join(home, 'workspace with spaces 中文')
const sessionId = SessionId('session-preview-2-1-0-fixture')
process.env.DSH_HOME = home
mkdirSync(workspacePath, { recursive: true })
writeFileSync(join(home, 'settings.yaml'), [
  'agent:',
  '  model: deepseek-chat',
  'dsh-desktop:',
  '  mode: compatibility',
  '',
].join('\n'))

const prepared = prepareDesktopProfile('1', home, process.platform)
const packageRoot = new URL('../', import.meta.url)
const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
const electronVersion = JSON.parse(readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8')).version
const pnpmRuntime = installDesktopPnpmRuntime({
  platform: process.platform,
  appExecutable: process.execPath,
  pnpmBinPath,
  electronVersion,
  stateDir: join(home, 'runtime-commands'),
  environment: process.env,
})
const releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
let shellSpec
const runtime = {
  platform: process.platform,
  updates: {
    isPackaged: false,
    mode: 'manual-release',
    currentVersion: SOURCE.productVersion,
    statePath: join(home, 'update-state.json'),
    request: async () => { throw new Error('fixture generation must not check releases') },
    openRelease: async () => {},
    confirmDownload: async () => false,
    showManualCheckResult: async () => {},
    prepareAutoUpdate: async () => false,
    downloadUpdate: async () => {},
    confirmInstall: async () => false,
    quitAndInstall() {},
    notify() {},
  },
  schedule(spec) { shellSpec = spec; return async () => {} },
  async mountScheduled() { if (!shellSpec) throw new Error('desktop shell was not registered') },
  show() {},
  registerTrayItem() { return { refresh() {}, dispose() {} } },
  openTerminal() {},
  reportRendererBoot() {},
  setThemeSource() {},
  async requestRestart() {},
  prepareToQuit() {},
}

let ctx
try {
  ctx = await boot(
    'dsh-preview-2.1.0-fixture-generator',
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
      provideCmdline(host, { args: ['--host', '127.0.0.1', '--port', '0', '--no-open'], exit: () => {} })
    },
    prepared.bareModuleBaseUrl,
  )
  await runtime.mountScheduled()
  const workspace = await ctx.workspaceRegistry.create(workspacePath, 'Preview 2.1.0 Fixture 中文')
  const session = ctx.sessions.create(sessionId, { meta: { cwd: workspacePath } })
  const callId = CallId('call-preview-2-1-0-tool')
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '请读取 workspace with spaces 中文 中的 README，然后告诉我结果。' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const assistantOne = createAssistantMessage({
    content: [
      { type: 'text', text: '我先读取文件。' },
      { type: 'tool-call', id: callId, name: 'read_file', arguments: '{"path":"README 中文.md"}' },
    ],
    source: { provider: 'deepseek', model: 'deepseek-chat' },
  })
  session.append('assistant/message', { turn: 1, step: 1, message: assistantOne }, {
    surfaceOp: 'append',
    sourceEventSeqs: [],
  })
  const callSeq = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'read_file',
    arguments: '{"path":"README 中文.md"}',
  }).seq
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: '旧版工具结果：migration fixture ok 中文' }],
      isError: false,
    }),
    meta: { path: 'README 中文.md', source: 'preview.4-fixture' },
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: '读取完成：migration fixture ok 中文。' }],
      source: { provider: 'deepseek', model: 'deepseek-chat' },
    }),
    usage: { inputTokens: 23, outputTokens: 11 },
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  ctx.sessionTitle.rename(session, 'Preview 2.1.0 历史对话')
  if (!(await ctx.sessions.flush(session))) throw new Error('rc.2 persistence listener did not flush')
  await workspace.attachSession(session.id)
  const statePath = join(userData, 'profile-selection', 'state.json')
  const startup = beginDesktopProfileStartup(statePath, home)
  markDesktopProfileHealthy(statePath, startup.profileName)
  const location = ctx.sessionPersistence.locate(session.header)
  process.stdout.write(`${JSON.stringify({
    source: SOURCE,
    home,
    userData,
    statePath,
    workspaceId: workspace.id,
    sessionId: session.id,
    sessionPath: location?.path,
    eventCount: session.events.length,
    messages: session.deriveMessages(),
  }, null, 2)}\n`)
} finally {
  await ctx?.fiber.dispose()
  releasePackageResolver()
  pnpmRuntime.dispose()
}

/** Execute real Bash PTY, Node, pnpm, and short-build probes through the packaged Electron runtime. */

import { spawnSync } from 'node:child_process'
import {
  accessSync,
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  DesktopPnpmRuntimeInstallation,
  DesktopPnpmRuntimeOptions,
} from '../src/desktop-runtime-environment.ts'
import { resolveDesktopRunAsNodeExecutable } from '../src/desktop-runtime-environment.ts'

const SUCCESS_MARKER = '__dsh_packaged_pty_ok__'
export const PACKAGED_PTY_TIMEOUT_MS = 30_000
export const PACKAGED_COMMAND_TIMEOUT_MS = 20_000
export const MAC_SMOKE_TIMEOUT_MS = PACKAGED_PTY_TIMEOUT_MS

/** Injectable process and filesystem boundary for focused tests. */
export interface MacSmokeOptions {
  makeWorkDir(): string
  makeDirectory(path: string): void
  listExecutables(directory: string): readonly string[]
  link(target: string, path: string): void
  run(
    executable: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
    logStem: string,
    cwd?: string,
  ): {
    status: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
    error?: Error
  }
  readText(path: string): string
  writeText(path: string, contents: string): void
  installRuntime(
    modulePath: string,
    options: DesktopPnpmRuntimeOptions,
  ): Promise<DesktopPnpmRuntimeInstallation>
  remove(path: string): void
}

export const PACKAGED_PTY_PROBE = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = process.env.DSH_PTY_SMOKE_ROOT;
if (!root) throw new Error('missing DSH_PTY_SMOKE_ROOT');
const request = createRequire(path.join(root, 'probe.cjs'));
const packagePath = request.resolve('node-pty/package.json');
const realPackagePath = fs.realpathSync(packagePath);
if (!realPackagePath.includes('app.asar.unpacked')) {
  throw new Error('node-pty did not resolve through app.asar.unpacked: ' + realPackagePath);
}
const pty = request('node-pty');
let output = '';
console.error('packaged smoke phase: bash PTY');
const timer = setTimeout(() => {
  console.error('packaged PTY smoke timed out');
  process.exit(4);
}, ${PACKAGED_PTY_TIMEOUT_MS});
const terminal = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-c', 'printf ${SUCCESS_MARKER}'], {
  cwd: root,
  env: { PATH: '/usr/bin:/bin', HOME: root },
  cols: 80,
  rows: 24,
});
terminal.onData(chunk => { output += chunk; });
terminal.onExit(({ exitCode }) => {
  clearTimeout(timer);
  if (exitCode !== 0 || !output.includes('${SUCCESS_MARKER}')) {
    console.error(JSON.stringify({ exitCode, output }));
    process.exit(5);
  }
  console.log('${SUCCESS_MARKER}' + JSON.stringify({
    node: process.version,
    electron: process.versions.electron,
  }));
  process.exit(0);
});
`

/**
 * Run a packaged executable without stdout/stderr pipes. Electron helpers such as crashpad can
 * inherit a pipe and keep it open after the RunAsNode parent exits; regular files preserve all
 * diagnostics without making completion depend on descendant EOF.
 */
export function runFileBackedProcess(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  logDirectory: string,
  logStem = 'packaged-smoke',
  cwd?: string,
): ReturnType<MacSmokeOptions['run']> {
  const stdoutPath = join(logDirectory, `${logStem}.stdout.log`)
  const stderrPath = join(logDirectory, `${logStem}.stderr.log`)
  const stdoutFd = openSync(stdoutPath, 'wx', 0o600)
  const stderrFd = openSync(stderrPath, 'wx', 0o600)
  let result: ReturnType<typeof spawnSync>
  try {
    result = spawnSync(executable, args, {
      env,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      stdio: ['ignore', stdoutFd, stderrFd],
      ...(cwd === undefined ? {} : { cwd }),
    })
  } finally {
    closeSync(stdoutFd)
    closeSync(stderrFd)
  }
  return {
    status: result.status,
    signal: result.signal,
    stdout: readFileSync(stdoutPath, 'utf8'),
    stderr: readFileSync(stderrPath, 'utf8'),
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

function defaultOptions(): MacSmokeOptions {
  return {
    makeWorkDir: () => mkdtempSync(join(tmpdir(), 'dsh-pty-smoke-')),
    makeDirectory: path => mkdirSync(path, { recursive: true, mode: 0o700 }),
    listExecutables: directory => readdirSync(directory)
      .map(name => join(directory, name))
      .filter(path => {
        if (!lstatSync(path).isFile()) return false
        try {
          accessSync(path, constants.X_OK)
          return true
        } catch {
          return false
        }
      }),
    link: (target, path) => symlinkSync(target, path, 'dir'),
    run(executable, args, env, timeoutMs, logStem, cwd) {
      const logDirectory = env.DSH_PTY_SMOKE_ROOT
      if (logDirectory === undefined) {
        throw new Error('packaged macOS PTY smoke is missing its log directory')
      }
      return runFileBackedProcess(executable, args, env, timeoutMs, logDirectory, logStem, cwd)
    },
    readText: path => readFileSync(path, 'utf8'),
    writeText: (path, contents) => writeFileSync(path, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 }),
    async installRuntime(modulePath, options) {
      const runtime = await import(pathToFileURL(modulePath).href) as {
        installDesktopPnpmRuntime(value: DesktopPnpmRuntimeOptions): DesktopPnpmRuntimeInstallation
      }
      return runtime.installDesktopPnpmRuntime(options)
    },
    remove: path => rmSync(path, { force: true, recursive: true }),
  }
}

interface PackagedRuntimeVersions {
  node: string
  electron: string
}

/** Read the Node and Electron versions reported by the exact packaged executable. */
function parseRuntimeVersions(stdout: string): PackagedRuntimeVersions {
  const line = stdout.split(/\r?\n/gu).find(value => value.startsWith(SUCCESS_MARKER))
  if (line === undefined) throw new Error('packaged PTY smoke did not report runtime versions')
  const parsed = JSON.parse(line.slice(SUCCESS_MARKER.length)) as Partial<PackagedRuntimeVersions>
  if (typeof parsed.node !== 'string' || typeof parsed.electron !== 'string') {
    throw new Error(`packaged PTY smoke reported invalid runtime versions: ${JSON.stringify(parsed)}`)
  }
  return { node: parsed.node, electron: parsed.electron }
}

/** Require one packaged command to exit successfully with the exact expected stdout. */
function assertCommand(
  label: string,
  result: ReturnType<MacSmokeOptions['run']>,
  expected: string,
): void {
  if (result.error !== undefined || result.status !== 0 || result.stdout.trim() !== expected) {
    throw new Error(`${label} failed: ${JSON.stringify({
      expected,
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdout: result.stdout,
      stderr: result.stderr,
    })}`)
  }
}

/** Verify one packaged macOS application with its real PTY and bundled command runtime. */
export async function verifyMacSmoke(appPath: string, options: MacSmokeOptions = defaultOptions()): Promise<void> {
  const absoluteApp = resolve(appPath)
  const executableDirectory = join(absoluteApp, 'Contents', 'MacOS')
  const executables = options.listExecutables(executableDirectory)
  if (executables.length !== 1) {
    throw new Error(`macOS PTY smoke requires exactly one app executable in ${executableDirectory}; found ${String(executables.length)}`)
  }
  const nodePty = join(
    absoluteApp,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
  )
  const workDir = options.makeWorkDir()
  let installation: DesktopPnpmRuntimeInstallation | undefined
  try {
    const modules = join(workDir, 'node_modules')
    options.makeDirectory(modules)
    options.link(nodePty, join(modules, 'node-pty'))
    const executable = executables[0]!
    const unpackedRoot = join(absoluteApp, 'Contents', 'Resources', 'app.asar.unpacked')
    const smokeEnvironment = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_PTY_SMOKE_ROOT: workDir,
    }
    const result = options.run(
      executable,
      ['-e', PACKAGED_PTY_PROBE],
      smokeEnvironment,
      MAC_SMOKE_TIMEOUT_MS,
      'packaged-pty',
    )
    if (result.error !== undefined || result.status !== 0 || !result.stdout.includes(SUCCESS_MARKER)) {
      const tail = `${result.stdout}\n${result.stderr}`.slice(-8_000)
      throw new Error(
        `packaged macOS PTY smoke failed for ${basename(absoluteApp)}: status=${String(result.status)} signal=${String(result.signal)}${result.error === undefined ? '' : ` error=${result.error.message}`}\n${tail}`,
      )
    }
    const runtimeVersions = parseRuntimeVersions(result.stdout)

    const runAsNodeExecutable = resolveDesktopRunAsNodeExecutable('darwin', executable)
    const pnpmBinPath = join(unpackedRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    const pnpmPackage = JSON.parse(options.readText(
      join(unpackedRoot, 'node_modules', 'pnpm', 'package.json'),
    )) as { version?: unknown }
    if (typeof pnpmPackage.version !== 'string') {
      throw new Error('packaged pnpm manifest does not contain a string version')
    }
    const commandEnvironment = {
      ...process.env,
      DSH_PTY_SMOKE_ROOT: workDir,
      // Force pnpm's process.execPath self-spawn path on every machine instead of relying on
      // machine-specific dependency state to decide whether the pre-run install is needed.
      pnpm_config_verify_deps_before_run: 'install',
    }
    installation = await options.installRuntime(
      join(unpackedRoot, 'lib', 'desktop-runtime-environment.js'),
      {
        platform: process.platform,
        appExecutable: runAsNodeExecutable,
        pnpmBinPath,
        electronVersion: runtimeVersions.electron,
        stateDir: join(workDir, 'runtime-commands'),
        environment: commandEnvironment,
      },
    )

    const nodeVersion = options.run(
      'node',
      ['--version'],
      commandEnvironment,
      PACKAGED_COMMAND_TIMEOUT_MS,
      'node-version',
      workDir,
    )
    assertCommand('packaged node', nodeVersion, runtimeVersions.node)
    const packagedPnpm = options.run(
      'pnpm',
      ['--version'],
      commandEnvironment,
      PACKAGED_COMMAND_TIMEOUT_MS,
      'pnpm-version',
      workDir,
    )
    assertCommand('packaged pnpm', packagedPnpm, pnpmPackage.version)

    const project = join(workDir, 'short-process-build')
    options.makeDirectory(project)
    options.writeText(join(project, 'package.json'), `${JSON.stringify({
      name: 'dsh-packaged-short-process-smoke',
      version: '0.0.0',
      private: true,
      scripts: { build: 'node build.mjs' },
    })}\n`)
    options.writeText(join(project, 'build.mjs'), [
      "import { writeFileSync } from 'node:fs'",
      "writeFileSync(new URL('built.json', import.meta.url), JSON.stringify({",
      '  node: process.version,',
      "  runnerEnvironment: Object.keys(process.env).filter(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),",
      '}))',
      '',
    ].join('\n'))
    const built = options.run(
      'pnpm',
      ['run', 'build'],
      commandEnvironment,
      PACKAGED_COMMAND_TIMEOUT_MS,
      'short-build',
      project,
    )
    if (built.error !== undefined || built.status !== 0) {
      throw new Error(`packaged short-process build failed: ${JSON.stringify({
        status: built.status,
        signal: built.signal,
        error: built.error?.message,
        stdout: built.stdout,
        stderr: built.stderr,
      })}`)
    }
    const receipt = JSON.parse(options.readText(join(project, 'built.json'))) as {
      node?: unknown
      runnerEnvironment?: unknown
    }
    if (
      receipt.node !== runtimeVersions.node
      || !Array.isArray(receipt.runnerEnvironment)
      || receipt.runnerEnvironment.length !== 0
    ) {
      throw new Error(`packaged short-process build returned an invalid environment: ${JSON.stringify(receipt)}`)
    }
  } finally {
    installation?.dispose()
    options.remove(workDir)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const appPath = process.argv[2]
  if (appPath === undefined) {
    console.error('usage: verify-mac-smoke.ts <path-to-app>')
    process.exitCode = 2
  } else {
    try {
      await verifyMacSmoke(appPath)
      console.log(`macOS packaged PTY, Node, pnpm, and short-process build smoke passed: ${appPath}`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}

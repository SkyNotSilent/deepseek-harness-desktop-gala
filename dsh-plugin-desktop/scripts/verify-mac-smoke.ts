/** Execute real Bash PTY, Node, pnpm, and short-build probes through the packaged Electron runtime. */

import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUCCESS_MARKER = '__dsh_packaged_pty_ok__'
export const PACKAGED_PTY_TIMEOUT_MS = 30_000
export const PACKAGED_COMMAND_TIMEOUT_MS = 20_000
export const MAC_SMOKE_TIMEOUT_MS = 120_000

/** Injectable process and filesystem boundary for focused tests. */
export interface MacSmokeOptions {
  makeWorkDir(): string
  makeDirectory(path: string): void
  listExecutables(directory: string): readonly string[]
  link(target: string, path: string): void
  run(executable: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): {
    status: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
    error?: Error
  }
  remove(path: string): void
}

export const PACKAGED_PTY_PROBE = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = process.env.DSH_PTY_SMOKE_ROOT;
if (!root) throw new Error('missing DSH_PTY_SMOKE_ROOT');
const unpackedRoot = process.env.DSH_PACKAGED_UNPACKED_ROOT;
if (!unpackedRoot) throw new Error('missing DSH_PACKAGED_UNPACKED_ROOT');
const request = createRequire(path.join(root, 'probe.cjs'));
const packagePath = request.resolve('node-pty/package.json');
const realPackagePath = fs.realpathSync(packagePath);
if (!realPackagePath.includes('app.asar.unpacked')) {
  throw new Error('node-pty did not resolve through app.asar.unpacked: ' + realPackagePath);
}
const pty = request('node-pty');
let output = '';
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
  void verifyPackagedCommands().then(() => {
    console.log('${SUCCESS_MARKER}');
    process.exit(0);
  }, error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(6);
  });
});

async function verifyPackagedCommands() {
  const runtimePath = path.join(unpackedRoot, 'lib', 'desktop-runtime-environment.js');
  const { installDesktopPnpmRuntime } = await import(pathToFileURL(runtimePath).href);
  const pnpmBinPath = path.join(unpackedRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  const pnpmVersion = JSON.parse(fs.readFileSync(
    path.join(unpackedRoot, 'node_modules', 'pnpm', 'package.json'),
    'utf8',
  )).version;
  const environment = { ...process.env };
  const installation = installDesktopPnpmRuntime({
    platform: process.platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    electronVersion: process.versions.electron,
    stateDir: path.join(root, 'runtime-commands'),
    environment,
  });
  try {
    const nodeVersion = spawnSync('node', ['--version'], {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      timeout: ${PACKAGED_COMMAND_TIMEOUT_MS},
    });
    assertCommand('packaged node', nodeVersion, process.version);
    const packagedPnpm = spawnSync('pnpm', ['--version'], {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      timeout: ${PACKAGED_COMMAND_TIMEOUT_MS},
    });
    assertCommand('packaged pnpm', packagedPnpm, pnpmVersion);

    const project = path.join(root, 'short-process-build');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
      name: 'dsh-packaged-short-process-smoke',
      version: '0.0.0',
      private: true,
      scripts: { build: 'node build.mjs' },
    }) + '\n');
    fs.writeFileSync(path.join(project, 'build.mjs'), [
      "import { writeFileSync } from 'node:fs'",
      "writeFileSync(new URL('built.json', import.meta.url), JSON.stringify({",
      "  node: process.version,",
      "  runnerEnvironment: Object.keys(process.env).filter(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),",
      '}))',
      '',
    ].join('\n'));
    const built = spawnSync('pnpm', ['run', 'build'], {
      cwd: project,
      env: environment,
      encoding: 'utf8',
      timeout: ${PACKAGED_COMMAND_TIMEOUT_MS},
    });
    if (built.error || built.status !== 0) {
      throw new Error('packaged short-process build failed: ' + JSON.stringify({
        status: built.status,
        signal: built.signal,
        error: built.error && built.error.message,
        stdout: built.stdout,
        stderr: built.stderr,
      }));
    }
    const receipt = JSON.parse(fs.readFileSync(path.join(project, 'built.json'), 'utf8'));
    if (receipt.node !== process.version || receipt.runnerEnvironment.length !== 0) {
      throw new Error('packaged short-process build returned an invalid environment: ' + JSON.stringify(receipt));
    }
  } finally {
    installation.dispose();
  }
}

function assertCommand(label, result, expected) {
  if (result.error || result.status !== 0 || result.stdout.trim() !== expected) {
    throw new Error(label + ' failed: ' + JSON.stringify({
      expected,
      status: result.status,
      signal: result.signal,
      error: result.error && result.error.message,
      stdout: result.stdout,
      stderr: result.stderr,
    }));
  }
}
`

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
    run(executable, args, env, timeoutMs) {
      const result = spawnSync(executable, args, {
        encoding: 'utf8',
        env,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
      })
      return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        ...(result.error === undefined ? {} : { error: result.error }),
      }
    },
    remove: path => rmSync(path, { force: true, recursive: true }),
  }
}

/** Verify one packaged macOS application with its real PTY and bundled command runtime. */
export function verifyMacSmoke(appPath: string, options: MacSmokeOptions = defaultOptions()): void {
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
  try {
    const modules = join(workDir, 'node_modules')
    options.makeDirectory(modules)
    options.link(nodePty, join(modules, 'node-pty'))
    const result = options.run(executables[0]!, ['-e', PACKAGED_PTY_PROBE], {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_PACKAGED_UNPACKED_ROOT: join(
        absoluteApp,
        'Contents',
        'Resources',
        'app.asar.unpacked',
      ),
      DSH_PTY_SMOKE_ROOT: workDir,
    }, MAC_SMOKE_TIMEOUT_MS)
    if (result.error !== undefined || result.status !== 0 || !result.stdout.includes(SUCCESS_MARKER)) {
      const tail = `${result.stdout}\n${result.stderr}`.slice(-8_000)
      throw new Error(
        `packaged macOS PTY smoke failed for ${basename(absoluteApp)}: status=${String(result.status)} signal=${String(result.signal)}${result.error === undefined ? '' : ` error=${result.error.message}`}\n${tail}`,
      )
    }
  } finally {
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
      verifyMacSmoke(appPath)
      console.log(`macOS packaged PTY, Node, pnpm, and short-process build smoke passed: ${appPath}`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}

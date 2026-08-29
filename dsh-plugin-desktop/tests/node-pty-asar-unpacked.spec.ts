import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

function fixture(): { profileRoot: string; copiedPackage: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-node-pty-asar-'))
  temporaryDirectories.push(root)
  const copiedPackage = join(root, 'DeepSeek.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty')
  mkdirSync(dirname(copiedPackage), { recursive: true })
  cpSync(join(process.cwd(), 'node_modules/node-pty'), copiedPackage, { recursive: true })
  const profileRoot = join(root, 'profile')
  mkdirSync(join(profileRoot, 'node_modules'), { recursive: true })
  symlinkSync(copiedPackage, join(profileRoot, 'node_modules/node-pty'), 'dir')
  return { profileRoot, copiedPackage }
}

function probe(profileRoot: string, source: string) {
  return spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    cwd: profileRoot,
    timeout: 10_000,
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe.runIf(process.platform === 'darwin')('node-pty app.asar.unpacked regression', () => {
  it('starts Bash through the same profile dependency symlink as the packaged application', () => {
    const { profileRoot } = fixture()
    const result = probe(profileRoot, String.raw`
const { createRequire } = require('node:module');
const path = require('node:path');
const request = createRequire(path.join(process.cwd(), 'probe.cjs'));
const pty = request('node-pty');
let output = '';
const timer = setTimeout(() => process.exit(4), 5000);
const terminal = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-c', 'printf __pty_symlink_ok__'], {
  cwd: process.cwd(), env: { PATH: '/usr/bin:/bin', HOME: process.cwd() }, cols: 80, rows: 24,
});
terminal.onData(chunk => { output += chunk; });
terminal.onExit(({ exitCode }) => {
  clearTimeout(timer);
  if (exitCode !== 0 || !output.includes('__pty_symlink_ok__')) process.exit(5);
  process.stdout.write('__pty_symlink_ok__');
});
`)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('__pty_symlink_ok__')
  })

  it('returns a readable JavaScript error and remains alive after a missing helper', () => {
    const { profileRoot, copiedPackage } = fixture()
    for (const helper of [
      join(copiedPackage, `prebuilds/darwin-${process.arch}/spawn-helper`),
      join(copiedPackage, 'build/Release/spawn-helper'),
    ]) {
      if (existsSync(helper)) unlinkSync(helper)
    }
    const result = probe(profileRoot, String.raw`
const { createRequire } = require('node:module');
const path = require('node:path');
const request = createRequire(path.join(process.cwd(), 'probe.cjs'));
try {
  request('node-pty').spawn('/bin/bash', ['--noprofile', '--norc', '-c', 'true'], {
    cwd: process.cwd(), env: { PATH: '/usr/bin:/bin', HOME: process.cwd() }, cols: 80, rows: 24,
  });
  process.exit(6);
} catch (error) {
  if (!String(error).includes('node-pty: spawn-helper not found at')) process.exit(7);
  setTimeout(() => { process.stdout.write('__readable_helper_error__'); process.exit(0); }, 750);
}
`)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stdout).toContain('__readable_helper_error__')
  })
})

/** Structural verification for the native PTY runtime emitted by Electron Builder. */

import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Filesystem probes used by focused tests. */
export interface PackagedNodePtyProbes {
  exists(path: string): boolean
  executable(path: string): boolean
  read(path: string): string
}

const defaultProbes: PackagedNodePtyProbes = {
  exists: existsSync,
  executable(path) {
    try {
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  read: path => readFileSync(path, 'utf8'),
}

function requireFile(path: string, probes: PackagedNodePtyProbes): void {
  if (!probes.exists(path)) {
    throw new Error(`dsh-plugin-desktop: packaged node-pty is missing ${path}`)
  }
}

function requireHelper(path: string, probes: PackagedNodePtyProbes): void {
  requireFile(path, probes)
  if (!probes.executable(path)) {
    throw new Error(`dsh-plugin-desktop: packaged node-pty spawn-helper is not executable: ${path}`)
  }
}

/**
 * Verify the patch and native files selected by node-pty's loader.
 * macOS uses spawn-helper; Linux uses forkpty and therefore has no helper in its prebuild.
 */
export function verifyPackagedNodePty(
  unpackedRoot: string,
  platform: string,
  arch: string,
  probes: PackagedNodePtyProbes = defaultProbes,
): void {
  if (platform !== 'darwin' && platform !== 'linux') return
  const packageRoot = join(unpackedRoot, 'node_modules', 'node-pty')
  const unixTerminal = join(packageRoot, 'lib', 'unixTerminal.js')
  requireFile(unixTerminal, probes)
  const source = probes.read(unixTerminal)
  for (const marker of [
    "!helperPath.includes('app.asar.unpacked')",
    "!helperPath.includes('node_modules.asar.unpacked')",
    'node-pty: spawn-helper not found at',
    'NODE_PTY_SPAWN_HELPER_MISSING',
  ]) {
    if (!source.includes(marker)) {
      throw new Error(`dsh-plugin-desktop: packaged node-pty patch marker is missing: ${marker}`)
    }
  }

  const prebuild = join(packageRoot, 'prebuilds', `${platform}-${arch}`)
  requireFile(join(prebuild, 'pty.node'), probes)
  if (platform === 'darwin') requireHelper(join(prebuild, 'spawn-helper'), probes)

  const rebuilt = join(packageRoot, 'build', 'Release')
  if (probes.exists(join(rebuilt, 'pty.node'))) {
    if (platform === 'darwin') requireHelper(join(rebuilt, 'spawn-helper'), probes)
  }
}

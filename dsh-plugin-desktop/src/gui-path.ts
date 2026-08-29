/** Recover the useful command PATH missing from Finder-launched macOS applications. */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Injectable filesystem boundary for deterministic PATH tests. */
export interface GuiPathFilesystem {
  read(path: string): string | undefined
  list(path: string): readonly string[]
  isDirectory(path: string): boolean
}

/** Inputs used to build one stable desktop process PATH. */
export interface RecoverGuiPathOptions {
  platform: NodeJS.Platform
  currentPath: string | undefined
  appCommandDir: string
  homeDir: string
  filesystem?: GuiPathFilesystem
}

/** PATH recovery result without exposing the complete value to diagnostics. */
export interface RecoveredGuiPath {
  value: string
  added: number
  source: 'macos-system-paths' | 'unchanged'
}

const defaultFilesystem: GuiPathFilesystem = {
  read(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
  list(path) {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right, 'en'))
    } catch {
      return []
    }
  },
  isDirectory(path) {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
}

function pathLines(value: string | undefined): string[] {
  if (value === undefined) return []
  return value
    .split(/\r?\n/u)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0 && !entry.includes('\0'))
}

function uniquePath(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    if (entry.length === 0 || seen.has(entry)) continue
    seen.add(entry)
    result.push(entry)
  }
  return result
}

/**
 * Recover macOS GUI command paths without executing a login shell or user rc file.
 * Existing inherited entries are preserved even when temporarily unavailable.
 */
export function recoverGuiPath(options: RecoverGuiPathOptions): RecoveredGuiPath {
  const inherited = (options.currentPath ?? '').split(':').filter(Boolean)
  const base = uniquePath([options.appCommandDir, ...inherited])
  if (options.platform !== 'darwin') {
    return { value: base.join(':'), added: Math.max(0, base.length - uniquePath(inherited).length), source: 'unchanged' }
  }

  const fs = options.filesystem ?? defaultFilesystem
  const configured = [
    ...pathLines(fs.read('/etc/paths')),
    ...[...fs.list('/etc/paths.d')]
      .sort((left, right) => left.localeCompare(right, 'en'))
      .flatMap(name => pathLines(fs.read(join('/etc/paths.d', name)))),
  ]
  const standard = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    join(options.homeDir, '.local/bin'),
    join(options.homeDir, '.cargo/bin'),
  ].filter(path => fs.isDirectory(path))
  const merged = uniquePath([...base, ...configured, ...standard])
  return {
    value: merged.join(':'),
    added: Math.max(0, merged.length - base.length),
    source: 'macos-system-paths',
  }
}

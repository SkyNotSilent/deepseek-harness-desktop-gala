/** Bounded, local-only desktop fault diagnostics. */

import {
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 2 * 1024 * 1024
const MAX_DIAGNOSTIC_CHARS = 12_000
const SENSITIVE_ASSIGNMENT = /\b([A-Z0-9_]*(?:KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*)\s*[=:]\s*([^\s,;]+)/giu
const BEARER_VALUE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu

/** Filesystem calls used by the logger, injectable for failure-path tests. */
export interface DesktopFaultFilesystem {
  mkdir(path: string): void
  size(path: string): number | undefined
  append(path: string, value: string): void
  replace(previous: string, next: string): void
}

/** One bounded local diagnostics sink. */
export interface DesktopFaultLog {
  readonly path: string
  write(event: string, cause?: unknown, details?: Readonly<Record<string, string | number | boolean>>): void
  failLoudStderr(delegate: { write(chunk: string): unknown }): { write(chunk: string): unknown }
}

/** Inputs used to create a process-lifetime diagnostics sink. */
export interface DesktopFaultLogOptions {
  logDir: string
  version: string
  platform: NodeJS.Platform
  homeDir: string
  /** Physical application resources root replaced with a bundle-relative marker. */
  bundleRoot?: string
  filesystem?: DesktopFaultFilesystem
  now?: () => Date
}

const defaultFilesystem: DesktopFaultFilesystem = {
  mkdir(path) {
    mkdirSync(path, { mode: 0o700, recursive: true })
  },
  size(path) {
    try {
      return statSync(path).size
    } catch {
      return undefined
    }
  },
  append(path, value) {
    appendFileSync(path, value, { encoding: 'utf8', mode: 0o600 })
  },
  replace(previous, next) {
    rmSync(next, { force: true })
    renameSync(previous, next)
  },
}

function redacted(value: string, homeDir: string, bundleRoot?: string): string {
  const bundle = bundleRoot === undefined || bundleRoot.length === 0
    ? value
    : value.replaceAll(bundleRoot, '<bundle>')
  const home = homeDir.length === 0 ? bundle : bundle.replaceAll(homeDir, '~')
  return home
    .replace(SENSITIVE_ASSIGNMENT, '$1=[REDACTED]')
    .replace(BEARER_VALUE, '$1[REDACTED]')
    .slice(0, MAX_DIAGNOSTIC_CHARS)
}

function diagnostic(cause: unknown, homeDir: string, bundleRoot?: string): string | undefined {
  if (cause === undefined) return undefined
  if (cause instanceof Error) return redacted(cause.stack ?? `${cause.name}: ${cause.message}`, homeDir, bundleRoot)
  if (typeof cause === 'string') return redacted(cause, homeDir, bundleRoot)
  return redacted(Object.prototype.toString.call(cause), homeDir, bundleRoot)
}

function failLoudSummary(chunk: string): string {
  const lines = chunk.split(/\r?\n/u)
  const first = lines[0]?.slice(0, 600) ?? 'fatal load failure'
  const stack = lines.filter(line => /^\s*at\s/u.test(line)).slice(0, 12)
  return [first, ...stack].join('\n')
}

/** Open a two-file rotating log. All filesystem failures intentionally degrade to no logging. */
export function openDesktopFaultLog(options: DesktopFaultLogOptions): DesktopFaultLog {
  const fs = options.filesystem ?? defaultFilesystem
  const now = options.now ?? (() => new Date())
  const path = join(options.logDir, 'main.log')
  const previous = `${path}.1`
  try {
    fs.mkdir(options.logDir)
  } catch {}

  const write = (
    event: string,
    cause?: unknown,
    details: Readonly<Record<string, string | number | boolean>> = {},
  ): void => {
    const error = diagnostic(cause, options.homeDir, options.bundleRoot)
    const entry = `${JSON.stringify({
      time: now().toISOString(),
      event,
      version: options.version,
      platform: options.platform,
      processType: 'main',
      ...details,
      ...(error === undefined ? {} : { diagnostic: error }),
    })}\n`
    try {
      const size = fs.size(path)
      if (size !== undefined && size + Buffer.byteLength(entry) > MAX_LOG_BYTES) {
        fs.replace(path, previous)
      }
      fs.append(path, entry)
    } catch {}
  }

  return {
    path,
    write,
    failLoudStderr: delegate => ({
      write(chunk) {
        write('unhandled-rejection', failLoudSummary(chunk))
        return delegate.write(chunk)
      },
    }),
  }
}

/** Register fault observation without changing Node's fatal exception semantics. */
export function installDesktopFaultMonitor(
  proc: Pick<NodeJS.Process, 'on' | 'off'>,
  log: DesktopFaultLog,
): () => void {
  const monitor = (cause: unknown): void => { log.write('uncaught-exception', cause) }
  proc.on('uncaughtExceptionMonitor', monitor)
  return () => { proc.off('uncaughtExceptionMonitor', monitor) }
}

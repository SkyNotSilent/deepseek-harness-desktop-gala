/** Headless version checks against the public GitHub Releases API. */

export const GITHUB_OWNER = 'SkyNotSilent'
export const GITHUB_REPOSITORY = 'deepseek-harness-desktop-gala'
export const DESKTOP_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases`
export const DESKTOP_VERSION_ENDPOINT = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases?per_page=5`

/** Maximum response body bytes accepted from the version service. */
export const MAX_VERSION_RESPONSE_BYTES = 1024 * 1024

/** Strictly parsed SemVer components. Numeric components remain strings to avoid overflow. */
export interface ParsedSemVer {
  /** Canonical version without the optional leading `v`. */
  readonly version: string
  /** Major numeric identifier. */
  readonly major: string
  /** Minor numeric identifier. */
  readonly minor: string
  /** Patch numeric identifier. */
  readonly patch: string
  /** Ordered prerelease identifiers, or an empty list for a stable version. */
  readonly prerelease: readonly string[]
  /** Build identifiers, ignored for version precedence. */
  readonly build: readonly string[]
}

/** Fetch-compatible request function used by the headless checker. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one stable version check. */
export interface UpdateCheckOptions {
  /** Installed application version, expressed as canonical stable SemVer. */
  readonly currentVersion: string
  /** Caller-owned cancellation signal; the checker does not create its own timeout. */
  readonly signal?: AbortSignal
  /** Optional fetch implementation for a host adapter or test. */
  readonly request?: UpdateRequest
}

/** Successful comparison returned by the stable version service. */
interface UpdateCheckBase {
  /** Whether the service reports a version newer than the installed application. */
  /** Canonical installed stable version. */
  readonly currentVersion: string
  /** Canonical latest stable version returned by the service. */
  readonly latestVersion: string
  /** Public browser URL for this exact GitHub Release. */
  readonly releaseUrl: string
}

export type UpdateCheckResult =
  | (UpdateCheckBase & { readonly status: 'up-to-date' })
  | (UpdateCheckBase & { readonly status: 'update-available' })

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/**
 * Parse strict SemVer with an optional lowercase `v` prefix.
 * @param input - complete version or release tag.
 * @returns parsed identifiers, or null when the input is not valid SemVer.
 */
export function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null

  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null

  return {
    version,
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease,
    build: match[5]?.split('.') ?? [],
  }
}

/**
 * Compare two strict SemVer strings without numeric overflow.
 * @param left - first strict SemVer value.
 * @param right - second strict SemVer value.
 * @returns negative, zero, or positive precedence, or null when either value is invalid.
 */
export function compareSemVerVersions(left: string, right: string): number | null {
  const leftVersion = parseSemVer(left)
  const rightVersion = parseSemVer(right)
  if (leftVersion === null || rightVersion === null) return null
  return compareParsedSemVer(leftVersion, rightVersion)
}

/**
 * Check the fixed public GitHub repository for a newer eligible release.
 * @param options - installed version, caller-owned signal, and optional request adapter.
 * @returns a successful comparison, or null when any request or validation step fails.
 */
export async function checkForStableUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
  const current = parseCanonicalVersion(options.currentVersion)
  if (current === null) return null

  const init: RequestInit = {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DeepSeek-Harness-Desktop-Gala-Update-Checker',
    },
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const request = options.request ?? defaultRequest

  let response: Response
  try {
    response = await request(DESKTOP_VERSION_ENDPOINT, init)
  } catch {
    return null
  }
  if (response.status !== 200) return null

  let body: string
  try {
    body = await readLimitedBody(response)
  } catch {
    return null
  }

  const latest = parseReleaseResponse(body, current.prerelease.length > 0)
  if (latest === null) return null
  return {
    status: compareParsedSemVer(latest.version, current) > 0 ? 'update-available' : 'up-to-date',
    currentVersion: current.version,
    latestVersion: latest.version.version,
    releaseUrl: latest.releaseUrl,
  }
}

async function defaultRequest(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init)
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_VERSION_RESPONSE_BYTES)) {
    throw new Error('version response is too large')
  }

  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > MAX_VERSION_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('version response is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

interface ParsedRelease {
  version: ParsedSemVer
  releaseUrl: string
}

function parseReleaseResponse(body: string, includePrerelease: boolean): ParsedRelease | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  let latest: ParsedRelease | null = null
  for (const item of value) {
    if (!isRecord(item)
      || typeof item.draft !== 'boolean'
      || typeof item.prerelease !== 'boolean'
      || item.draft
      || typeof item.tag_name !== 'string'
      || typeof item.html_url !== 'string') continue
    const version = parseReleaseTag(item.tag_name)
    if (version === null
      || (!includePrerelease && (item.prerelease || version.prerelease.length > 0))) continue
    if (!isReleaseUrl(item.html_url)) continue
    if (latest === null || compareParsedSemVer(version, latest.version) > 0) {
      latest = { version, releaseUrl: item.html_url }
    }
  }
  return latest
}

function parseCanonicalVersion(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.version === input ? parsed : null
}

function parseReleaseTag(input: string): ParsedSemVer | null {
  if (!input.startsWith('v')) return null
  return parseSemVer(input)
}

function isReleaseUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith(`/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/`)
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}

function compareParsedSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumeric(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = isNumeric(leftIdentifier)
    const rightNumeric = isNumeric(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumeric(leftIdentifier, rightIdentifier)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNumeric(identifier: string): boolean {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier: string): boolean {
  return identifier.length > 1 && identifier.startsWith('0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

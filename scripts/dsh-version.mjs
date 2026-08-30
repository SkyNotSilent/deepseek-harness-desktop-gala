const RUNTIME_PACKAGE = '@deepseek-ai/dsh'
const RUNTIME_PREFIX = '@deepseek-ai/dsh-'
const SANDBOX_ACL_PACKAGE = '@deepseek-ai/dsh-sandbox-windows-acl'
const SANDBOX_ACL_PATCH_STEM = 'dsh-sandbox-windows-acl'
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u
const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/u
const PROSE_SERIES_PATTERN = /(?:Harness|上游)\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gu

/**
 * Decide whether a package name belongs to the upstream DSH runtime train, whose
 * whole graph is released with one shared version. The rule is an exact match on
 * `@deepseek-ai/dsh` or the `@deepseek-ai/dsh-` prefix, which deliberately excludes
 * `@deepseek-ai/cordis`, `@deepseek-ai/cordis-plugin-*` and `@deepseek-ai/schemastery`
 * because those are versioned independently of the runtime.
 * @param {string} name - package name.
 * @returns {boolean}
 */
export function isRuntimePackage(name) {
  return name === RUNTIME_PACKAGE || name.startsWith(RUNTIME_PREFIX)
}

/**
 * Parse a strict semver 2.0.0 version string into its comparable parts. Leading zeroes
 * are rejected in the major, minor and patch identifiers and in numeric prerelease
 * identifiers, per semver §2 and §9.
 * @param {unknown} value - candidate version string.
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[], build: string | undefined }}
 */
export function parseVersion(value) {
  if (typeof value !== 'string') throw new TypeError(`version must be a string, received ${typeof value}`)
  const match = VERSION_PATTERN.exec(value)
  if (match === null) throw new Error(`unparseable version: ${JSON.stringify(value)}`)
  const prerelease = match[4] === undefined ? [] : match[4].split('.')
  for (const identifier of prerelease) {
    if (identifier.length === 0) throw new Error(`empty prerelease identifier in version: ${value}`)
    if (/^\d+$/u.test(identifier) && !NUMERIC_IDENTIFIER.test(identifier)) {
      throw new Error(`prerelease identifier has a leading zero in version: ${value}`)
    }
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    build: match[5],
  }
}

/**
 * Compare two version strings by semver precedence, including prerelease ordering
 * per semver §11: numeric identifiers compare numerically, alphanumeric ones compare
 * lexically in ASCII order, numeric sorts before alphanumeric, a shorter prerelease
 * sorts before its own longer prefix, and any prerelease sorts before the release.
 * Build metadata is ignored.
 * @param {string} a - left version string.
 * @param {string} b - right version string.
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Reduce a pinned runtime version to the `MAJOR.MINOR.PATCH` release series used in
 * marketing prose, i.e. strip any prerelease and build suffix: the `0.1.1-rc.2` pin is
 * advertised as upstream `0.1.1`, and a `0.1.2-rc.1` pin would be advertised as `0.1.2`.
 * @param {string} version - pinned runtime version.
 * @returns {string}
 */
export function minorSeries(version) {
  const parsed = parseVersion(version)
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`
}

/**
 * Read the single canonical DSH runtime version out of a workspace manifest by looking
 * at its `@deepseek-ai/dsh` dependency edge.
 * @param {object} manifest - parsed package manifest declaring the runtime.
 * @returns {string}
 */
export function readPinnedVersion(manifest) {
  for (const section of DEPENDENCY_SECTIONS) {
    const entries = readSection(manifest, section)
    if (entries === undefined) continue
    const value = entries[RUNTIME_PACKAGE]
    if (value === undefined) continue
    parseVersion(value)
    return value
  }
  throw new Error(`manifest declares no ${RUNTIME_PACKAGE} dependency, so the pinned DSH version cannot be derived`)
}

/**
 * List every DSH runtime dependency edge declared by a manifest, in section order and
 * alphabetically inside each section. Membership follows `isRuntimePackage`, so only
 * `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` are reported and the independently
 * versioned `@deepseek-ai/cordis*` and `@deepseek-ai/schemastery` edges are ignored.
 * @param {object} manifest - parsed package manifest.
 * @returns {{ section: string, name: string, version: unknown }[]}
 */
export function collectRuntimePins(manifest) {
  const pins = []
  for (const section of DEPENDENCY_SECTIONS) {
    const entries = readSection(manifest, section)
    if (entries === undefined) continue
    for (const name of Object.keys(entries).sort()) {
      if (!isRuntimePackage(name)) continue
      pins.push({ section, name, version: entries[name] })
    }
  }
  return pins
}

/**
 * Plan the dependency edges a manifest must change to move the runtime pin, without
 * mutating the input. Only entries that are both a DSH runtime package and pinned at
 * exactly `fromVersion` are planned, so independently versioned `@deepseek-ai` packages
 * and range specifiers are left for the drift guard to report instead of being rewritten.
 * @param {object} manifest - parsed package manifest.
 * @param {string} fromVersion - currently pinned runtime version.
 * @param {string} toVersion - target runtime version.
 * @returns {{ changes: { section: string, name: string, from: string, to: string }[] }}
 */
export function planManifestRewrite(manifest, fromVersion, toVersion) {
  parseVersion(fromVersion)
  parseVersion(toVersion)
  const changes = []
  for (const pin of collectRuntimePins(manifest)) {
    if (pin.version !== fromVersion) continue
    changes.push({ section: pin.section, name: pin.name, from: fromVersion, to: toVersion })
  }
  return { changes }
}

/**
 * Produce a copy of a manifest with planned dependency rewrites applied, preserving key
 * insertion order so re-serialisation stays line-scoped.
 * @param {object} manifest - parsed package manifest.
 * @param {{ section: string, name: string, to: string }[]} changes - planned rewrites.
 * @returns {object}
 */
export function applyManifestRewrite(manifest, changes) {
  const next = structuredClone(manifest)
  for (const change of changes) next[change.section][change.name] = change.to
  return next
}

/**
 * Build the repository-relative path of the Windows ACL sandbox patch for a version.
 * @param {string} version - runtime version.
 * @returns {string}
 */
export function sandboxPatchPath(version) {
  return `patches/${SANDBOX_ACL_PATCH_STEM}@${version}.patch`
}

/**
 * Build the two Yarn resolution keys that pin the patched Windows ACL sandbox: the exact
 * descriptor requested by the workspaces and the caret descriptor requested by upstream
 * packages.
 * @param {string} version - runtime version.
 * @returns {string[]}
 */
export function resolutionKeys(version) {
  return [`${SANDBOX_ACL_PACKAGE}@npm:${version}`, `${SANDBOX_ACL_PACKAGE}@npm:^${version}`]
}

/**
 * Build the Yarn patch protocol value both sandbox resolution keys must carry, including
 * the `%3A` encoded inner descriptor and the versioned patch filename.
 * @param {string} version - runtime version.
 * @returns {string}
 */
export function resolutionValue(version) {
  return `patch:${SANDBOX_ACL_PACKAGE}@npm%3A${version}#./${sandboxPatchPath(version)}`
}

/**
 * List the sandbox resolution entries a manifest currently declares, so the drift guard
 * can compare them against the canonical pair without depending on key order.
 * @param {object | undefined} resolutions - root `resolutions` block.
 * @returns {{ key: string, value: unknown }[]}
 */
export function collectSandboxResolutions(resolutions) {
  const entries = resolutions === null || typeof resolutions !== 'object' ? [] : Object.entries(resolutions)
  return entries
    .filter(([key]) => key.startsWith(`${SANDBOX_ACL_PACKAGE}@`))
    .map(([key, value]) => ({ key, value }))
}

/**
 * Plan the root `resolutions` rewrite that moves both sandbox descriptors and the patch
 * filename to a new version, without mutating the input and keeping every unrelated
 * resolution such as `app-builder-lib` and `node-pty` in place and in position.
 * @param {object | undefined} resolutions - root `resolutions` block.
 * @param {string} fromVersion - currently pinned runtime version.
 * @param {string} toVersion - target runtime version.
 * @returns {{ changes: { from: string, to: string, fromValue: string, toValue: string }[], resolutions: object }}
 */
export function planResolutionRewrite(resolutions, fromVersion, toVersion) {
  const fromKeys = resolutionKeys(fromVersion)
  const toKeys = resolutionKeys(toVersion)
  const fromValue = resolutionValue(fromVersion)
  const toValue = resolutionValue(toVersion)
  const source = resolutions === null || typeof resolutions !== 'object' ? {} : resolutions
  const changes = []
  const entries = []

  for (const [key, value] of Object.entries(source)) {
    const index = fromKeys.indexOf(key)
    if (index === -1) {
      entries.push([key, value])
      continue
    }
    if (value !== fromValue) {
      throw new Error(`resolution ${key} does not carry the expected patch value ${fromValue}`)
    }
    changes.push({ from: key, to: toKeys[index], fromValue, toValue })
    entries.push([toKeys[index], toValue])
  }

  const missing = fromKeys.filter((key) => !Object.hasOwn(source, key))
  if (missing.length > 0) throw new Error(`root resolutions are missing ${missing.join(' and ')}`)

  return { changes, resolutions: Object.fromEntries(entries) }
}

/**
 * Find every upstream release series stated in marketing prose, matching the series that
 * follows a `Harness` or `上游` mention so app versions and unrelated numbers are ignored.
 * @param {string} text - file contents.
 * @returns {{ line: number, series: string }[]}
 */
export function findProseSeries(text) {
  const found = []
  for (const [index, line] of text.split('\n').entries()) {
    for (const match of line.matchAll(PROSE_SERIES_PATTERN)) {
      found.push({ line: index + 1, series: match[1] })
    }
  }
  return found
}

function readSection(manifest, section) {
  const entries = manifest === null || typeof manifest !== 'object' ? undefined : manifest[section]
  if (entries === null || typeof entries !== 'object') return undefined
  return entries
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumeric = NUMERIC_IDENTIFIER.test(a)
    const bNumeric = NUMERIC_IDENTIFIER.test(b)
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}

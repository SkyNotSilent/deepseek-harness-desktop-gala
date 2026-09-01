import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const RUNTIME_PACKAGE = '@deepseek-ai/dsh'
const RUNTIME_PREFIX = '@deepseek-ai/dsh-'
export const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u
const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/u
const PROSE_SERIES_PATTERN = /(?:Harness|上游)\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gu

export function isRuntimePackage(name) {
  return name === RUNTIME_PACKAGE || name.startsWith(RUNTIME_PREFIX)
}

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

export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

export function minorSeries(version) {
  const parsed = parseVersion(version)
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`
}

export function readPinnedVersion(manifest) {
  for (const section of DEPENDENCY_SECTIONS) {
    const entries = readSection(manifest, section)
    const value = entries?.[RUNTIME_PACKAGE]
    if (value === undefined) continue
    parseVersion(value)
    return value
  }
  throw new Error(`manifest declares no ${RUNTIME_PACKAGE} dependency`)
}

export function collectRuntimePins(manifest) {
  const pins = []
  for (const section of DEPENDENCY_SECTIONS) {
    const entries = readSection(manifest, section)
    if (entries === undefined) continue
    for (const name of Object.keys(entries).sort()) {
      if (isRuntimePackage(name)) pins.push({ section, name, version: entries[name] })
    }
  }
  return pins
}

export function planManifestRewrite(manifest, fromVersion, toVersion) {
  parseVersion(fromVersion)
  parseVersion(toVersion)
  return {
    changes: collectRuntimePins(manifest)
      .filter(pin => pin.version === fromVersion)
      .map(pin => ({ section: pin.section, name: pin.name, from: fromVersion, to: toVersion })),
  }
}

export function applyManifestRewrite(manifest, changes) {
  const next = structuredClone(manifest)
  for (const change of changes) next[change.section][change.name] = change.to
  return next
}

export function patchPath(name, version) {
  if (!isRuntimePackage(name)) throw new Error(`not a DSH runtime package: ${name}`)
  return `patches/${name.slice('@deepseek-ai/'.length)}@${version}.patch`
}

export function expectedResolution(entry, vendorVersion, patches) {
  const source = `file:vendor/dsh-runtime/${vendorVersion}/${entry.filename}`
  return patches.includes(entry.name)
    ? `patch:${entry.name}@${source.replace(':', '%3A')}#./${patchPath(entry.name, vendorVersion)}`
    : source
}

export function planResolutionRewrite(resolutions, currentClosure, targetClosure) {
  const source = resolutions === null || typeof resolutions !== 'object' ? {} : resolutions
  const currentEntries = new Map(currentClosure.packages.map(entry => [entry.name, entry]))
  const targetEntries = new Map(targetClosure.packages.map(entry => [entry.name, entry]))
  const currentNames = [...currentEntries.keys()]
  const targetNames = [...targetEntries.keys()]
  if (JSON.stringify(currentNames) !== JSON.stringify(targetNames)) {
    throw new Error('runtime package closure changed; adapt manifests and patches before using the version tool')
  }
  if (JSON.stringify(currentClosure.patches) !== JSON.stringify(targetClosure.patches)) {
    throw new Error('runtime patch inventory changed; adapt patches before using the version tool')
  }
  for (const name of currentNames) {
    const expected = expectedResolution(currentEntries.get(name), currentClosure.version, currentClosure.patches)
    if (source[name] !== expected) throw new Error(`root resolution ${name} differs from the current vendor manifest`)
  }
  for (const key of Object.keys(source).filter(isRuntimePackage)) {
    if (!currentEntries.has(key)) throw new Error(`root resolutions contain stale runtime package ${key}`)
  }
  const targetValues = new Map(targetNames.map(name => [
    name,
    expectedResolution(targetEntries.get(name), targetClosure.version, targetClosure.patches),
  ]))
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, targetValues.get(key) ?? value]))
}

export function validateVendorClosure(repoRoot, version) {
  parseVersion(version)
  const directory = join(repoRoot, 'vendor', 'dsh-runtime', version)
  const manifestPath = join(directory, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`missing vendor/dsh-runtime/${version}/manifest.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.formatVersion !== 2 || manifest.version !== version || manifest.registry !== 'https://registry.npmjs.org') {
    throw new Error(`vendor ${version} does not use the registry-backed manifest format`)
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) throw new Error(`vendor ${version} has no packages`)
  if (!Array.isArray(manifest.patches) || new Set(manifest.patches).size !== manifest.patches.length) {
    throw new Error(`vendor ${version} has an invalid patch inventory`)
  }
  const names = new Set()
  const expectedFiles = new Set(['manifest.json', 'licenses.json'])
  for (const entry of manifest.packages) {
    if (typeof entry.name !== 'string' || !isRuntimePackage(entry.name) || names.has(entry.name)) {
      throw new Error(`vendor ${version} has an invalid package entry`)
    }
    names.add(entry.name)
    expectedFiles.add(entry.filename)
    const path = join(directory, entry.filename)
    if (basename(path) !== entry.filename || !existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`vendor ${version} is missing ${entry.filename}`)
    }
    const bytes = readFileSync(path)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    if (bytes.byteLength !== entry.size || sha256 !== entry.sha256 || integrity !== entry.integrity) {
      throw new Error(`vendor ${version} integrity differs for ${entry.filename}`)
    }
    const pkg = packageManifest(bytes, entry.filename)
    if (pkg.name !== entry.name || pkg.version !== version || pkg.license !== entry.license) {
      throw new Error(`vendor ${version} package metadata differs for ${entry.filename}`)
    }
  }
  for (const name of manifest.patches) {
    if (!names.has(name)) throw new Error(`vendor ${version} patch target is absent: ${name}`)
    if (!existsSync(join(repoRoot, patchPath(name, version)))) throw new Error(`missing ${patchPath(name, version)}`)
  }
  const actualFiles = readdirSync(directory, { withFileTypes: true })
  if (actualFiles.some(entry => !entry.isFile() || !expectedFiles.has(entry.name))) {
    throw new Error(`vendor ${version} contains entries outside its manifest`)
  }
  return manifest
}

export function assertManifestPins(manifest, version, closure) {
  const names = new Set(closure.packages.map(entry => entry.name))
  for (const pin of collectRuntimePins(manifest)) {
    if (!names.has(pin.name)) throw new Error(`${pin.section}.${pin.name} is absent from vendor ${version}`)
    if (pin.version !== version) throw new Error(`${pin.section}.${pin.name} is ${JSON.stringify(pin.version)}, expected ${version}`)
  }
}

export function writeManagedFiles(entries, afterWrite = () => {}) {
  const staged = []
  try {
    for (const [index, entry] of entries.entries()) {
      const temporary = join(dirname(entry.path), `.${basename(entry.path)}.dsh-version-${String(process.pid)}-${String(index)}`)
      if (existsSync(temporary)) rmSync(temporary)
      writeFileSync(temporary, entry.next)
      staged.push({ ...entry, temporary })
    }
    const written = []
    try {
      for (const [index, entry] of staged.entries()) {
        renameSync(entry.temporary, entry.path)
        written.push(entry)
        afterWrite(index, entry.path)
      }
    } catch (cause) {
      for (const entry of written) writeFileSync(entry.path, entry.original)
      throw cause
    }
  } finally {
    for (const entry of staged) {
      if (existsSync(entry.temporary)) rmSync(entry.temporary)
    }
  }
}

export function findProseSeries(text) {
  const found = []
  for (const [index, line] of text.split('\n').entries()) {
    for (const match of line.matchAll(PROSE_SERIES_PATTERN)) found.push({ line: index + 1, series: match[1] })
  }
  return found
}

function packageManifest(tgz, filename) {
  const tar = gunzipSync(tgz)
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tarString(tar, offset, 100)
    if (name.length === 0) break
    const prefix = tarString(tar, offset + 345, 155)
    const path = prefix.length === 0 ? name : `${prefix}/${name}`
    const sizeText = tarString(tar, offset + 124, 12).trim()
    const size = sizeText.length === 0 ? 0 : Number.parseInt(sizeText, 8)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid tar entry in ${filename}`)
    const body = offset + 512
    if (body + size > tar.length) throw new Error(`truncated tar entry in ${filename}`)
    if (path === 'package/package.json') return JSON.parse(tar.subarray(body, body + size).toString('utf8'))
    offset = body + Math.ceil(size / 512) * 512
  }
  throw new Error(`missing package/package.json in ${filename}`)
}

function tarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset)
  return buffer.subarray(offset, end === -1 || end > offset + length ? offset + length : end).toString('utf8')
}

function readSection(manifest, section) {
  const entries = manifest === null || typeof manifest !== 'object' ? undefined : manifest[section]
  return entries === null || typeof entries !== 'object' ? undefined : entries
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

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
if (process.argv[2] !== '--check' || process.argv.length !== 3) {
  throw new Error('usage: node scripts/sync-vendored-runtime.mjs --check')
}

const upstream = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'))
const version = upstream.sourceVersion
const vendorRelative = `vendor/dsh-runtime/${version}`
const vendorDirectory = join(root, ...vendorRelative.split('/'))
const manifestPath = join(vendorDirectory, 'manifest.json')
const workspacePath = join(root, 'package.json')
const pluginPaths = [
  join(root, 'dsh-plugin-desktop', 'package.json'),
  join(root, 'dsh-plugin-gala', 'package.json'),
]
const removedPackages = new Set([
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-host-apiproxy',
])
const patchedPackages = [
  '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  '@deepseek-ai/dsh-host-directory-picker-browse',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-win32-process',
  '@deepseek-ai/dsh',
]

const fail = message => { throw new Error(`sync-vendored-runtime: ${message}`) }
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const integrity = value => `sha512-${createHash('sha512').update(value).digest('base64')}`
const isDshPackage = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
const isDshResolution = selector => selector === '@deepseek-ai/dsh'
  || selector.startsWith('@deepseek-ai/dsh@')
  || selector.startsWith('@deepseek-ai/dsh-')

function tarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset)
  return buffer.subarray(offset, end === -1 || end > offset + length ? offset + length : end).toString('utf8')
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
    if (!Number.isSafeInteger(size) || size < 0) fail(`invalid tar entry in ${filename}`)
    const body = offset + 512
    if (body + size > tar.length) fail(`truncated tar entry in ${filename}`)
    if (path === 'package/package.json') {
      try {
        return JSON.parse(tar.subarray(body, body + size).toString('utf8'))
      } catch {
        fail(`invalid package/package.json in ${filename}`)
      }
    }
    offset = body + Math.ceil(size / 512) * 512
  }
  fail(`missing package/package.json in ${filename}`)
}

function expectedResolution(entry) {
  const source = `file:${vendorRelative}/${entry.filename}`
  if (!patchedPackages.includes(entry.name)) return source
  const unscoped = entry.name.slice('@deepseek-ai/'.length)
  return `patch:${entry.name}@${source.replace(':', '%3A')}#./patches/${unscoped}@${version}.patch`
}

function verifyPatch(entry) {
  if (entry === undefined) fail('patch target is absent from the runtime closure')
  const unscoped = entry.name.slice('@deepseek-ai/'.length)
  const patch = join(root, 'patches', `${unscoped}@${version}.patch`)
  const tgz = join(vendorDirectory, entry.filename)
  const temporary = mkdtempSync(join(root, '.patch-check-'))
  try {
    const unpack = spawnSync('tar', ['-xzf', tgz, '-C', temporary], { encoding: 'utf8' })
    if (unpack.status !== 0) fail(`${entry.name} could not be extracted: ${unpack.stderr.trim()}`)
    const applied = spawnSync(
      'git',
      ['apply', '--check', '--whitespace=error-all', patch],
      { cwd: join(temporary, 'package'), encoding: 'utf8' },
    )
    if (applied.status !== 0) fail(`${entry.name} patch does not cleanly apply: ${applied.stderr.trim()}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.-]*$/u.test(version)) fail('unsafe source version')
if (!existsSync(manifestPath)) fail(`missing ${relative(root, manifestPath)}`)
const manifest = readJson(manifestPath)
if (manifest.formatVersion !== 2 || manifest.registry !== 'https://registry.npmjs.org') {
  fail('vendored runtime must use registry-backed manifest format 2')
}
if (JSON.stringify(manifest.patches) !== JSON.stringify(patchedPackages)) {
  fail('manifest patch inventory differs from the locked alpha.2 patch set')
}
for (const field of ['repository', 'commit']) {
  if (manifest[field] !== upstream[field]) fail(`manifest ${field} differs from upstream.json`)
}
if (manifest.version !== version || upstream.runtimePackageVersion !== version) fail('runtime versions differ')
if (manifest.buildProfile !== 'official') fail('runtime build profile is not official')
if (upstream.runtimeSource !== `${vendorRelative}/manifest.json`) fail('runtimeSource points elsewhere')
if (!Array.isArray(manifest.packages) || manifest.packages.length !== 245) fail('expected exactly 245 public packages')

const workspace = readJson(workspacePath)
const resolutions = workspace.resolutions ?? {}
const names = new Set()
const packageManifests = new Map()
const expectedFiles = new Set(['manifest.json', 'licenses.json'])
for (const entry of manifest.packages) {
  if (typeof entry.name !== 'string' || names.has(entry.name) || entry.version !== version) {
    fail(`invalid package entry ${JSON.stringify(entry.name)}`)
  }
  names.add(entry.name)
  expectedFiles.add(entry.filename)
  const path = join(vendorDirectory, entry.filename)
  if (!existsSync(path) || !statSync(path).isFile()) fail(`missing ${entry.filename}`)
  const bytes = readFileSync(path)
  if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256 || integrity(bytes) !== entry.integrity) {
    fail(`integrity differs for ${entry.filename}`)
  }
  const pkg = packageManifest(bytes, entry.filename)
  if (pkg.name !== entry.name || pkg.version !== version || pkg.license !== entry.license) {
    fail(`package metadata differs for ${entry.filename}`)
  }
  packageManifests.set(entry.name, pkg)
  if (resolutions[entry.name] !== expectedResolution(entry)) fail(`resolution differs for ${entry.name}`)
}
for (const removed of removedPackages) {
  if (names.has(removed) || resolutions[removed] !== undefined) fail(`removed package remains active: ${removed}`)
}
for (const [name, pkg] of packageManifests) {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(pkg[field] ?? {})) {
      if (isDshPackage(dependency) && !names.has(dependency)) {
        fail(`${name} ${field} references absent runtime package ${dependency}`)
      }
    }
  }
}
for (const selector of Object.keys(resolutions).filter(isDshResolution)) {
  if (!names.has(selector)) fail(`stale DSH resolution ${selector}`)
}
for (const entry of readdirSync(vendorDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !expectedFiles.has(entry.name)) fail(`unexpected vendor entry ${entry.name}`)
}

const licenseInventory = readJson(join(vendorDirectory, 'licenses.json'))
const expectedLicenses = manifest.packages.map(({ name, version: packageVersion, license }) => ({
  name,
  version: packageVersion,
  license,
}))
if (licenseInventory.formatVersion !== 1
  || licenseInventory.repository !== upstream.repository
  || licenseInventory.commit !== upstream.commit
  || licenseInventory.version !== version
  || JSON.stringify(licenseInventory.packages) !== JSON.stringify(expectedLicenses)) {
  fail('license inventory differs from manifest')
}

const actualPatches = readdirSync(join(root, 'patches'))
  .filter(name => name.startsWith('dsh') && name.endsWith(`@${version}.patch`))
  .sort()
const expectedPatches = patchedPackages
  .map(name => `${name.slice('@deepseek-ai/'.length)}@${version}.patch`)
  .sort()
if (JSON.stringify(actualPatches) !== JSON.stringify(expectedPatches)) fail('versioned DSH patch inventory differs')
for (const name of patchedPackages) verifyPatch(manifest.packages.find(entry => entry.name === name))

for (const path of pluginPaths) {
  const plugin = readJson(path)
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(plugin[field] ?? {})) {
      if (!isDshPackage(name)) continue
      if (!names.has(name)) fail(`${relative(root, path)} references absent package ${name}`)
      if (range !== version) fail(`${relative(root, path)} ${field}.${name} must use ${version}`)
    }
  }
}

const lockfile = readFileSync(join(root, 'yarn.lock'), 'utf8')
if (lockfile.includes('0.1.1-rc.2')) fail('lockfile still resolves the old rc.2 runtime')
for (const removed of removedPackages) {
  if (lockfile.includes(removed)) fail(`lockfile still contains removed package ${removed}`)
}
for (const line of lockfile.split(/\r?\n/u)) {
  if (/^\s+resolution: "@deepseek-ai\/dsh(?:-|@)/u.test(line) && line.includes('@npm:')) {
    fail(`lockfile has a registry-backed DSH resolution: ${line.trim()}`)
  }
}

process.stdout.write(
  `sync-vendored-runtime: ${String(manifest.packages.length)} registry packages, closure, licenses, and ${String(patchedPackages.length)} patches verified\n`,
)

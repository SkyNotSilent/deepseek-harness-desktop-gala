import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const upstream = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'))
const version = upstream.sourceVersion
const vendorDirectory = join(root, 'vendor', 'dsh-runtime', version)
const manifestPath = join(vendorDirectory, 'manifest.json')
const mode = process.argv[2]
const CONCURRENCY = 12
const ALPHA2_PATCHES = [
  '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  '@deepseek-ai/dsh-host-directory-picker-browse',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-win32-process',
  '@deepseek-ai/dsh',
]

if (mode !== '--write' && mode !== '--check') {
  throw new Error('usage: node scripts/fetch-vendored-runtime.mjs <--write|--check>')
}

const fail = message => { throw new Error(`fetch-vendored-runtime: ${message}`) }
const digest = (algorithm, value, encoding) => createHash(algorithm).update(value).digest(encoding)
const sha256 = value => digest('sha256', value, 'hex')
const integrity = value => `sha512-${digest('sha512', value, 'base64')}`
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

function tarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset)
  return buffer.subarray(offset, end === -1 || end > offset + length ? offset + length : end).toString('utf8')
}

function packageManifest(tgz) {
  const tar = gunzipSync(tgz)
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tarString(tar, offset, 100)
    if (name.length === 0) break
    const prefix = tarString(tar, offset + 345, 155)
    const path = prefix.length === 0 ? name : `${prefix}/${name}`
    const sizeText = tarString(tar, offset + 124, 12).trim()
    const size = sizeText.length === 0 ? 0 : Number.parseInt(sizeText, 8)
    if (!Number.isSafeInteger(size) || size < 0) fail(`invalid tar entry size for ${path}`)
    const body = offset + 512
    if (body + size > tar.length) fail(`truncated tar entry ${path}`)
    if (path === 'package/package.json') {
      try {
        return JSON.parse(tar.subarray(body, body + size).toString('utf8'))
      } catch {
        fail('package/package.json is not valid JSON')
      }
    }
    offset = body + Math.ceil(size / 512) * 512
  }
  fail('tarball has no package/package.json')
}

async function registryMetadata(name) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error' })
  if (!response.ok) fail(`${name}@${version} metadata returned HTTP ${response.status}`)
  const metadata = await response.json()
  if (metadata.name !== name || metadata.version !== version) fail(`${name} registry identity differs`)
  if (typeof metadata.dist?.integrity !== 'string' || !metadata.dist.integrity.startsWith('sha512-')) {
    fail(`${name} registry metadata has no SHA-512 integrity`)
  }
  const tarball = new URL(metadata.dist.tarball)
  if (tarball.protocol !== 'https:' || tarball.hostname !== 'registry.npmjs.org') {
    fail(`${name} registry tarball uses an unexpected origin`)
  }
  return { integrity: metadata.dist.integrity, tarball: tarball.href }
}

async function download(entry, stageDirectory) {
  const registry = await registryMetadata(entry.name)
  let bytes
  if (mode === '--write') {
    const response = await fetch(registry.tarball, { redirect: 'error' })
    if (!response.ok) fail(`${entry.name} tarball returned HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  } else {
    const path = join(vendorDirectory, entry.filename)
    if (!existsSync(path) || !statSync(path).isFile()) fail(`missing ${entry.filename}`)
    bytes = readFileSync(path)
  }
  const actualIntegrity = integrity(bytes)
  if (actualIntegrity !== registry.integrity) fail(`${entry.name} differs from npm dist.integrity`)
  const pkg = packageManifest(bytes)
  if (pkg.name !== entry.name || pkg.version !== version) fail(`${entry.name} tar package identity differs`)
  if (typeof pkg.license !== 'string' || pkg.license.length === 0) fail(`${entry.name} has no license metadata`)
  if (mode === '--write') writeFileSync(join(stageDirectory, entry.filename), bytes)
  return {
    name: entry.name,
    version,
    filename: entry.filename,
    size: bytes.byteLength,
    sha256: sha256(bytes),
    integrity: actualIntegrity,
    license: pkg.license,
  }
}

async function mapConcurrent(entries, operation) {
  const results = new Array(entries.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= entries.length) return
      results[index] = await operation(entries[index], index)
    }
  }))
  return results
}

if (!existsSync(manifestPath)) fail('the curated source package manifest is missing')
const sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!Array.isArray(sourceManifest.packages) || sourceManifest.packages.length !== 245) {
  fail('the official alpha.2 public package set must contain exactly 245 entries')
}
if (new Set(sourceManifest.packages.map(entry => entry.name)).size !== 245) fail('duplicate source package names')

const parent = dirname(vendorDirectory)
const stageDirectory = mode === '--write' ? mkdtempSync(join(parent, '.registry-alpha2-')) : vendorDirectory
let swapped = false
try {
  const packages = await mapConcurrent(sourceManifest.packages, entry => download(entry, stageDirectory))
  const manifest = {
    formatVersion: 2,
    repository: upstream.repository,
    commit: upstream.commit,
    version,
    buildProfile: 'official',
    registry: 'https://registry.npmjs.org',
    patches: sourceManifest.patches ?? ALPHA2_PATCHES,
    packages,
  }
  const licenses = {
    formatVersion: 1,
    repository: upstream.repository,
    commit: upstream.commit,
    version,
    packages: packages.map(({ name, version: packageVersion, license }) => ({
      name,
      version: packageVersion,
      license,
    })),
  }
  if (mode === '--write') {
    writeJson(join(stageDirectory, 'manifest.json'), manifest)
    writeJson(join(stageDirectory, 'licenses.json'), licenses)
    const backup = `${vendorDirectory}.backup-${String(process.pid)}`
    if (existsSync(backup)) fail(`stale backup path ${backup}`)
    renameSync(vendorDirectory, backup)
    try {
      renameSync(stageDirectory, vendorDirectory)
      swapped = true
    } catch (cause) {
      renameSync(backup, vendorDirectory)
      throw cause
    }
    rmSync(backup, { recursive: true })
  } else {
    if (sourceManifest.formatVersion !== 2 || sourceManifest.registry !== manifest.registry) {
      fail('manifest does not declare registry-backed format 2')
    }
    if (JSON.stringify(sourceManifest.packages) !== JSON.stringify(packages)) {
      fail('manifest entries differ from npm registry bytes or package metadata')
    }
    const licensePath = join(vendorDirectory, 'licenses.json')
    if (!existsSync(licensePath) || JSON.stringify(JSON.parse(readFileSync(licensePath, 'utf8'))) !== JSON.stringify(licenses)) {
      fail('license inventory differs from vendored package metadata')
    }
  }
  process.stdout.write(`fetch-vendored-runtime: ${String(packages.length)} npm registry tarballs verified\n`)
} finally {
  if (mode === '--write' && !swapped && existsSync(stageDirectory)) {
    rmSync(stageDirectory, { recursive: true })
  }
}

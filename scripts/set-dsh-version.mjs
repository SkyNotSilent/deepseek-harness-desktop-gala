import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  applyManifestRewrite,
  assertManifestPins,
  collectRuntimePins,
  compareVersions,
  parseVersion,
  patchPath,
  planManifestRewrite,
  planResolutionRewrite,
  readPinnedVersion,
  validateVendorClosure,
  writeManagedFiles,
} from './dsh-version.mjs'

const USAGE = 'usage: node scripts/set-dsh-version.mjs <new-version> [--dry-run] [--allow-downgrade]'
const KNOWN_FLAGS = new Set(['--dry-run', '--allow-downgrade'])
const ROOT_MANIFEST = 'package.json'
const MANIFEST_FILES = [ROOT_MANIFEST, 'dsh-plugin-desktop/package.json', 'dsh-plugin-gala/package.json']
const PIN_SOURCE = 'dsh-plugin-desktop/package.json'

const repoRoot = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flags = new Set(args.filter(arg => arg.startsWith('--')))
const positional = args.filter(arg => !arg.startsWith('--'))
const unknownFlags = [...flags].filter(flag => !KNOWN_FLAGS.has(flag))

if (unknownFlags.length > 0) fail(`unknown flag ${unknownFlags.join(', ')}\n${USAGE}`)
if (positional.length !== 1) fail(USAGE)

const dryRun = flags.has('--dry-run')
const allowDowngrade = flags.has('--allow-downgrade')
const target = positional[0]

try {
  parseVersion(target)
} catch (cause) {
  fail(`${target} is not a valid semver version: ${cause.message}`)
}
if (target.includes('+')) fail(`${target} carries build metadata, which cannot be embedded in vendor and patch paths`)

const manifests = MANIFEST_FILES.map(file => readCanonical(file))
const upstream = readCanonical('upstream.json')
const pinSource = manifests.find(entry => entry.file === PIN_SOURCE)
let current
try {
  current = readPinnedVersion(pinSource.manifest)
} catch (cause) {
  fail(`cannot derive the current DSH pin: ${cause.message}`)
}
if (target === current && !dryRun) fail(`the DSH runtime is already pinned at ${current}`)
if (compareVersions(target, current) < 0 && !allowDowngrade) {
  fail(`${target} is older than ${current}; pass --allow-downgrade to force it`)
}

let currentClosure
let targetClosure
try {
  currentClosure = validateVendorClosure(repoRoot, current)
  targetClosure = validateVendorClosure(repoRoot, target)
  for (const entry of manifests) assertManifestPins(entry.manifest, current, currentClosure)
  assertClosureUnchanged(currentClosure, targetClosure)
  verifyPatches(targetClosure)
} catch (cause) {
  fail(`preflight failed before writes: ${cause.message}`)
}

const rootEntry = manifests.find(entry => entry.file === ROOT_MANIFEST)
let targetResolutions
try {
  targetResolutions = planResolutionRewrite(rootEntry.manifest.resolutions, currentClosure, targetClosure)
} catch (cause) {
  fail(`preflight failed before writes: ${cause.message}`)
}

const planned = manifests.map((entry) => {
  const changes = planManifestRewrite(entry.manifest, current, target).changes
  const skipped = collectRuntimePins(entry.manifest).filter(pin => pin.version !== current)
  if (skipped.length > 0) fail(`preflight failed before writes: ${entry.file} has off-version runtime pins`)
  const next = applyManifestRewrite(entry.manifest, changes)
  if (entry.file === ROOT_MANIFEST) next.resolutions = targetResolutions
  assertManifestPins(next, target, targetClosure)
  return { ...entry, changes, next }
})

const nextUpstream = {
  ...upstream.manifest,
  repository: targetClosure.repository,
  commit: targetClosure.commit,
  sourceVersion: target,
  runtimePackageVersion: target,
  runtimeSource: `vendor/dsh-runtime/${target}/manifest.json`,
}

console.log(`set-dsh-version: ${current} -> ${target}${dryRun ? ' (dry run)' : ''}`)
for (const entry of planned) {
  console.log(`  ${entry.file}: ${String(entry.changes.length)} dependency pins${entry.file === ROOT_MANIFEST ? `, ${String(targetClosure.packages.length)} resolutions` : ''}`)
}
console.log(`  upstream.json: ${targetClosure.commit}`)
console.log(`  patches: ${targetClosure.patches.length} preflighted against registry tarballs`)

if (dryRun) {
  console.log('set-dsh-version: dry run wrote nothing')
  process.exit(0)
}

const writes = [
  ...planned.map(entry => ({ path: entry.path, original: entry.raw, next: serialise(entry.next) })),
  { path: upstream.path, original: upstream.raw, next: serialise(nextUpstream) },
]
try {
  writeManagedFiles(writes)
} catch (cause) {
  fail(`managed-file transaction rolled back: ${cause.message}`)
}

console.log('set-dsh-version: source and manifests updated; vendor and yarn.lock were not changed')
console.log('set-dsh-version: run yarn install --immutable only after the reviewed lockfile has been generated separately')

function readCanonical(file) {
  const path = resolve(repoRoot, file)
  const raw = readFileSync(path, 'utf8')
  const manifest = JSON.parse(raw)
  if (serialise(manifest) !== raw) fail(`${file} is not canonical 2-space JSON with a trailing newline`)
  return { file, path, raw, manifest }
}

function serialise(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function assertClosureUnchanged(currentManifest, targetManifest) {
  const currentNames = currentManifest.packages.map(entry => entry.name)
  const targetNames = targetManifest.packages.map(entry => entry.name)
  if (JSON.stringify(currentNames) !== JSON.stringify(targetNames)) {
    throw new Error('runtime package closure changed; adapt the application before moving the pin')
  }
  if (JSON.stringify(currentManifest.patches) !== JSON.stringify(targetManifest.patches)) {
    throw new Error('runtime patch inventory changed; review and adapt every patch before moving the pin')
  }
}

function verifyPatches(closure) {
  const byName = new Map(closure.packages.map(entry => [entry.name, entry]))
  for (const name of closure.patches) {
    const entry = byName.get(name)
    const temporary = mkdtempSync(join(tmpdir(), 'dsh-version-patch-'))
    try {
      const tgz = join(repoRoot, 'vendor', 'dsh-runtime', closure.version, entry.filename)
      const unpack = spawnSync('tar', ['-xzf', tgz, '-C', temporary], { encoding: 'utf8' })
      if (unpack.status !== 0) throw new Error(`${name} could not be extracted: ${unpack.stderr.trim()}`)
      const patch = join(repoRoot, patchPath(name, closure.version))
      const applied = spawnSync(
        'git',
        ['apply', '--check', '--whitespace=error-all', patch],
        { cwd: join(temporary, 'package'), encoding: 'utf8' },
      )
      if (applied.status !== 0) throw new Error(`${name} patch does not cleanly apply: ${applied.stderr.trim()}`)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}

function fail(message) {
  console.error(`set-dsh-version: ${message}`)
  process.exit(1)
}

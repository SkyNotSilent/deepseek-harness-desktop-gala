import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  applyManifestRewrite,
  collectRuntimePins,
  compareVersions,
  parseVersion,
  planManifestRewrite,
  planResolutionRewrite,
  readPinnedVersion,
  sandboxPatchPath,
} from './dsh-version.mjs'

const USAGE = 'usage: node scripts/set-dsh-version.mjs <new-version> [--dry-run] [--allow-downgrade]'
const KNOWN_FLAGS = new Set(['--dry-run', '--allow-downgrade'])
const ROOT_MANIFEST = 'package.json'
const MANIFEST_FILES = [ROOT_MANIFEST, 'dsh-plugin-desktop/package.json', 'dsh-plugin-gala/package.json']
const PIN_SOURCE = 'dsh-plugin-desktop/package.json'

const repoRoot = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const positional = args.filter((arg) => !arg.startsWith('--'))
const unknownFlags = [...flags].filter((flag) => !KNOWN_FLAGS.has(flag))

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

if (target.includes('+')) {
  fail(`${target} carries build metadata; the version is embedded in a patch filename and a Yarn patch descriptor, which cannot hold a "+"`)
}

const manifests = MANIFEST_FILES.map((file) => {
  const path = resolve(repoRoot, file)
  const raw = readFileSync(path, 'utf8')
  const manifest = JSON.parse(raw)
  if (serialise(manifest) !== raw) {
    fail(`${file} is not canonical 2-space JSON with a trailing newline; rewriting it would reformat the whole file`)
  }
  return { file, path, raw, manifest }
})

const pinSource = manifests.find((entry) => entry.file === PIN_SOURCE)
let current
try {
  current = readPinnedVersion(pinSource.manifest)
} catch (cause) {
  fail(`cannot derive the current DSH pin:\n  ${PIN_SOURCE}: ${cause.message}`)
}

if (target === current) fail(`the DSH runtime is already pinned at ${current}`)
if (compareVersions(target, current) < 0 && !allowDowngrade) {
  fail(`${target} is older than the current pin ${current}; pass --allow-downgrade to force it`)
}

const rootEntry = manifests.find((entry) => entry.file === ROOT_MANIFEST)
let resolutionPlan
try {
  resolutionPlan = planResolutionRewrite(rootEntry.manifest.resolutions, current, target)
} catch (cause) {
  fail(`cannot rewrite the root resolutions block: ${cause.message}`)
}

const planned = manifests.map((entry) => ({ ...entry, changes: planManifestRewrite(entry.manifest, current, target).changes }))
const skipped = manifests.flatMap((entry) => collectRuntimePins(entry.manifest)
  .filter((pin) => pin.version !== current)
  .map((pin) => `${entry.file}: ${pin.section}.${pin.name} is ${JSON.stringify(pin.version)}`))
const patchFrom = sandboxPatchPath(current)
const patchTo = sandboxPatchPath(target)

if (!existsSync(resolve(repoRoot, patchFrom))) {
  fail(`${patchFrom} is missing, so the sandbox patch cannot be renamed to ${patchTo}`)
}
if (existsSync(resolve(repoRoot, patchTo))) fail(`${patchTo} already exists`)

try {
  execFileSync('git', ['ls-files', '--error-unmatch', patchFrom], { cwd: repoRoot, stdio: 'ignore' })
} catch {
  fail(`${patchFrom} is not tracked by git in ${repoRoot}, so it cannot be renamed with git mv`)
}

console.log(`set-dsh-version: ${current} -> ${target}${dryRun ? ' (dry run)' : ''}`)
for (const entry of planned) {
  const resolutionCount = entry.file === ROOT_MANIFEST ? resolutionPlan.changes.length : 0
  console.log(`  ${entry.file}: ${entry.changes.length} dependency pins, ${resolutionCount} resolutions`)
  for (const change of entry.changes) console.log(`    ${change.section}.${change.name}`)
  if (entry.file === ROOT_MANIFEST) {
    for (const change of resolutionPlan.changes) console.log(`    resolutions.${change.from} -> ${change.to}`)
  }
}
console.log(`  git mv ${patchFrom} ${patchTo}`)

if (skipped.length > 0) {
  console.log(`  warning: skipped ${skipped.length} off-version runtime pins that do not equal ${current}:`)
  for (const pin of skipped) console.log(`    ${pin}`)
  console.log('  warning: fix them by hand, then run yarn run verify:dsh-version')
}

if (dryRun) {
  console.log('set-dsh-version: dry run wrote nothing')
  process.exit(0)
}

try {
  execFileSync('git', ['mv', patchFrom, patchTo], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] })
} catch (cause) {
  fail(`git mv ${patchFrom} ${patchTo} failed: ${cause.message}`)
}

const written = []
try {
  for (const entry of planned) {
    const next = applyManifestRewrite(entry.manifest, entry.changes)
    if (entry.file === ROOT_MANIFEST) next.resolutions = resolutionPlan.resolutions
    writeFileSync(entry.path, serialise(next))
    written.push(entry)
  }
} catch (cause) {
  rollback(written)
  fail(`writing the manifests failed: ${cause.message}`)
}

console.log(`set-dsh-version: pinned ${target}; run yarn install, then yarn check, and update the upstream series in README.md, README.en.md and site/`)

function serialise(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function rollback(written) {
  for (const entry of written) writeFileSync(entry.path, entry.raw)
  execFileSync('git', ['mv', patchTo, patchFrom], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] })
  console.error(`set-dsh-version: rolled back ${written.length} manifests and the patch rename`)
}

function fail(message) {
  console.error(`set-dsh-version: ${message}`)
  process.exit(1)
}

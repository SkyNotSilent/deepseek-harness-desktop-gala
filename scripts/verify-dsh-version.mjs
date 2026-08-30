import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertManifestPins,
  findProseSeries,
  minorSeries,
  planResolutionRewrite,
  readPinnedVersion,
  validateVendorClosure,
} from './dsh-version.mjs'

const MANIFEST_FILES = ['package.json', 'dsh-plugin-desktop/package.json', 'dsh-plugin-gala/package.json']
const PIN_SOURCE = 'dsh-plugin-desktop/package.json'
const PROSE_FILES = [
  { file: 'README.md', required: true },
  { file: 'README.en.md', required: true },
  { file: 'site/index.html', required: true },
  { file: 'site/en/index.html', required: false },
]

const repoRoot = resolve(import.meta.dirname, '..')
const manifests = MANIFEST_FILES.map(file => ({
  file,
  manifest: JSON.parse(readFileSync(resolve(repoRoot, file), 'utf8')),
}))
const upstream = JSON.parse(readFileSync(resolve(repoRoot, 'upstream.json'), 'utf8'))
const offenders = []
let pinned
let closure

try {
  pinned = readPinnedVersion(manifests.find(entry => entry.file === PIN_SOURCE).manifest)
  closure = validateVendorClosure(repoRoot, pinned)
} catch (cause) {
  console.error(`verify-dsh-version: cannot establish the canonical runtime: ${cause.message}`)
  process.exit(1)
}

for (const entry of manifests) {
  try {
    assertManifestPins(entry.manifest, pinned, closure)
  } catch (cause) {
    offenders.push(`${entry.file}: ${cause.message}`)
  }
}

try {
  const root = manifests.find(entry => entry.file === 'package.json').manifest
  planResolutionRewrite(root.resolutions, closure, closure)
} catch (cause) {
  offenders.push(`package.json: ${cause.message}`)
}

if (upstream.repository !== closure.repository
  || upstream.commit !== closure.commit
  || upstream.sourceVersion !== pinned
  || upstream.runtimePackageVersion !== pinned
  || upstream.runtimeSource !== `vendor/dsh-runtime/${pinned}/manifest.json`) {
  offenders.push('upstream.json does not identify the active registry-backed vendor manifest')
}

const versions = new Set(manifests.map(entry => entry.manifest.version))
if (versions.size !== 1) offenders.push(`product manifests disagree: ${[...versions].join(', ')}`)

const series = minorSeries(pinned)
for (const prose of PROSE_FILES) {
  const found = findProseSeries(readFileSync(resolve(repoRoot, prose.file), 'utf8'))
  if (prose.required && found.length === 0) offenders.push(`${prose.file}: states no Harness series`)
  for (const mention of found) {
    if (mention.series !== series) offenders.push(`${prose.file}:${mention.line}: states ${mention.series}, expected ${series}`)
  }
}

if (offenders.length > 0) {
  console.error(`verify-dsh-version: runtime ${pinned} has drifted:`)
  for (const offender of offenders) console.error(`  ${offender}`)
  process.exit(1)
}

console.log(
  `verify-dsh-version: ${String(closure.packages.length)} registry packages, ${String(closure.patches.length)} patches, three product manifests, and prose series ${series} agree on ${pinned}`,
)

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  collectRuntimePins,
  collectSandboxResolutions,
  findProseSeries,
  minorSeries,
  readPinnedVersion,
  resolutionKeys,
  resolutionValue,
  sandboxPatchPath,
} from './dsh-version.mjs'

const ROOT_MANIFEST = 'package.json'
const MANIFEST_FILES = [ROOT_MANIFEST, 'dsh-plugin-desktop/package.json', 'dsh-plugin-gala/package.json']
const PIN_SOURCE = 'dsh-plugin-desktop/package.json'
const PATCH_DIRECTORY = 'patches'
const SANDBOX_PATCH_PATTERN = /^dsh-sandbox-windows-acl@.+\.patch$/u
const PROSE_FILES = [
  { file: 'README.md', required: true },
  { file: 'README.en.md', required: true },
  { file: 'site/index.html', required: true },
  { file: 'site/en/index.html', required: false },
]

const repoRoot = resolve(import.meta.dirname, '..')
const manifests = MANIFEST_FILES.map((file) => ({ file, manifest: JSON.parse(readFileSync(resolve(repoRoot, file), 'utf8')) }))
const offenders = []
let pinned
try {
  pinned = readPinnedVersion(manifests.find((entry) => entry.file === PIN_SOURCE).manifest)
} catch (cause) {
  console.error('verify-dsh-version: the canonical DSH pin cannot be derived, so nothing else can be checked:')
  console.error(`  ${PIN_SOURCE}: ${cause.message}`)
  console.error(`  pin dependencies.@deepseek-ai/dsh to one exact semver version in ${PIN_SOURCE}`)
  process.exit(1)
}

const series = minorSeries(pinned)
let checkedPins = 0

for (const entry of manifests) {
  for (const pin of collectRuntimePins(entry.manifest)) {
    checkedPins += 1
    if (pin.version === pinned) continue
    offenders.push(`${entry.file}: ${pin.section}.${pin.name} is ${JSON.stringify(pin.version)}, expected ${pinned}`)
  }
}

const expectedPatch = sandboxPatchPath(pinned)
const sandboxPatches = readdirSync(resolve(repoRoot, PATCH_DIRECTORY))
  .filter((name) => SANDBOX_PATCH_PATTERN.test(name))
  .map((name) => `${PATCH_DIRECTORY}/${name}`)
  .sort()

for (const patch of sandboxPatches) {
  if (patch === expectedPatch) continue
  offenders.push(`${patch}: stale sandbox patch filename, expected ${expectedPatch}`)
}
if (!sandboxPatches.includes(expectedPatch)) offenders.push(`${expectedPatch}: sandbox patch file is missing`)

const expectedKeys = resolutionKeys(pinned)
const expectedValue = resolutionValue(pinned)
const declared = new Map(collectSandboxResolutions(manifests.find((entry) => entry.file === ROOT_MANIFEST).manifest.resolutions)
  .map((entry) => [entry.key, entry.value]))

for (const key of expectedKeys) {
  if (!declared.has(key)) {
    offenders.push(`${ROOT_MANIFEST}: resolutions is missing ${key}`)
    continue
  }
  const value = declared.get(key)
  if (value === expectedValue) continue
  offenders.push([
    `${ROOT_MANIFEST}: resolutions[${key}] carries the wrong patch value`,
    `      found    ${JSON.stringify(value)}`,
    `      expected ${JSON.stringify(expectedValue)}`,
  ].join('\n'))
}
for (const key of declared.keys()) {
  if (expectedKeys.includes(key)) continue
  offenders.push(`${ROOT_MANIFEST}: resolutions[${key}] is stale, expected only ${expectedKeys.join(' and ')}`)
}

for (const prose of PROSE_FILES) {
  const found = findProseSeries(readFileSync(resolve(repoRoot, prose.file), 'utf8'))
  if (prose.required && found.length === 0) {
    offenders.push(`${prose.file}: states no upstream release series, expected ${series}`)
  }
  for (const mention of found) {
    if (mention.series === series) continue
    offenders.push(`${prose.file}:${mention.line}: states upstream series ${mention.series}, expected ${series}`)
  }
}

if (offenders.length > 0) {
  console.error(`verify-dsh-version: the DSH runtime pin ${pinned} (upstream series ${series}) has drifted:`)
  for (const offender of offenders) console.error(`  ${offender}`)
  console.error('  run `yarn set:dsh-version <version>` to move every pin, then update the upstream series in README.md, README.en.md and site/')
  process.exit(1)
}

console.log(`verify-dsh-version: ${checkedPins} DSH runtime pins, both sandbox resolutions, ${expectedPatch} and the prose series ${series} all agree on ${pinned}`)

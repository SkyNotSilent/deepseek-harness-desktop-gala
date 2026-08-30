import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { compareVersions, parseVersion, readPinnedVersion } from './dsh-version.mjs'

const USAGE = 'usage: node scripts/check-upstream-dsh.mjs [--fail-on-newer] [--github-output]'
const KNOWN_FLAGS = new Set(['--fail-on-newer', '--github-output'])
const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
const REGISTRY_ACCEPT = 'application/vnd.npm.install-v1+json'
const REGISTRY_TIMEOUT_MS = 20_000
const PIN_SOURCE = 'dsh-plugin-desktop/package.json'
const NOT_CHECKED = 'unknown'
const NONE_PUBLISHED = 'none'

const repoRoot = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const unknownFlags = args.filter((arg) => !KNOWN_FLAGS.has(arg))

if (unknownFlags.length > 0) {
  console.error(`check-upstream-dsh: unknown argument ${unknownFlags.join(', ')}\n${USAGE}`)
  process.exit(1)
}

const failOnNewer = args.includes('--fail-on-newer')
const writeGithubOutput = args.includes('--github-output')
let pinned
try {
  pinned = readPinnedVersion(JSON.parse(readFileSync(resolve(repoRoot, PIN_SOURCE), 'utf8')))
} catch (cause) {
  console.error('check-upstream-dsh: the canonical DSH pin cannot be derived, so nothing can be compared:')
  console.error(`  ${PIN_SOURCE}: ${cause.message}`)
  process.exit(1)
}

let published
try {
  published = await fetchPublishedVersions()
} catch (cause) {
  console.error(`check-upstream-dsh: could not reach the npm registry (${cause.message})`)
  console.log(`check-upstream-dsh: pinned ${pinned}, registry not checked`)
  console.log(`  newest published: ${NOT_CHECKED} (not checked)`)
  console.log(`  newest published release: ${NOT_CHECKED} (not checked)`)
  console.log('  result: could not check, so no update is reported')
  emitGithubOutput({ checked: 'false', 'has-update': 'false', pinned, latest: NOT_CHECKED, 'latest-stable': NOT_CHECKED })
  process.exit(0)
}

const parsed = published.filter(isParseable).sort(compareVersions)
const skipped = published.filter((version) => !isParseable(version))
const latest = parsed.at(-1)
const latestStable = parsed.filter((version) => parseVersion(version).prerelease.length === 0).at(-1)
const hasUpdate = latest !== undefined && compareVersions(latest, pinned) > 0
const hasStableUpdate = latestStable !== undefined && compareVersions(latestStable, pinned) > 0

console.log(`check-upstream-dsh: pinned ${pinned}, ${parsed.length} versions published on npm`)
console.log(`  newest published: ${latest ?? NONE_PUBLISHED}${describe(latest, hasUpdate)}`)
console.log(`  newest published release: ${latestStable ?? NONE_PUBLISHED}${describe(latestStable, hasStableUpdate)}`)
if (skipped.length > 0) console.log(`  ignored unparseable versions: ${skipped.join(', ')}`)
console.log(hasUpdate ? '  result: an upstream update is available' : '  result: checked, no upstream update')

emitGithubOutput({
  checked: 'true',
  'has-update': hasUpdate ? 'true' : 'false',
  pinned,
  latest: latest ?? NONE_PUBLISHED,
  'latest-stable': latestStable ?? NONE_PUBLISHED,
})

if (hasUpdate && failOnNewer) process.exit(1)

async function fetchPublishedVersions() {
  const response = await fetch(REGISTRY_URL, {
    headers: { accept: REGISTRY_ACCEPT },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`registry responded ${response.status} ${response.statusText}`)
  const body = await response.json()
  const versions = Object.keys(body?.versions ?? {})
  if (versions.length === 0) throw new Error('registry returned no versions')
  return versions
}

function describe(version, newer) {
  if (version === undefined) return ' (checked, npm has published none)'
  return newer ? ' (newer than the pin)' : ' (not newer than the pin)'
}

function isParseable(version) {
  try {
    parseVersion(version)
    return true
  } catch {
    return false
  }
}

function emitGithubOutput(values) {
  if (!writeGithubOutput) return
  const path = process.env.GITHUB_OUTPUT
  if (path === undefined || path === '') {
    console.error('check-upstream-dsh: --github-output requires GITHUB_OUTPUT to name a file')
    process.exit(1)
  }
  appendFileSync(path, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
}

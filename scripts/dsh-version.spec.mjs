import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  applyManifestRewrite,
  collectRuntimePins,
  compareVersions,
  expectedResolution,
  findProseSeries,
  isRuntimePackage,
  minorSeries,
  parseVersion,
  patchPath,
  planManifestRewrite,
  planResolutionRewrite,
  readPinnedVersion,
  writeManagedFiles,
} from './dsh-version.mjs'

const CURRENT = '0.1.2-alpha.2'
const TARGET = '0.1.2-rc.1'
const repoRoot = resolve(import.meta.dirname, '..')

const currentClosure = {
  version: CURRENT,
  patches: ['@deepseek-ai/dsh-settings'],
  packages: [
    { name: '@deepseek-ai/dsh', filename: `deepseek-ai-dsh-${CURRENT}.tgz` },
    { name: '@deepseek-ai/dsh-settings', filename: `deepseek-ai-dsh-settings-${CURRENT}.tgz` },
  ],
}
const targetClosure = {
  version: TARGET,
  patches: ['@deepseek-ai/dsh-settings'],
  packages: [
    { name: '@deepseek-ai/dsh', filename: `deepseek-ai-dsh-${TARGET}.tgz` },
    { name: '@deepseek-ai/dsh-settings', filename: `deepseek-ai-dsh-settings-${TARGET}.tgz` },
  ],
}

test('orders the alpha, rc, and stable chain by semver precedence', () => {
  const chain = ['0.1.1-rc.2', '0.1.2-alpha.1', CURRENT, TARGET, '0.1.2', '0.2.0']
  for (let index = 0; index + 1 < chain.length; index += 1) {
    assert.equal(compareVersions(chain[index], chain[index + 1]), -1)
    assert.equal(compareVersions(chain[index + 1], chain[index]), 1)
  }
  assert.equal(compareVersions('0.1.2+build.1', '0.1.2+build.9'), 0)
})

test('rejects malformed semver and keeps prerelease/build parts separate', () => {
  for (const value of ['', 'latest', '0.1', 'v0.1.2', '0.1.2 ', '0.1.2-rc.01', '01.1.0']) {
    assert.throws(() => parseVersion(value), /unparseable version|leading zero/u)
  }
  assert.deepEqual(parseVersion('0.1.2-alpha.2+build.7').prerelease, ['alpha', '2'])
  assert.equal(parseVersion('0.1.2-alpha.2+build.7').build, 'build.7')
  assert.equal(minorSeries(CURRENT), '0.1.2')
})

test('recognizes only the DSH runtime train', () => {
  assert.equal(isRuntimePackage('@deepseek-ai/dsh'), true)
  assert.equal(isRuntimePackage('@deepseek-ai/dsh-client-ui-slots'), true)
  assert.equal(isRuntimePackage('@deepseek-ai/cordis'), false)
  assert.equal(isRuntimePackage('@deepseek-ai/schemastery'), false)
})

test('plans exact runtime manifest pins without touching framework versions', () => {
  const manifest = {
    dependencies: {
      '@deepseek-ai/cordis': '4.0.2',
      '@deepseek-ai/dsh': CURRENT,
      '@deepseek-ai/dsh-settings': CURRENT,
    },
    peerDependencies: { '@deepseek-ai/dsh-client-ui-slots': CURRENT },
  }
  assert.equal(readPinnedVersion(manifest), CURRENT)
  assert.deepEqual(collectRuntimePins(manifest), [
    { section: 'dependencies', name: '@deepseek-ai/dsh', version: CURRENT },
    { section: 'dependencies', name: '@deepseek-ai/dsh-settings', version: CURRENT },
    { section: 'peerDependencies', name: '@deepseek-ai/dsh-client-ui-slots', version: CURRENT },
  ])
  const changes = planManifestRewrite(manifest, CURRENT, TARGET).changes
  const next = applyManifestRewrite(manifest, changes)
  assert.equal(next.dependencies['@deepseek-ai/dsh'], TARGET)
  assert.equal(next.peerDependencies['@deepseek-ai/dsh-client-ui-slots'], TARGET)
  assert.equal(next.dependencies['@deepseek-ai/cordis'], '4.0.2')
  assert.equal(manifest.dependencies['@deepseek-ai/dsh'], CURRENT)
})

test('rebuilds vendor and patch resolutions while preserving unrelated pins and order', () => {
  const resolutions = {
    'app-builder-lib@npm:26.15.3': 'patch:app-builder-lib',
    '@deepseek-ai/dsh': expectedResolution(currentClosure.packages[0], CURRENT, currentClosure.patches),
    '@deepseek-ai/dsh-settings': expectedResolution(currentClosure.packages[1], CURRENT, currentClosure.patches),
    'node-pty@npm:1.2.0-beta.15': 'patch:node-pty',
  }
  const next = planResolutionRewrite(resolutions, currentClosure, targetClosure)
  assert.deepEqual(Object.keys(next), Object.keys(resolutions))
  assert.equal(next['app-builder-lib@npm:26.15.3'], 'patch:app-builder-lib')
  assert.equal(next['@deepseek-ai/dsh'], expectedResolution(targetClosure.packages[0], TARGET, targetClosure.patches))
  assert.equal(next['@deepseek-ai/dsh-settings'], expectedResolution(targetClosure.packages[1], TARGET, targetClosure.patches))
  assert.equal(patchPath('@deepseek-ai/dsh-settings', TARGET), `patches/dsh-settings@${TARGET}.patch`)
})

test('fails preflight planning on closure, patch, or current-resolution drift', () => {
  const resolutions = Object.fromEntries(currentClosure.packages.map(entry => [
    entry.name,
    expectedResolution(entry, CURRENT, currentClosure.patches),
  ]))
  assert.throws(
    () => planResolutionRewrite(resolutions, currentClosure, { ...targetClosure, packages: targetClosure.packages.slice(0, 1) }),
    /closure changed/u,
  )
  assert.throws(
    () => planResolutionRewrite(resolutions, currentClosure, { ...targetClosure, patches: [] }),
    /patch inventory changed/u,
  )
  assert.throws(
    () => planResolutionRewrite({ ...resolutions, '@deepseek-ai/dsh': 'npm:latest' }, currentClosure, targetClosure),
    /differs from the current vendor manifest/u,
  )
})

test('managed-file transaction restores byte-identical originals after an injected failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-version-transaction-'))
  try {
    const first = join(directory, 'first.json')
    const second = join(directory, 'second.json')
    writeFileSync(first, '{"original":1}\n')
    writeFileSync(second, '{"original":2}\n')
    assert.throws(() => writeManagedFiles([
      { path: first, original: readFileSync(first), next: '{"next":1}\n' },
      { path: second, original: readFileSync(second), next: '{"next":2}\n' },
    ], index => {
      if (index === 0) throw new Error('injected write failure')
    }), /injected write failure/u)
    assert.equal(readFileSync(first, 'utf8'), '{"original":1}\n')
    assert.equal(readFileSync(second, 'utf8'), '{"original":2}\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('real dry-run and missing-target failures preserve managed files and the git index', () => {
  const managed = ['package.json', 'dsh-plugin-desktop/package.json', 'dsh-plugin-gala/package.json', 'upstream.json']
  const before = managed.map(file => readFileSync(join(repoRoot, file)))
  const indexBefore = spawnSync('git', ['diff', '--cached', '--binary'], { cwd: repoRoot }).stdout

  const dryRun = spawnSync(process.execPath, ['scripts/set-dsh-version.mjs', CURRENT, '--dry-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(dryRun.status, 0, dryRun.stderr)
  assert.match(dryRun.stdout, /dry run wrote nothing/u)

  const missing = spawnSync(process.execPath, ['scripts/set-dsh-version.mjs', '9.9.9'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /preflight failed before writes.*missing vendor/u)

  for (const [index, file] of managed.entries()) assert.deepEqual(readFileSync(join(repoRoot, file)), before[index])
  assert.deepEqual(spawnSync('git', ['diff', '--cached', '--binary'], { cwd: repoRoot }).stdout, indexBefore)
})

test('findProseSeries captures only Harness/upstream series mentions', () => {
  const text = [
    'DeepSeek Harness 0.1.2 follows alpha.2.',
    '跟随上游 0.1.2。',
    'Desktop Gala 2.2.0-preview.1 ships later.',
  ].join('\n')
  assert.deepEqual(findProseSeries(text), [
    { line: 1, series: '0.1.2' },
    { line: 2, series: '0.1.2' },
  ])
})

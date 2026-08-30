import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('real CLI success atomically advances a valid synthetic vendor pair without touching lock, vendor, or git index', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-version-cli-success-'))
  const nextVersion = '0.1.2-alpha.3'
  const run = (command, args, options = {}) => spawnSync(command, args, {
    cwd: directory,
    encoding: 'utf8',
    ...options,
  })
  const json = value => `${JSON.stringify(value, null, 2)}\n`
  const digest = value => createHash('sha256').update(value).digest('hex')

  function createVendor(version, commit) {
    const vendor = join(directory, 'vendor', 'dsh-runtime', version)
    const staging = join(directory, '.package-staging', version, 'package')
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, 'package.json'), json({
      name: '@deepseek-ai/dsh',
      version,
      license: 'MIT',
    }))
    mkdirSync(vendor, { recursive: true })
    const filename = `deepseek-ai-dsh-${version}.tgz`
    const archive = join(vendor, filename)
    const packed = spawnSync('tar', ['-czf', archive, '-C', join(staging, '..'), 'package'], {
      encoding: 'utf8',
    })
    assert.equal(packed.status, 0, packed.stderr)
    const bytes = readFileSync(archive)
    writeFileSync(join(vendor, 'licenses.json'), '{}\n')
    writeFileSync(join(vendor, 'manifest.json'), json({
      formatVersion: 2,
      version,
      registry: 'https://registry.npmjs.org',
      repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
      commit,
      patches: [],
      packages: [{
        name: '@deepseek-ai/dsh',
        filename,
        size: bytes.byteLength,
        sha256: digest(bytes),
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
        license: 'MIT',
      }],
    }))
    return { archive, filename }
  }

  try {
    mkdirSync(join(directory, 'scripts'), { recursive: true })
    mkdirSync(join(directory, 'dsh-plugin-desktop'), { recursive: true })
    mkdirSync(join(directory, 'dsh-plugin-gala'), { recursive: true })
    cpSync(join(repoRoot, 'scripts', 'dsh-version.mjs'), join(directory, 'scripts', 'dsh-version.mjs'))
    cpSync(join(repoRoot, 'scripts', 'set-dsh-version.mjs'), join(directory, 'scripts', 'set-dsh-version.mjs'))
    const currentVendor = createVendor(CURRENT, '1'.repeat(40))
    const targetVendor = createVendor(nextVersion, '2'.repeat(40))
    const dependencyManifest = name => ({
      name,
      private: true,
      dependencies: { '@deepseek-ai/dsh': CURRENT },
    })
    writeFileSync(join(directory, 'package.json'), json({
      ...dependencyManifest('synthetic-root'),
      resolutions: {
        '@deepseek-ai/dsh': `file:vendor/dsh-runtime/${CURRENT}/${currentVendor.filename}`,
        'unrelated@npm:1.0.0': 'npm:1.0.0',
      },
    }))
    writeFileSync(join(directory, 'dsh-plugin-desktop', 'package.json'), json(dependencyManifest('synthetic-desktop')))
    writeFileSync(join(directory, 'dsh-plugin-gala', 'package.json'), json(dependencyManifest('synthetic-gala')))
    writeFileSync(join(directory, 'upstream.json'), json({
      repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
      commit: '1'.repeat(40),
      sourceVersion: CURRENT,
      runtimePackageVersion: CURRENT,
      runtimeSource: `vendor/dsh-runtime/${CURRENT}/manifest.json`,
    }))
    writeFileSync(join(directory, 'yarn.lock'), 'immutable-lock-sentinel\n')
    writeFileSync(join(directory, 'staged.txt'), 'committed\n')
    writeFileSync(join(directory, 'unstaged.txt'), 'committed\n')
    assert.equal(run('git', ['init']).status, 0)
    assert.equal(run('git', ['config', 'user.email', 'qa@example.invalid']).status, 0)
    assert.equal(run('git', ['config', 'user.name', 'Version QA']).status, 0)
    assert.equal(run('git', ['add', '.']).status, 0)
    assert.equal(run('git', ['commit', '-m', 'synthetic baseline']).status, 0)
    writeFileSync(join(directory, 'staged.txt'), 'staged sentinel\n')
    assert.equal(run('git', ['add', 'staged.txt']).status, 0)
    writeFileSync(join(directory, 'unstaged.txt'), 'unstaged sentinel\n')

    const indexBefore = run('git', ['diff', '--cached', '--binary']).stdout
    const unstagedBefore = run('git', ['diff', '--', 'unstaged.txt']).stdout
    const lockBefore = readFileSync(join(directory, 'yarn.lock'))
    const currentArchiveBefore = readFileSync(currentVendor.archive)
    const targetArchiveBefore = readFileSync(targetVendor.archive)
    const result = run(process.execPath, ['scripts/set-dsh-version.mjs', nextVersion])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /source and manifests updated; vendor and yarn\.lock were not changed/u)
    for (const file of ['package.json', 'dsh-plugin-desktop/package.json', 'dsh-plugin-gala/package.json']) {
      const manifest = JSON.parse(readFileSync(join(directory, file), 'utf8'))
      assert.equal(manifest.dependencies['@deepseek-ai/dsh'], nextVersion)
    }
    const root = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    assert.equal(
      root.resolutions['@deepseek-ai/dsh'],
      `file:vendor/dsh-runtime/${nextVersion}/${targetVendor.filename}`,
    )
    assert.equal(root.resolutions['unrelated@npm:1.0.0'], 'npm:1.0.0')
    const upstream = JSON.parse(readFileSync(join(directory, 'upstream.json'), 'utf8'))
    assert.equal(upstream.commit, '2'.repeat(40))
    assert.equal(upstream.runtimePackageVersion, nextVersion)
    assert.deepEqual(readFileSync(join(directory, 'yarn.lock')), lockBefore)
    assert.deepEqual(readFileSync(currentVendor.archive), currentArchiveBefore)
    assert.deepEqual(readFileSync(targetVendor.archive), targetArchiveBefore)
    assert.equal(readFileSync(join(directory, 'staged.txt'), 'utf8'), 'staged sentinel\n')
    assert.equal(readFileSync(join(directory, 'unstaged.txt'), 'utf8'), 'unstaged sentinel\n')
    assert.equal(run('git', ['diff', '--cached', '--binary']).stdout, indexBefore)
    assert.equal(run('git', ['diff', '--', 'unstaged.txt']).stdout, unstagedBefore)
    assert.equal(run('git', ['status', '--porcelain']).stdout.includes('.dsh-version-'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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

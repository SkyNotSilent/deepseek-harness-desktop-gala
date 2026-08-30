import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyManifestRewrite,
  collectRuntimePins,
  collectSandboxResolutions,
  compareVersions,
  findProseSeries,
  isRuntimePackage,
  minorSeries,
  parseVersion,
  planManifestRewrite,
  planResolutionRewrite,
  readPinnedVersion,
  resolutionKeys,
  resolutionValue,
  sandboxPatchPath,
} from './dsh-version.mjs'

const PINNED = '0.1.1-rc.2'
const TARGET = '0.1.2-rc.1'

const desktopManifest = {
  name: 'dsh-plugin-desktop',
  dependencies: {
    '@deepseek-ai/cordis': '4.0.1',
    '@deepseek-ai/cordis-plugin-loader': '1.0.2',
    '@deepseek-ai/dsh': PINNED,
    '@deepseek-ai/dsh-sandbox-windows-acl': PINNED,
    '@deepseek-ai/schemastery': '^3.18.1',
    pnpm: '11.7.0',
  },
  devDependencies: { typescript: '5.9.2' },
  peerDependencies: { electron: '43.4.0' },
}

const galaManifest = {
  name: 'dsh-plugin-gala',
  devDependencies: {
    '@deepseek-ai/cordis': '4.0.1',
    '@deepseek-ai/dsh-agent': PINNED,
  },
  peerDependencies: {
    '@deepseek-ai/cordis': '4.0.1',
    '@deepseek-ai/dsh-client-ui-slots': PINNED,
    react: '18.3.1',
  },
}

const rootResolutions = {
  'app-builder-lib@npm:26.15.3': 'patch:app-builder-lib@npm%3A26.15.3#./patches/app-builder-lib@26.15.3.patch',
  'node-pty@npm:1.2.0-beta.15': 'patch:node-pty@npm%3A1.2.0-beta.15#./patches/node-pty@1.2.0-beta.15.patch',
  [`@deepseek-ai/dsh-sandbox-windows-acl@npm:${PINNED}`]: resolutionValue(PINNED),
  [`@deepseek-ai/dsh-sandbox-windows-acl@npm:^${PINNED}`]: resolutionValue(PINNED),
}

test('orders the upstream prerelease chain by semver precedence', () => {
  const chain = ['0.1.1-rc.2', '0.1.2-alpha.1', '0.1.2-alpha.2', '0.1.2-rc.1', '0.1.2', '0.2.0']
  for (let index = 0; index + 1 < chain.length; index += 1) {
    assert.equal(compareVersions(chain[index], chain[index + 1]), -1, `${chain[index]} < ${chain[index + 1]}`)
    assert.equal(compareVersions(chain[index + 1], chain[index]), 1, `${chain[index + 1]} > ${chain[index]}`)
  }
  assert.deepEqual([...chain].reverse().sort(compareVersions), chain)
})

test('compares equal versions as equal and ignores build metadata', () => {
  assert.equal(compareVersions('0.1.1-rc.2', '0.1.1-rc.2'), 0)
  assert.equal(compareVersions('0.1.2+build.1', '0.1.2+build.9'), 0)
})

test('compares prerelease identifiers numerically, alphanumerically and by length', () => {
  assert.equal(compareVersions('0.1.2-rc.2', '0.1.2-rc.10'), -1)
  assert.equal(compareVersions('0.1.2-1', '0.1.2-alpha'), -1)
  assert.equal(compareVersions('0.1.2-alpha', '0.1.2-alpha.1'), -1)
  assert.equal(compareVersions('0.1.2-alpha.beta', '0.1.2-beta'), -1)
})

test('parseVersion throws on garbage input', () => {
  for (const value of ['', 'latest', '0.1', 'v0.1.2', '0.1.2 ', '0.1.2-', '0.1.2-rc.01', '0.1.2.3']) {
    assert.throws(() => parseVersion(value), /unparseable version|leading zero|empty prerelease/u, `rejects ${JSON.stringify(value)}`)
  }
  assert.throws(() => parseVersion(undefined), TypeError)
  assert.throws(() => parseVersion(112), TypeError)
})

test('parseVersion rejects leading zeroes in the major, minor and patch identifiers', () => {
  for (const value of ['0.1.02', '01.1.0', '0.01.0', '00.0.0', '0.1.00']) {
    assert.throws(() => parseVersion(value), /unparseable version/u, `rejects ${JSON.stringify(value)}`)
  }
  assert.deepEqual(parseVersion('0.10.20').prerelease, [])
  assert.equal(parseVersion('0.10.20').patch, 20)
})

test('parseVersion keeps build metadata separate from the prerelease', () => {
  assert.deepEqual(parseVersion('0.1.2+build.7').prerelease, [])
  assert.equal(parseVersion('0.1.2+build.7').build, 'build.7')
  assert.equal(parseVersion('0.1.2-rc.1+build.7').build, 'build.7')
  assert.deepEqual(parseVersion('0.1.2-rc.1+build.7').prerelease, ['rc', '1'])
})

test('minorSeries strips the prerelease suffix used by marketing prose', () => {
  assert.equal(minorSeries('0.1.1-rc.2'), '0.1.1')
  assert.equal(minorSeries('0.1.2-alpha.1'), '0.1.2')
  assert.equal(minorSeries('0.1.2'), '0.1.2')
  assert.equal(minorSeries('1.2.3+build.4'), '1.2.3')
})

test('isRuntimePackage excludes independently versioned first-party packages', () => {
  assert.equal(isRuntimePackage('@deepseek-ai/dsh'), true)
  assert.equal(isRuntimePackage('@deepseek-ai/dsh-client-ui-slots'), true)
  assert.equal(isRuntimePackage('@deepseek-ai/cordis'), false)
  assert.equal(isRuntimePackage('@deepseek-ai/cordis-plugin-loader'), false)
  assert.equal(isRuntimePackage('@deepseek-ai/schemastery'), false)
  assert.equal(isRuntimePackage('pnpm'), false)
})

test('readPinnedVersion reads the runtime edge and rejects a manifest without it', () => {
  assert.equal(readPinnedVersion(desktopManifest), PINNED)
  assert.throws(() => readPinnedVersion(galaManifest), /declares no @deepseek-ai\/dsh dependency/u)
  assert.throws(() => readPinnedVersion({}), /declares no @deepseek-ai\/dsh dependency/u)
  assert.throws(() => readPinnedVersion({ dependencies: { '@deepseek-ai/dsh': `^${PINNED}` } }), /unparseable version/u)
})

test('collectRuntimePins reports runtime edges from every dependency section', () => {
  assert.deepEqual(collectRuntimePins(galaManifest), [
    { section: 'devDependencies', name: '@deepseek-ai/dsh-agent', version: PINNED },
    { section: 'peerDependencies', name: '@deepseek-ai/dsh-client-ui-slots', version: PINNED },
  ])
})

test('planManifestRewrite rewrites exact runtime pins and leaves cordis and schemastery alone', () => {
  const plan = planManifestRewrite(desktopManifest, PINNED, TARGET)

  assert.deepEqual(plan.changes, [
    { section: 'dependencies', name: '@deepseek-ai/dsh', from: PINNED, to: TARGET },
    { section: 'dependencies', name: '@deepseek-ai/dsh-sandbox-windows-acl', from: PINNED, to: TARGET },
  ])
  const names = plan.changes.map((change) => change.name)
  assert.equal(names.includes('@deepseek-ai/cordis'), false)
  assert.equal(names.includes('@deepseek-ai/cordis-plugin-loader'), false)
  assert.equal(names.includes('@deepseek-ai/schemastery'), false)
  assert.equal(names.includes('pnpm'), false)
  assert.equal(desktopManifest.dependencies['@deepseek-ai/dsh'], PINNED)
})

test('planManifestRewrite spans devDependencies and peerDependencies', () => {
  const plan = planManifestRewrite(galaManifest, PINNED, TARGET)

  assert.deepEqual(plan.changes, [
    { section: 'devDependencies', name: '@deepseek-ai/dsh-agent', from: PINNED, to: TARGET },
    { section: 'peerDependencies', name: '@deepseek-ai/dsh-client-ui-slots', from: PINNED, to: TARGET },
  ])
})

test('planManifestRewrite ignores runtime packages carrying a different specifier', () => {
  const manifest = {
    dependencies: {
      '@deepseek-ai/dsh-agent': `^${PINNED}`,
      '@deepseek-ai/dsh-brand': '0.1.0',
    },
  }

  assert.deepEqual(planManifestRewrite(manifest, PINNED, TARGET).changes, [])
})

test('applyManifestRewrite returns a rewritten copy without touching the source', () => {
  const plan = planManifestRewrite(galaManifest, PINNED, TARGET)
  const next = applyManifestRewrite(galaManifest, plan.changes)

  assert.equal(next.devDependencies['@deepseek-ai/dsh-agent'], TARGET)
  assert.equal(next.peerDependencies['@deepseek-ai/dsh-client-ui-slots'], TARGET)
  assert.equal(next.devDependencies['@deepseek-ai/cordis'], '4.0.1')
  assert.equal(next.peerDependencies.react, '18.3.1')
  assert.equal(galaManifest.devDependencies['@deepseek-ai/dsh-agent'], PINNED)
  assert.deepEqual(Object.keys(next.peerDependencies), Object.keys(galaManifest.peerDependencies))
})

test('sandboxPatchPath and resolution helpers encode the version once', () => {
  assert.equal(sandboxPatchPath(PINNED), 'patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch')
  assert.deepEqual(resolutionKeys(PINNED), [
    '@deepseek-ai/dsh-sandbox-windows-acl@npm:0.1.1-rc.2',
    '@deepseek-ai/dsh-sandbox-windows-acl@npm:^0.1.1-rc.2',
  ])
  assert.equal(
    resolutionValue(PINNED),
    'patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.1-rc.2#./patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch',
  )
})

test('planResolutionRewrite moves both descriptors, the encoded value and the patch filename', () => {
  const plan = planResolutionRewrite(rootResolutions, PINNED, TARGET)

  assert.deepEqual(plan.changes, [
    {
      from: '@deepseek-ai/dsh-sandbox-windows-acl@npm:0.1.1-rc.2',
      to: '@deepseek-ai/dsh-sandbox-windows-acl@npm:0.1.2-rc.1',
      fromValue: resolutionValue(PINNED),
      toValue: resolutionValue(TARGET),
    },
    {
      from: '@deepseek-ai/dsh-sandbox-windows-acl@npm:^0.1.1-rc.2',
      to: '@deepseek-ai/dsh-sandbox-windows-acl@npm:^0.1.2-rc.1',
      fromValue: resolutionValue(PINNED),
      toValue: resolutionValue(TARGET),
    },
  ])
  assert.deepEqual(plan.resolutions, {
    'app-builder-lib@npm:26.15.3': 'patch:app-builder-lib@npm%3A26.15.3#./patches/app-builder-lib@26.15.3.patch',
    'node-pty@npm:1.2.0-beta.15': 'patch:node-pty@npm%3A1.2.0-beta.15#./patches/node-pty@1.2.0-beta.15.patch',
    '@deepseek-ai/dsh-sandbox-windows-acl@npm:0.1.2-rc.1':
      'patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.2-rc.1#./patches/dsh-sandbox-windows-acl@0.1.2-rc.1.patch',
    '@deepseek-ai/dsh-sandbox-windows-acl@npm:^0.1.2-rc.1':
      'patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.2-rc.1#./patches/dsh-sandbox-windows-acl@0.1.2-rc.1.patch',
  })
  assert.deepEqual(Object.keys(plan.resolutions).slice(0, 2), Object.keys(rootResolutions).slice(0, 2))
  assert.deepEqual(Object.keys(rootResolutions).slice(2), [
    '@deepseek-ai/dsh-sandbox-windows-acl@npm:0.1.1-rc.2',
    '@deepseek-ai/dsh-sandbox-windows-acl@npm:^0.1.1-rc.2',
  ])
})

test('planResolutionRewrite refuses a missing or hand-edited sandbox resolution', () => {
  assert.throws(() => planResolutionRewrite({}, PINNED, TARGET), /missing/u)
  assert.throws(
    () => planResolutionRewrite({ ...rootResolutions, [`@deepseek-ai/dsh-sandbox-windows-acl@npm:${PINNED}`]: 'patch:whatever' }, PINNED, TARGET),
    /does not carry the expected patch value/u,
  )
})

test('collectSandboxResolutions selects only the sandbox descriptors', () => {
  assert.deepEqual(collectSandboxResolutions(rootResolutions), [
    { key: `@deepseek-ai/dsh-sandbox-windows-acl@npm:${PINNED}`, value: resolutionValue(PINNED) },
    { key: `@deepseek-ai/dsh-sandbox-windows-acl@npm:^${PINNED}`, value: resolutionValue(PINNED) },
  ])
  assert.deepEqual(collectSandboxResolutions(undefined), [])
})

test('findProseSeries captures the upstream series in both prose languages', () => {
  const text = [
    '- 🖼️ **Multimodal chat** — tracks DeepSeek Harness 0.1.1 with image input.',
    '<p>跟随上游 0.1.1，支持图片输入。</p>',
    'DeepSeek Harness Desktop Gala 2.1.0-preview.4 ships today.',
    'Nothing to see here.',
  ].join('\n')

  assert.deepEqual(findProseSeries(text), [
    { line: 1, series: '0.1.1' },
    { line: 2, series: '0.1.1' },
  ])
  assert.deepEqual(findProseSeries('no version at all'), [])
})

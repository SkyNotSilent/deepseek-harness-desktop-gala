import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../', import.meta.url)
const workspaceRoot = new URL('../', packageRoot)
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  name?: unknown
  version?: unknown
  desktopUpdateMode?: unknown
  bin?: Record<string, unknown>
  exports?: Record<string, unknown>
  files?: unknown
  scripts?: Record<string, unknown>
  dsh?: { bundle?: { patch?: unknown }; client?: unknown }
  build?: {
    productName?: unknown
    appId?: unknown
    asarUnpack?: unknown
    afterPack?: unknown
    electronUpdaterCompatibility?: unknown
    publish?: unknown
    electronFuses?: unknown
    files?: unknown
    mac?: {
      artifactName?: unknown
      entitlements?: unknown
      entitlementsInherit?: unknown
      extendInfo?: unknown
      hardenedRuntime?: unknown
      icon?: unknown
      notarize?: unknown
      target?: unknown
    }
    win?: { icon?: unknown; target?: unknown }
    nsis?: Record<string, unknown>
    linux?: { icon?: unknown }
  }
  dependencies?: Record<string, unknown>
  optionalDependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
}
const workspaceManifest = JSON.parse(readFileSync(new URL('package.json', workspaceRoot), 'utf8')) as {
  version?: unknown
  workspaces?: unknown
  resolutions?: Record<string, unknown>
  scripts?: Record<string, unknown>
}

describe('published package surface', () => {
  it('registers both npm launcher names', () => {
    expect(manifest.name).toBe('dsh-plugin-desktop')
    expect(manifest.bin).toEqual({
      'dsh-plugin-desktop': 'lib/bin.js',
      'dsh-desktop': 'lib/bin.js',
    })
  })

  it('exposes the Host plugin and desktop-owned client face', () => {
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./windows-pwsh-sandbox', {
      types: './lib/types/windows-pwsh-sandbox.d.ts',
      default: './lib/windows-pwsh-sandbox.js',
    })
    expect(manifest.exports).toHaveProperty('./terminal', {
      types: './lib/types/terminal.d.ts',
      default: './lib/terminal.js',
    })
    expect(manifest.exports).toHaveProperty('./pnpm', {
      types: './lib/types/pnpm.d.ts',
      default: './lib/pnpm.js',
    })
    expect(manifest.exports).toHaveProperty('./profile-service', {
      types: './lib/types/profile-service.d.ts',
      default: './lib/profile-service.js',
    })
    expect(manifest.exports).toHaveProperty('./profiles', {
      types: './lib/types/profiles.d.ts',
      default: './lib/profiles.js',
    })
    expect(manifest.exports).toHaveProperty('./updates', {
      types: './lib/types/updates.d.ts',
      default: './lib/updates.js',
    })
    expect(manifest.exports).not.toHaveProperty('./windows-acl-runner')
    expect(manifest.exports).not.toHaveProperty('./desktop-cli')
    expect(manifest.exports).not.toHaveProperty('./desktop-runtime-environment')
    expect(manifest.exports).not.toHaveProperty('./desktop-terminal')
    expect(manifest.exports).not.toHaveProperty('./update-checker')
    expect(manifest.exports).not.toHaveProperty('./update-download')
    expect(manifest.exports).toHaveProperty('./package.json')
    expect(manifest.dsh?.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect(manifest.dsh?.client).toEqual({
      platform: 'web',
      inject: [
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-ui-conversation',
        '@deepseek-ai/dsh-client-ui-sidebar',
        '@deepseek-ai/dsh-client-ui-theme',
      ],
    })
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop')
    const desktopPatch = readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')
    expect(desktopPatch).toContain('name: dsh-plugin-gala')
    expect(desktopPatch).toContain('openBrowser: false')
    expect(manifest.dependencies?.['dsh-plugin-gala']).toBe('workspace:*')
    expect(workspaceManifest.workspaces).toEqual(['dsh-plugin-desktop', 'dsh-plugin-gala'])
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/terminal')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/pnpm')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/profiles')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/updates')
  })

  it('keeps unaudited marketplace packages out of the published runtime', () => {
    expect(manifest.dependencies).not.toHaveProperty('dshmarket')
    expect(manifest.optionalDependencies ?? {}).not.toHaveProperty('dshmarket')
  })

  it('builds public Host plugins and their private native bootstraps', () => {
    const config = readFileSync(new URL('tsdown.config.ts', packageRoot), 'utf8')

    expect(config).toContain("'windows-pwsh-sandbox': 'src/windows-pwsh-sandbox.ts'")
    expect(config).toContain("'windows-acl-runner': 'src/windows-acl-runner.ts'")
    expect(config).toContain("'desktop-cli': 'src/desktop-cli.ts'")
    expect(config).toContain("'desktop-runtime-environment': 'src/desktop-runtime-environment.ts'")
    expect(config).toContain("'desktop-fault-log': 'src/desktop-fault-log.ts'")
    expect(config).toContain("'gui-path': 'src/gui-path.ts'")
    expect(config).toContain("'desktop-terminal': 'src/desktop-terminal.ts'")
    expect(config).toContain("'profile-manager': 'src/profile-manager.ts'")
    expect(config).toContain("'profile-service': 'src/profile-service.ts'")
    expect(config).toContain("pnpm: 'src/pnpm.ts'")
    expect(config).toContain("profiles: 'src/profiles.ts'")
    expect(config).toContain("terminal: 'src/terminal.ts'")
    expect(config).not.toContain("'update-download': 'src/update-download.ts'")
    expect(config).toContain("updates: 'src/updates.ts'")
  })

  it('installs the bundled Node/pnpm PATH after the launch snapshot and before profile boot', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const snapshot = main.indexOf('const environment = loadLayeredEnv')
    const install = main.indexOf('const pnpmRuntime = installDesktopPnpmRuntime')
    const prepare = main.indexOf('const prepared = prepareDesktopProfile')
    const boot = main.indexOf('const ctx = await boot')

    expect(snapshot).toBeGreaterThanOrEqual(0)
    expect(install).toBeGreaterThan(snapshot)
    expect(prepare).toBeGreaterThan(install)
    expect(boot).toBeGreaterThan(prepare)
    expect(main).toContain("'dsh-plugin-desktop: packaged pnpm runtime PATH'")
    expect(main).toContain('disposePnpmRuntime?.()')
    expect(main).toContain("faultLog.write('pty-creation-failure', warning)")
    expect(main).toContain('uploadToServer: false')
    expect(main).not.toContain("process.on('unhandledRejection'")
  })

  it('fixes the installed application identity', () => {
    expect(manifest.version).toBe(workspaceManifest.version)
    expect(manifest.desktopUpdateMode).toBe('manual-release')
    expect(manifest.build?.productName).toBe('DeepSeek Harness Desktop Gala')
    expect(manifest.build?.appId).toBe('io.github.skynotsilent.harnessgala')
    expect(manifest.build?.asarUnpack).toEqual([
      'package.json',
      'cordis.patch.yml',
      'build/**',
      'lib/**',
      'node_modules/**',
    ])
    expect(manifest.build?.electronFuses).toEqual({ runAsNode: true })
    expect(manifest.build?.electronUpdaterCompatibility).toBe('>=2.16')
    expect(manifest.build?.publish).toEqual([{
      provider: 'github',
      owner: 'SkyNotSilent',
      repo: 'deepseek-harness-desktop-gala',
    }])
    expect(JSON.stringify(manifest.build)).not.toContain('verifyUpdateCodeSignature')
    expect(manifest.files).toEqual(expect.arrayContaining([
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/tray-icon.svg',
      'build/tray-icon*.png',
      'docs/**',
    ]))
    expect(manifest.build?.files).toEqual([
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/tray-icon.svg',
      'build/tray-icon*.png',
      'cordis.patch.yml',
      'lib/**',
      'package.json',
      '!node_modules/dsh-plugin-gala/{src,scripts,tests}/**',
      '!node_modules/dsh-plugin-gala/{tsconfig*.json,tsdown.config.ts,vitest.config.ts}',
    ])
    expect(manifest.build?.mac?.icon).toBe('build/app-icon-mac.png')
    expect(manifest.build?.mac?.artifactName).toBe('DeepSeek-Harness-Desktop-Gala-${version}-${arch}.${ext}')
    expect(manifest.build?.mac?.extendInfo).toEqual({
      NSDocumentsFolderUsageDescription: '用于读取和写入你明确选择的 Documents 工作区。',
      NSDesktopFolderUsageDescription: '用于读取和写入你明确选择的 Desktop 工作区。',
      NSDownloadsFolderUsageDescription: '用于读取和写入你明确选择的 Downloads 工作区。',
    })
    expect(JSON.stringify(manifest.build?.mac)).not.toContain('NSAppleEventsUsageDescription')
    expect(manifest.build?.win?.icon).toBe('build/app-icon.png')
    expect(manifest.build?.win?.target).toEqual([{
      target: 'nsis',
      arch: ['x64'],
    }])
    expect(manifest.build?.nsis).toEqual({
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'DeepSeek Harness Desktop Gala',
      artifactName: 'DeepSeek-Harness-Desktop-Gala-${version}-${arch}-Setup.${ext}',
    })
    expect(manifest.build?.linux?.icon).toBe('build/app-icon.png')
  })

  it('separates unsigned smoke packaging from the signed macOS release', () => {
    const packageDir = readFileSync(new URL('scripts/package-dir.mjs', packageRoot), 'utf8')

    expect(manifest.scripts?.build).toContain('node scripts/generate-mac-app-icon.mjs')
    expect(manifest.scripts?.['package:dir']).toBe('yarn run build && node scripts/package-dir.mjs')
    expect(packageDir).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'")
    expect(manifest.scripts?.['dist:mac']).toBe('node scripts/release-mac.ts')
    expect(manifest.scripts?.['publish:preview']).toBe('node scripts/publish-preview.ts')
    expect(manifest.scripts?.['verify:mac-smoke']).toBe('node scripts/verify-mac-smoke.ts')
    expect(manifest.scripts?.['dist:win']).toBe('node scripts/package-win.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run build')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run typecheck')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/package-win.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/update-checker.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/updates.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run verify:closure')
    expect(manifest.scripts?.['verify:cli']).toBe('node scripts/verify-cli-runtime.mjs')
    expect(manifest.scripts?.check).toContain('yarn run verify:cli')
    expect(workspaceManifest.scripts?.['dist:mac']).toBe('yarn workspace dsh-plugin-desktop dist:mac')
    expect(workspaceManifest.scripts?.['dist:win'])
      .toBe('yarn workspace dsh-plugin-desktop dist:win')
    expect(workspaceManifest.scripts?.['publish:preview'])
      .toBe('yarn workspace dsh-plugin-desktop publish:preview')
    expect(manifest.build?.afterPack).toBe('./scripts/verify-packaged-runtime.ts')
    expect(manifest.build?.mac).toEqual(expect.objectContaining({
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.inherit.plist',
      hardenedRuntime: false,
      notarize: false,
      target: ['dmg', 'zip'],
    }))
    expect(manifest.devDependencies?.['@electron/asar']).toBe('3.4.1')
  })

  it('pins the node-pty asar-unpacked fix through one Yarn patch resolution', () => {
    expect(workspaceManifest.resolutions?.['node-pty@npm:1.2.0-beta.15'])
      .toBe('patch:node-pty@npm%3A1.2.0-beta.15#./patches/node-pty@1.2.0-beta.15.patch')
    const patch = readFileSync(new URL('patches/node-pty@1.2.0-beta.15.patch', workspaceRoot), 'utf8')
    expect(patch).toContain("!helperPath.includes('app.asar.unpacked')")
    expect(patch).toContain("!helperPath.includes('node_modules.asar.unpacked')")
    expect(patch).toContain('NODE_PTY_SPAWN_HELPER_MISSING')
  })

  it('keeps CI macOS packages as smoke artifacts and creates only a draft Release', () => {
    const previewWorkflow = readFileSync(
      new URL('.github/workflows/preview-release.yml', workspaceRoot),
      'utf8',
    )

    expect(previewWorkflow).toContain('Build ad-hoc signed artifacts')
    expect(previewWorkflow).toContain('--config.mac.identity=-')
    expect(previewWorkflow).toContain('--config.forceCodeSigning=true')
    expect(previewWorkflow).toContain('codesign --verify --deep --strict --verbose=4')
    expect(previewWorkflow).toContain('hdiutil verify "$dmg"')
    expect(previewWorkflow).toContain('node scripts/verify-mac-smoke.ts')
    expect(previewWorkflow).toContain('corepack yarn workspace dsh-plugin-desktop test')
    expect(previewWorkflow).toContain('name: windows')
    expect(previewWorkflow).toContain('--draft')
    expect(previewWorkflow).not.toContain('merge-multiple: true')
    expect(previewWorkflow).not.toContain('Create checksums')
  })

  it('keeps one fixed brand-blue tray source for generated native assets', () => {
    const source = readFileSync(new URL('build/tray-icon.svg', packageRoot), 'utf8')

    expect(source.match(/#4D6BFE/gu)).toHaveLength(1)
    expect(source).not.toMatch(/<style\b|prefers-color-scheme/iu)
    for (const filename of [
      'tray-iconTemplate.png',
      'tray-iconTemplate@2x.png',
      'tray-icon-blue.png',
      'tray-icon-blue@1.25x.png',
      'tray-icon-blue@1.5x.png',
      'tray-icon-blue@2x.png',
    ]) {
      expect(readFileSync(new URL(`build/${filename}`, packageRoot)).byteLength).toBeGreaterThan(0)
    }
  })

  it('keeps the shared Gala whale source icon unmodified', () => {
    // 2026-08-23 起换为“群星”版图标：渐变鲸鱼 + 十位角色头像环绕。
    const digest = createHash('sha256')
      .update(readFileSync(new URL('build/app-icon.png', packageRoot)))
      .digest('hex')

    expect(digest).toBe('7a11df0ac27662c48487de165c268e329bb31f42b66511469c83fc706cae9659')
  })

  it('generates a centered macOS icon with a 100-pixel visual inset', async () => {
    const source = await sharp(readFileSync(new URL('build/app-icon.png', packageRoot))).metadata()
    const icon = sharp(readFileSync(new URL('build/app-icon-mac.png', packageRoot)))
    const metadata = await icon.metadata()
    const stats = await icon.stats()
    const { info } = await icon
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
      .toBuffer({ resolveWithObject: true })

    expect(metadata).toEqual(expect.objectContaining({
      format: 'png',
      width: 1024,
      height: 1024,
      space: 'srgb',
      depth: 'uchar',
      bitsPerSample: 8,
      channels: 4,
      hasAlpha: true,
    }))
    expect(metadata.icc).toEqual(source.icc)
    for (const channel of stats.channels.slice(0, 3)) {
      expect(channel.max).toBeGreaterThan(200)
      expect(channel.mean).toBeGreaterThan(20)
    }
    expect(info).toEqual(expect.objectContaining({
      width: 824,
      height: 824,
      trimOffsetLeft: -100,
      trimOffsetTop: -100,
    }))
  })

  it('keeps Electron out of production dependencies consumed by electron-builder', () => {
    expect(manifest.dependencies).not.toHaveProperty('electron')
    expect(manifest.peerDependencies?.electron).toBe('43.4.0')
    expect(manifest.devDependencies?.electron).toBe('43.4.0')
    expect(manifest.dependencies?.pnpm).toBe('11.7.0')
  })

  it('resolves electron-builder through the pinned app-builder-lib keychain patch', () => {
    const patchResolution = 'patch:app-builder-lib@npm%3A26.15.3#./patches/app-builder-lib@26.15.3.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(new URL('patches/app-builder-lib@26.15.3.patch', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const electronBuilderManifest = workspaceRequire.resolve('electron-builder/package.json')
    const electronBuilderRequire = createRequire(electronBuilderManifest)
    const appBuilderManifest = electronBuilderRequire.resolve('app-builder-lib/package.json')
    const installedCodeSign = readFileSync(join(dirname(appBuilderManifest), 'out/codeSign/macCodeSign.js'), 'utf8')

    expect(workspaceManifest.resolutions).toMatchObject({
      'app-builder-lib@npm:26.15.3': patchResolution,
    })
    expect(lockfile).toContain('app-builder-lib@patch:app-builder-lib@npm%3A26.15.3#./patches/app-builder-lib@26.15.3.patch')
    expect(patch).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
    expect(patch).toContain('"-k", keychainPassword, keychainFile')
    expect(installedCodeSign).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
    expect(installedCodeSign).toContain('"-k", keychainPassword, keychainFile')
  })

  it('starts restricted Windows shells with a hidden console show state', () => {
    const runtimeVersion = String(manifest.dependencies?.['@deepseek-ai/dsh'])
    expect(runtimeVersion).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
    const sandboxPatchPath = `patches/dsh-sandbox-windows-acl@${runtimeVersion}.patch`
    const patchResolution = `patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A${runtimeVersion}#./${sandboxPatchPath}`
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(new URL(sandboxPatchPath, workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const sandboxManifest = workspaceRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json')
    const sandboxLocalManifest = workspaceRequire.resolve('@deepseek-ai/dsh-sandbox-local/package.json')
    const sandboxLocalRequire = createRequire(sandboxLocalManifest)
    const sandboxLib = join(dirname(sandboxManifest), 'lib')
    const runtimeChunks = readdirSync(sandboxLib).filter(name => /^types-.*\.js$/u.test(name))

    expect(workspaceManifest.resolutions).toMatchObject({
      [`@deepseek-ai/dsh-sandbox-windows-acl@npm:${runtimeVersion}`]: patchResolution,
      [`@deepseek-ai/dsh-sandbox-windows-acl@npm:^${runtimeVersion}`]: patchResolution,
    })
    expect(sandboxLocalRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json'))
      .toBe(sandboxManifest)
    expect(lockfile).toContain(`@deepseek-ai/dsh-sandbox-windows-acl@${patchResolution}`)
    expect(patch.match(/^\+\s*dwFlags: 257,\r?$/gmu)).toHaveLength(2)
    expect(patch.match(/^\+\s*wShowWindow: 0,\r?$/gmu)).toHaveLength(2)
    expect(runtimeChunks).toHaveLength(1)
    const installedRuntime = readFileSync(join(sandboxLib, runtimeChunks[0] as string), 'utf8')
    expect(installedRuntime.match(/dwFlags: 257,/gu)).toHaveLength(2)
    expect(installedRuntime.match(/wShowWindow: 0,/gu)).toHaveLength(2)
    expect(installedRuntime).toContain('api.createProcessAsUserW(token, null, commandLine, null, null, 1, 0, null')
    expect(installedRuntime).toContain('api.createProcessAsUserW(token, null, commandLine, null, null, 1, 4, null')
    expect(installedRuntime).not.toContain('134217728')
  })
})

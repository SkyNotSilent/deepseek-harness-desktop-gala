import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createGalaLayer,
  createGalaService,
  createDisabledGalaService,
  type GalaHostAdapter,
  type GalaNative,
  type GalaWorkspaceHost,
} from '../src/index.ts'

function fixture(): { adapter: GalaHostAdapter; native: GalaNative; detach: ReturnType<typeof vi.fn> } {
  const root = mkdtempSync(join(tmpdir(), 'gala-plugin-'))
  const native: GalaNative = {
    insertCss: async () => 'css-key',
    removeCss: async () => {},
    openPanel: vi.fn(),
    registerShortcut: () => () => {},
    confirm: async () => true,
    chooseGgal: async () => undefined,
    resolveConflict: async () => ({ action: 'skip' }),
    notify: () => {},
    relaunch: () => {},
  }
  const detach = vi.fn()
  return {
    native,
    detach,
    adapter: {
      userDataDir: root,
      profileDir: root,
      packages: [],
      bundles: { read: () => [], write: () => {} },
      native,
      configureOrigin: vi.fn(),
      attach: vi.fn(() => detach),
    },
  }
}

describe('Gala Cordis service contract', () => {
  it('activates and disposes native bindings exactly once', async () => {
    const { adapter, native, detach } = fixture()
    const layer = createGalaLayer({
      userDataDir: adapter.userDataDir,
      profileDir: adapter.profileDir,
      packages: adapter.packages,
      bundles: adapter.bundles,
      native,
    })
    const service = createGalaService(adapter, layer, 'http://127.0.0.1:4321')

    expect(service.panel.count()).toBeGreaterThan(0)
    service.rpc.open('gallery')
    expect(native.openPanel).toHaveBeenCalledWith('gallery')

    await service.activate()
    await service.activate()
    expect(adapter.attach).toHaveBeenCalledTimes(1)

    service.dispose()
    service.dispose()
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('degrades assembly failure to an inert service', async () => {
    const service = createDisabledGalaService(new Error('broken assets'))
    await expect(service.activate()).resolves.toBeUndefined()
    expect(service.panel.count()).toBe(0)
    expect(service.panel.picker().girls).toEqual([])
    await expect(service.rpc.applySkin('gala:missing')).rejects.toThrow('broken assets')
    expect(() => service.dispose()).not.toThrow()
  })

  it('isolated mode prepares a persona Profile before switching appearance', async () => {
    const { adapter: baseAdapter, native } = fixture()
    const switchWorkspace = vi.fn(async () => ({ restarted: true, profileName: 'gala-dsh-llm' }))
    const disable = vi.fn(async () => ({ restarted: true, profileName: 'desktop' }))
    native.confirmWorkspaceSwitch = vi.fn(async () => true)
    const workspaces: GalaWorkspaceHost = {
      appearanceStorePath: join(baseAdapter.userDataDir, 'appearance.json'),
      summary: () => ({
        mode: 'isolated',
        sharedProfile: 'desktop',
        activeWorkspace: null,
        restartRequired: false,
        plugins: [],
      }),
      enable: async () => ({ mode: 'isolated', sharedProfile: 'desktop', activeWorkspace: null, restartRequired: false, plugins: [] }),
      disable,
      switchWorkspace,
      stagePlugins: async () => ({ mode: 'isolated', sharedProfile: 'desktop', activeWorkspace: null, restartRequired: false, plugins: [] }),
      applyPlugins: async () => {},
    }
    const adapter: GalaHostAdapter = { ...baseAdapter, workspaces }
    const layer = createGalaLayer({
      userDataDir: adapter.userDataDir,
      profileDir: adapter.profileDir,
      packages: adapter.packages,
      bundles: adapter.bundles,
      native,
      workspaces,
      appearanceStorePath: workspaces.appearanceStorePath,
    })
    const service = createGalaService(adapter, layer, 'http://127.0.0.1:4321')

    await service.rpc.applySkin('gala:skin-dsh-llm')
    expect(native.confirmWorkspaceSwitch).toHaveBeenCalledWith('灵灵')
    expect(switchWorkspace).toHaveBeenCalledWith(
      { personaId: 'gala:dsh-llm', name: '灵灵' },
      'gala:skin-dsh-llm',
    )
    expect(layer.skin.current()).toBeUndefined()

    await service.rpc.restoreOriginal?.('exit-isolated')
    expect(disable).toHaveBeenCalledWith(null)
  })
})

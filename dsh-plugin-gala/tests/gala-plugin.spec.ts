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
})

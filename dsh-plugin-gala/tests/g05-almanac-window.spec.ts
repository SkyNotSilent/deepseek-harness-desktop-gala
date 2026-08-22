import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGalaRegistry } from '../src/gala-registry.ts'
import { createGalaCollectionStore } from '../src/gala-collection.ts'
import {
  createGalaGalleryService,
  GALLERY_ACCELERATOR,
} from '../src/gala-gallery.ts'

describe('gala almanac window（G5）', () => {
  it('opens the almanac window via open()', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g05-'))
    const openWindow = vi.fn()
    const gallery = createGalaGalleryService({
      registry: createGalaRegistry(),
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [],
      openWindow,
    })

    gallery.open()

    expect(openWindow).toHaveBeenCalledTimes(1)
  })

  it('registers Cmd/Ctrl+Shift+G and invokes open on trigger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g05-'))
    const openWindow = vi.fn()
    let handler: (() => void) | undefined
    const registerShortcut = vi.fn((_accelerator: string, callback: () => void) => {
      handler = callback
      return () => { handler = undefined }
    })
    const gallery = createGalaGalleryService({
      registry: createGalaRegistry(),
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [],
      openWindow,
      registerShortcut,
    })

    const cleanup = gallery.registerGalleryShortcut()

    expect(registerShortcut).toHaveBeenCalledWith(GALLERY_ACCELERATOR, expect.any(Function))
    expect(GALLERY_ACCELERATOR).toBe('CommandOrControl+Shift+G')
    expect(openWindow).not.toHaveBeenCalled()
    handler?.()
    expect(openWindow).toHaveBeenCalledTimes(1)

    cleanup()
    expect(handler).toBeUndefined()
  })

  it('re-registration replaces the previous shortcut', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g05-'))
    const openWindow = vi.fn()
    const handlers: Array<() => void> = []
    const registerShortcut = vi.fn((_accelerator: string, callback: () => void) => {
      handlers.push(callback)
      return () => { const i = handlers.indexOf(callback); if (i >= 0) handlers.splice(i, 1) }
    })
    const gallery = createGalaGalleryService({
      registry: createGalaRegistry(),
      collection: createGalaCollectionStore(join(dir, 'collection.json')),
      recipes: () => [],
      openWindow,
      registerShortcut,
    })

    gallery.registerGalleryShortcut()
    gallery.registerGalleryShortcut()

    expect(registerShortcut).toHaveBeenCalledTimes(2)
    expect(handlers).toHaveLength(1)
    handlers[0]?.()
    expect(openWindow).toHaveBeenCalledTimes(1)
  })
})

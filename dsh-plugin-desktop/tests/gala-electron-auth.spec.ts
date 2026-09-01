import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import { GALA_HTTP_PREFIX } from 'dsh-plugin-gala'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopRuntime } from '../src/runtime.ts'

const electron = vi.hoisted(() => {
  const windows: BrowserWindow[] = []

  class BrowserWindow {
    static getAllWindows(): BrowserWindow[] { return windows }
    readonly loadURL = vi.fn(async (_url: string) => {})
    readonly show = vi.fn()
    readonly focus = vi.fn()
    readonly isDestroyed = vi.fn(() => false)
    readonly on = vi.fn()
    readonly once = vi.fn()
    readonly webContents: {
      session: object
      insertCSS: ReturnType<typeof vi.fn>
      removeInsertedCSS: ReturnType<typeof vi.fn>
      on: ReturnType<typeof vi.fn>
      setWindowOpenHandler: ReturnType<typeof vi.fn>
    }

    constructor(readonly options: { webPreferences?: { session?: object } } = {}) {
      this.webContents = {
        session: options.webPreferences?.session ?? {},
        insertCSS: vi.fn(async () => 'css-key'),
        removeInsertedCSS: vi.fn(async () => {}),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      }
      windows.push(this)
    }
  }

  return {
    BrowserWindow,
    windows,
    dialog: {
      showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    },
    globalShortcut: {
      register: vi.fn(() => true),
      unregister: vi.fn(),
    },
  }
})

vi.mock('electron', () => electron)

function runtime(): DesktopRuntime {
  return {
    updates: { notify: vi.fn() },
    requestRestart: vi.fn(async () => {}),
    registerTrayItem: vi.fn(() => ({ refresh: vi.fn(), dispose: vi.fn() })),
  } as unknown as DesktopRuntime
}

describe('Gala Electron authentication session', () => {
  beforeEach(() => {
    electron.windows.length = 0
    vi.clearAllMocks()
  })

  it('creates the Gala panel in the exact authenticated main-window session', async () => {
    const { createGalaHostAdapter } = await import('../src/gala-electron.ts')
    const main = new electron.BrowserWindow()
    const adapter = createGalaHostAdapter({
      runtime: runtime(),
      userDataDir: '/tmp/gala-user-data',
      profileDir: '/tmp/gala-profile',
      packages: [],
      bundles: { read: () => [], write: () => {} },
      targetWindow: () => main as unknown as ElectronBrowserWindow,
    })
    adapter.configureOrigin('http://127.0.0.1:43120')

    adapter.native.openPanel('skins')

    const panel = electron.windows[1]
    expect(panel?.options.webPreferences?.session).toBe(main.webContents.session)
    expect(panel?.loadURL).toHaveBeenCalledWith(
      `http://127.0.0.1:43120${GALA_HTTP_PREFIX}/panel?view=skins`,
    )
    expect(new URL(panel?.loadURL.mock.calls[0]?.[0] as string).searchParams.has('token')).toBe(false)
  })
})

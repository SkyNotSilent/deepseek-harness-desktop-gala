/**
 * Gala 层的 Electron 适配（原生能力实现 + 托盘/快捷键接线）— PRD v4.0 §9.4 / §11.6 / §14.2
 *
 * 这里是唯一 import electron 的 Gala 文件：把 webContents.insertCSS、
 * globalShortcut、dialog、BrowserWindow 包成 `GalaNative` 交给纯装配层
 * gala-host.ts，并装配 Gala HTTP 处理器（面板从 loopback webServer 加载）。
 * 单测覆盖装配层与页面生成，本文件只做薄适配，保持单测 headless。
 */

import { BrowserWindow, dialog, globalShortcut, type MessageBoxOptions } from 'electron'
import {
  GALA_HTTP_PREFIX,
  type ConflictResolution,
  type GalaBundleAccess,
  type GalaHostAdapter,
  type GalaNative,
  type GalaPackageSource,
  type GalaService,
} from 'dsh-plugin-gala'
import type { DesktopRuntime, DesktopTrayItemRegistration } from './runtime.ts'

/** 面板窗口尺寸（PRD §14.2） */
const PANEL_WINDOW_WIDTH = 920
const PANEL_WINDOW_HEIGHT = 680

/** 换肤面板快捷键（PRD §14.2） */
export const SKINS_ACCELERATOR = 'CommandOrControl+Shift+S'

/** 冲突对话框按钮顺序（PRD §11.6） */
const CONFLICT_BUTTONS = ['覆盖', '跳过', '重命名'] as const

/** 装配 Gala 层所需、由 main.ts 提供的宿主上下文 */
export interface GalaDesktopAdapterOptions {
  runtime: DesktopRuntime
  userDataDir: string
  profileDir: string
  packages: readonly GalaPackageSource[]
  bundles: GalaBundleAccess
  /** 注入皮肤 CSS 的目标窗口（缺省取当前主窗口） */
  targetWindow?: () => BrowserWindow | undefined
}

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
}

/** 原生能力：皮肤注入目标是主窗口 webContents（沙箱不破，§7.1） */
function createNative(options: GalaDesktopAdapterOptions, resolveOrigin: () => string): GalaNative {
  const { runtime } = options
  const resolveWindow = options.targetWindow ?? mainWindow
  let panelWindow: BrowserWindow | undefined

  const requireWindow = (): BrowserWindow => {
    const window = resolveWindow()
    if (window === undefined) throw new Error('gala: 主窗口尚未就绪，无法注入皮肤')
    return window
  }

  return {
    insertCss: css => requireWindow().webContents.insertCSS(css),
    removeCss: key => requireWindow().webContents.removeInsertedCSS(key),

    openPanel: view => {
      const origin = resolveOrigin()
      const url = `${origin}${GALA_HTTP_PREFIX}/panel?view=${encodeURIComponent(view)}`
      if (panelWindow !== undefined && !panelWindow.isDestroyed()) {
        panelWindow.show()
        panelWindow.focus()
        void panelWindow.loadURL(url)
        return
      }
      const window = new BrowserWindow({
        width: PANEL_WINDOW_WIDTH,
        height: PANEL_WINDOW_HEIGHT,
        title: '嘎啦图鉴',
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      panelWindow = window
      window.on('closed', () => { panelWindow = undefined })
      window.once('ready-to-show', () => { window.show() })
      // 面板只允许停留在 Gala 路由；一切外navigation与新窗口拒绝
      window.webContents.on('will-navigate', (event, target) => {
        if (!target.startsWith(`${origin}${GALA_HTTP_PREFIX}/`)) event.preventDefault()
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      void window.loadURL(url)
    },

    registerShortcut: (accelerator, handler) => {
      const registered = globalShortcut.register(accelerator, handler)
      if (!registered) return () => {}
      return () => { globalShortcut.unregister(accelerator) }
    },

    confirm: async message => {
      const dialogOptions: MessageBoxOptions = {
        type: 'question',
        buttons: ['确认', '取消'],
        defaultId: 0,
        cancelId: 1,
        message,
        detail: '合成会替换当前插件配置，并在完成后重启 DeepSeek Harness Desktop Gala。',
      }
      const parent = resolveWindow()
      const result = parent === undefined
        ? await dialog.showMessageBox(dialogOptions)
        : await dialog.showMessageBox(parent, dialogOptions)
      return result.response === 0
    },

    chooseGgal: async () => {
      const result = await dialog.showOpenDialog({
        title: '导入嘎啦包',
        filters: [{ name: '嘎啦包', extensions: ['ggal'] }],
        properties: ['openFile'],
      })
      if (result.canceled) return undefined
      return result.filePaths[0]
    },

    resolveConflict: async id => {
      const result = await dialog.showMessageBox({
        type: 'question',
        buttons: [...CONFLICT_BUTTONS],
        defaultId: 1,
        cancelId: 1,
        message: `${id} 已经在图鉴里了`,
        detail: '覆盖会替换现有嘎啦包；重命名会以新 id 并存保留两份。',
      })
      if (result.response === 0) return { action: 'overwrite' }
      if (result.response === 2) return renameConflict(id)
      return { action: 'skip' }
    },

    notify: (title, body) => { runtime.updates.notify({ title, body }) },

    relaunch: () => {
      void runtime.requestRestart().catch((cause: unknown) => {
        process.stderr.write(
          `dsh-plugin-desktop: gala relaunch failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
        )
      })
    },
  }
}

/**
 * 重命名分支：Electron 无原生文本输入框，这里用带候选 id 的选择对话框，
 * 给出 `<id>-2`…`<id>-4` 三个候选；都不选则跳过。
 */
async function renameConflict(id: string): Promise<ConflictResolution> {
  const base = id.startsWith('gala:') ? id.slice('gala:'.length) : id
  const candidates = [2, 3, 4].map(index => `${base}-${index}`)
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: [...candidates, '取消'],
    defaultId: 0,
    cancelId: candidates.length,
    message: '为新嘎啦包选一个 id',
  })
  const chosen = candidates[result.response]
  if (chosen === undefined) return { action: 'skip' }
  return { action: 'rename', id: chosen }
}

/**
 * 装配 Gala 层：HTTP 处理器 + 托盘命令 + 换肤快捷键。
 * 调用方负责 try/catch（§7.4：Gala 出错只禁用 Gala 层）。
 */
export function createGalaHostAdapter(options: GalaDesktopAdapterOptions): GalaHostAdapter {
  let origin: string | undefined
  const requireOrigin = (): string => {
    if (origin === undefined) throw new Error('gala: loopback origin 尚未配置')
    return origin
  }
  const native = createNative(options, requireOrigin)
  return {
    userDataDir: options.userDataDir,
    profileDir: options.profileDir,
    packages: options.packages,
    bundles: options.bundles,
    native,
    configureOrigin: next => { origin = next },
    attach: service => attachNativeCommands(options.runtime, native, service),
  }
}

function attachNativeCommands(
  runtime: DesktopRuntime,
  native: GalaNative,
  service: GalaService,
): () => void {
  const releaseSkinsShortcut = native.registerShortcut?.(SKINS_ACCELERATOR, () => {
    service.rpc.open('skins')
  })
  const registrations: DesktopTrayItemRegistration[] = [
    runtime.registerTrayItem({
      group: 'tools',
      order: 10,
      label: () => `嘎啦图鉴（${service.panel.count()}）`,
      invoke: () => { service.rpc.open('gallery') },
    }),
    runtime.registerTrayItem({
      group: 'tools',
      order: 11,
      label: () => '换肤面板',
      invoke: () => { service.rpc.open('skins') },
    }),
    runtime.registerTrayItem({
      group: 'tools',
      order: 12,
      label: () => '合成工坊',
      invoke: () => { service.rpc.open('compose') },
    }),
    runtime.registerTrayItem({
      group: 'tools',
      order: 13,
      label: () => '导入嘎啦包…',
      invoke: async () => {
        const imported = await service.rpc.importPackage()
        if (imported) for (const registration of registrations) registration.refresh()
      },
    }),
  ]
  return () => {
    releaseSkinsShortcut?.()
    for (const registration of registrations) registration.dispose()
  }
}

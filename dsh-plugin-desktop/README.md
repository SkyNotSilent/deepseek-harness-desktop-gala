# dsh-plugin-desktop

DeepSeek Harness Desktop Gala 的 Electron 壳。它既是可执行的桌面应用，也是一个普通的 Cordis 插件包：Electron main 进程里启动 DeepSeek Harness 的 Host，Host 通过 `127.0.0.1` 的随机端口提供 Web 界面，窗口加载这个同源页面。渲染进程保持沙箱、无 Node 集成、无 preload 桥。

产品层面的介绍见仓库根目录 [README](../README.md)；本文只讲这个包的职责、运行方式与限制。

## 包内插件行

`cordis.patch.yml` 把以下行插进 profile 的插件树：

| 行 | 作用 |
| --- | --- |
| `gala`（来自 `dsh-plugin-gala`） | 角色、皮肤、图鉴与 `.ggal` 市场；注册 `/_dsh/desktop/gala/*` 路由 |
| `desktop-shell` | `BrowserWindow`、导航策略、`dsh-desktop` 设置命名空间、关闭即隐藏 |
| `desktop-terminal` | 托盘「打开终端」：生成私有 `dsh` / `pnpm` / `node` shim，只对该终端设置 `PATH`（Linux 不提供） |
| `desktop-pnpm` | 公开 service `desktopPnpm` |
| `desktop-profiles` | 公开 service `desktopProfiles` 与托盘 profile 菜单 |
| `desktop-updates` | GitHub Releases 版本检查与更新交接 |
| `desktop-gala-electron` | Gala 的面板窗口、四个托盘项与 `Cmd/Ctrl+Shift+S` |

启动器在 Loader 挂载前向 Host 上下文 `provide` 三个内部对象：`desktopRuntime`（原生适配）、`desktopPnpmBootstrap`（内置 pnpm 的路径与 ABI 事实）、`galaHost`（Gala 需要的目录、包列表与原生能力）。它们不是第三方接口。

## 两种呈现模式

`~/.dsh/settings.yaml` 里的 `dsh-desktop.mode` 是唯一真相，托盘切换与手动编辑都会触发一次有序重启：

```yaml
dsh-desktop:
  mode: compatibility # 或 advanced
```

- **compatibility**（默认）：系统原生窗口，加载 profile 自己的官方布局，桌面客户端不注册任何 slot；Gala 只通过官方座位与 token 叠加。
- **advanced**（macOS / Windows）：启动器禁用官方 `ui-layout` 行，桌面客户端提供 `layout` service 并占用 `root` 座位，保留官方侧边栏与会话组件；macOS 用 vibrancy + 隐藏式标题栏，Windows 用 Mica。Linux 拒绝该值。

## Profile

profile 位于 `~/.dsh/profiles/<name>`，由 `dsh-base` + `dsh-web-app` + 第三方 bundle 组成。`desktop` 是启动器管理的默认 profile；切换 profile 会先持久化目标、再重启，新 profile 只有在 Host 与窗口都成功后才被记为"上次可用"，失败自动回滚一次。上游的 Node 解析钩子只对 `cordis-plugin-loader` 的 bare import 生效，使 profile 本地的第三方包与打包后的回退路径走同一条解析。

## 更新

打包应用启动 60 秒后、之后每 6 小时查询一次 GitHub Releases API；托盘 **Check for Updates…** 立即检查并总是给出结果。行为由打包时写入的 `desktopUpdateMode` 决定：

| 模式 | 条件 | 行为 |
| --- | --- | --- |
| `manual-release` | Preview、未打包、预发布版本号或非 macOS/Windows | 通知并打开 Release 页，不调用下载或安装 |
| `signed-auto` | 签名正式版 | 确认后经 electron-updater 下载，再次确认后重启安装；`autoDownload` 与 `autoInstallOnAppQuit` 关闭 |

`autoUpdater` 的调用只允许出现在 `src/electron-runtime.ts`，更新相关测试会守住这条边界。

## Windows 细节

- PowerShell 沙箱沿用上游 `pwsh-sandbox` 与 ACL 约束；本包只替换为 `dsh-plugin-desktop/windows-pwsh-sandbox` 子路径，通过私有 trampoline 以 Node 模式启动打包的 Electron 可执行文件。根目录的 Yarn patch 给受限进程加上 `STARTF_USESHOWWINDOW + SW_HIDE`，避免弹出控制台黑窗。
- 工作区目录选择固定走 Web UI 的浏览式选择器，不加载原生对话框 worker。
- `node-pty` 使用包内的 win32-x64 ConPTY 预编译文件（`conpty.node`、`conpty_console_list.node`、`conpty/conpty.dll`、`conpty/OpenConsole.exe`），不需要 Visual Studio。

## 开发

从仓库根目录：

```sh
corepack yarn install --immutable
corepack yarn check        # 构建 + 类型 + 测试 + 闭包 + Loader smoke
corepack yarn dev          # 构建后启动图形界面
node dsh-plugin-desktop/lib/bin.js --help   # 无需 Electron 的 CLI 面
```

`check` 里的闭包校验确保生产依赖图中每个必需的一方 peer 都在部署根声明；两个 Loader smoke 在无头环境装配桌面行与一个 profile 本地的第三方行。

## 打包

- `corepack yarn package:dir`：当前平台的未签名目录应用。
- `corepack yarn dist:mac`：签名 + 公证 + 盖票的 DMG 与 ZIP（需要证书与公证凭据，见 [发布流程](../docs/release.md)）。
- `corepack yarn dist:win`：只能在 Windows x64 主机运行，生成未签名 NSIS 安装包并校验 PE 文件。

electron-builder 把完整依赖树放在 `app.asar.unpacked`，`afterPack` 钩子 `scripts/verify-packaged-runtime.ts` 校验必需入口；`build/app-icon.png` 由 `scripts/generate-app-icon-source.mjs` 从 Gala 立绘生成，`generate-mac-app-icon.mjs` 与 `generate-tray-icons.mjs` 在每次构建时派生各平台图标。

## 已知限制

- 增删 profile bundle、切换模式、切换 profile 都需要重启；运行中的一代不会热替换 Loader 行或原生材质。
- Linux 只有兼容模式，也没有托盘终端。
- 托盘终端的 `dsh` / `pnpm` / `node` 只对该终端生效；Windows 下它们是 `.cmd` shim，`spawn('pnpm', { shell: false })` 这类直接调用不可移植。
- Preview 安装包未签名；macOS 的 Gatekeeper 与 Windows 的 SmartScreen 提示是预期行为。
- 渲染进程与 Host 之间是回环 HTTP + WebSocket，不是 Electron IPC。

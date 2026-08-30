# 发布流程

发布完全由 Git tag 驱动，产物发到 GitHub Releases，下载站自动读取最新版本。

## 版本号

根目录、`dsh-plugin-desktop`、`dsh-plugin-gala` 三个 `package.json` 的 `version` 必须一致。预发布用 `X.Y.Z-preview.N`，正式版用 `X.Y.Z`。工作流会校验 tag 与 `version` 一致，不一致直接失败。

## 发 Preview（草稿 + 本机 Developer ID macOS 包）

```sh
# 1. 改三个 package.json 的 version，例如 2.1.0-preview.4
corepack yarn check
corepack yarn package:dir
git add package.json dsh-plugin-desktop/package.json dsh-plugin-gala/package.json docs/releases/v2.1.0-preview.4.md
git commit -m "chore: release 2.1.0-preview.4"
git tag -a v2.1.0-preview.4 -m "2.1.0-preview.4"
git push origin main v2.1.0-preview.4
```

`preview-release.yml` 会：

1. 在 Windows x64 runner 上生成 NSIS 安装包；
2. 在 macOS 14（Apple Silicon）runner 上跑 desktop 单测和 ad-hoc 打包/PTY 冒烟；该 macOS 包只保留为短期 Actions artifact，不进入 Release；
3. 只把 Windows 安装包放进一个尚未公开的 draft prerelease。

草稿出现后，在持有 Developer ID Application 证书和公证凭据的 Apple Silicon Mac 上执行：

```sh
corepack yarn dist:mac
DSH_MAC_RELEASE_TEAM_ID=<10位Team ID> corepack yarn publish:preview
```

`dist:mac` 会生成包含 Developer ID 签名、Hardened Runtime App 的 DMG/ZIP；DMG 容器也单独签名，App 与 DMG 都经过 Apple 公证并盖票。发布机必须启用 Gatekeeper，验证脚本会拒绝 `spctl --status` 不是 `assessments enabled` 的机器，并要求每次评估明确返回 `source=Notarized Developer ID`。`publish:preview` 只接受现有 draft prerelease：上传签名 macOS 资产后回下载全部文件，生成并再次回下载 `SHA256SUMS.txt`，检查资产白名单、大小、更新元数据、签名、公证、隔离属性和真实 PTY；全部通过后才将草稿公开。任何失败都会保留草稿，不覆盖旧 Preview。

Preview 即使在签名构建命令中写入 `desktopUpdateMode=signed-auto`，运行时也会根据预发布版本号强制降级为 `manual-release`：应用发现新版只会打开 Release 页面。

### Preview 专项验收

发布前除常规 `check`/打包验证外，必须从 Finder 启动后完成普通聊天、让 AI 创建并运行纯 HTML 小游戏、内置 `node`/`pnpm` 最小项目和多短进程构建；再在另一台 Apple Silicon Mac 从浏览器下载并重复验收。不得覆盖或删除 `v2.1.0-preview.2` Release。

## 发正式版（签名）

`signed-release.yml` 由 `vX.Y.Z` 形式的 tag 触发，需要以下 GitHub Actions Secrets：

| 平台 | Secret | 说明 |
| --- | --- | --- |
| Windows | `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` | Authenticode 证书（base64 的 .pfx）与密码 |
| macOS | `MAC_CERT_P12_BASE64`、`MACOS_SIGN_IDENTITY`、`MAC_CSC_KEY_PASSWORD` | Developer ID Application 证书、签名身份、导出密码 |
| macOS | `APPLE_KEYCHAIN_PROFILE`（可选 `APPLE_KEYCHAIN`） | 首选的公证凭据；由 `notarytool store-credentials` 预存 |
| macOS | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | CI 兼容输入；发布脚本通过标准输入暂存到一次性 Keychain，不把密码写进命令行参数 |

macOS 任务运行 `yarn dist:mac`：先跑完整 `check`，再签名、公证、盖票，最后用 `hdiutil` / `codesign` / `syspolicy_check` / `spctl` / `stapler` 校验 DMG 和其中的 App。`notarytool submit --wait` 最多等待 30 分钟，超时只停止本机轮询，Apple 服务器仍会继续处理。Windows 任务校验 Authenticode 签名。正式版安装包的 `desktopUpdateMode` 写入 `signed-auto`，应用据此启用 electron-updater（下载与安装前各确认一次）。

`yarn dist:mac` 会强制打开 Hardened Runtime 与公证，并使用 `build/entitlements.mac.plist` 和 `entitlements.mac.inherit.plist` 为 Electron 主进程及 Helper 提供 JIT、未签名可执行内存与动态库加载权限。CI 的 macOS Preview 冒烟包仍是 ad-hoc 签名且绝不上传到 Release；公开的 macOS Preview 必须来自本机签名发布流程。

## 下载站

`site/` 是静态页，推送到 `main` 后由 `pages.yml` 部署到 GitHub Pages。页面在浏览器里调用 GitHub Releases API，优先展示最新正式版，没有正式版时展示最新 Preview，并按访客系统给出对应安装包。发新版本不需要改页面。

`site/scripts/build-site-assets.mjs` 从 `dsh-plugin-gala` 生成页面用的角色缩略图与 `site/data/characters.json`；角色或皮肤数据变动后重新运行并提交产物。

## 本地验证

- `corepack yarn check`：构建、类型、测试、闭包与 Loader smoke。
- `corepack yarn package:dir`：生成本机未签名 `.app`（macOS），检查 `dist/mac-arm64/`。
- `corepack yarn dist:win`：只能在 Windows x64 主机上运行；CI 已覆盖。

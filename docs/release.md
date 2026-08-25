# 发布流程

发布完全由 Git tag 驱动，产物发到 GitHub Releases，下载站自动读取最新版本。

## 版本号

根目录、`dsh-plugin-desktop`、`dsh-plugin-gala` 三个 `package.json` 的 `version` 必须一致。预发布用 `X.Y.Z-preview.N`，正式版用 `X.Y.Z`。工作流会校验 tag 与 `version` 一致，不一致直接失败。

## 发 Preview（ad-hoc 临时签名）

```sh
# 1. 改三个 package.json 的 version，例如 2.1.0-preview.2
corepack yarn check
git commit -am "chore: release 2.1.0-preview.2"
git tag -a v2.1.0-preview.2 -m "2.1.0-preview.2"
git push origin main v2.1.0-preview.2
```

`preview-release.yml` 会：

1. 在 Windows x64 runner 上生成 NSIS 安装包；
2. 在 macOS 14（Apple Silicon）runner 上对完整 App 做 ad-hoc 临时签名，生成 DMG 与 ZIP，并用 `codesign --deep --strict` 与 `hdiutil verify` 阻止结构不完整的包进入 Release；
3. 计算 `SHA256SUMS.txt`，创建标记为 *Prerelease* 的 GitHub Release，Release 说明里注明 Gatekeeper / SmartScreen 提示。

Preview 安装包的 `desktopUpdateMode` 固定为 `manual-release`：应用发现新版只会打开 Release 页面。

### `2.1.0-preview.2` 专项验收

发布前除常规 `check`/打包验证外，必须完成：v1 `skins.json` 迁移、首次全员默认、恢复原装后重启、开启独立空间后两个角色往返、角色插件状态隔离、关闭独立空间回公共 Profile，以及一次人为破坏目标 bundle 的 last-known-good 回滚。不得覆盖或改写既有 `v2.1.0-preview.1` Release。

## 发正式版（签名）

`signed-release.yml` 由 `vX.Y.Z` 形式的 tag 触发，需要以下 GitHub Actions Secrets：

| 平台 | Secret | 说明 |
| --- | --- | --- |
| Windows | `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` | Authenticode 证书（base64 的 .pfx）与密码 |
| macOS | `MAC_CERT_P12_BASE64`、`MACOS_SIGN_IDENTITY`、`MAC_CSC_KEY_PASSWORD` | Developer ID Application 证书、签名身份、导出密码 |
| macOS | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | 公证凭据 |

macOS 任务运行 `yarn dist:mac`：先跑完整 `check`，再签名、公证、盖票，最后用 `codesign` / `spctl` / `stapler` 校验 DMG 与 ZIP。Windows 任务校验 Authenticode 签名。正式版安装包的 `desktopUpdateMode` 写入 `signed-auto`，应用据此启用 electron-updater（下载与安装前各确认一次）。

签名正式版发布前需要在 `dsh-plugin-desktop/package.json` 打开 `mac.hardenedRuntime` 并提供 `build/entitlements.mac.plist` 与 `entitlements.mac.inherit.plist`（允许 JIT 与未签名可执行内存），否则公证会被 Apple 拒绝。

## 下载站

`site/` 是静态页，推送到 `main` 后由 `pages.yml` 部署到 GitHub Pages。页面在浏览器里调用 GitHub Releases API，优先展示最新正式版，没有正式版时展示最新 Preview，并按访客系统给出对应安装包。发新版本不需要改页面。

`site/scripts/build-site-assets.mjs` 从 `dsh-plugin-gala` 生成页面用的角色缩略图与 `site/data/characters.json`；角色或皮肤数据变动后重新运行并提交产物。

## 本地验证

- `corepack yarn check`：构建、类型、测试、闭包与 Loader smoke。
- `corepack yarn package:dir`：生成本机未签名 `.app`（macOS），检查 `dist/mac-arm64/`。
- `corepack yarn dist:win`：只能在 Windows x64 主机上运行；CI 已覆盖。

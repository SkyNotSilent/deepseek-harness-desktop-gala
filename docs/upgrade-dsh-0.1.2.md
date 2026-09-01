# DSH 0.1.2 兼容升级维护说明

当前产品版本为 `2.2.0-preview.1`，运行时固定为官方 npm 发布的 `0.1.2-alpha.2`，对应上游 tag `dsh-v0.1.2-alpha.2`、commit `0a53fb55bea101816fa226bb964ae2bed71c343b`。alpha 运行时只能进入 Preview；稳定版至少等待上游 RC。

## 固化的运行时闭包

`vendor/dsh-runtime/0.1.2-alpha.2/` 包含上游该 commit 的 245 个公开包，不包含 9 个 private 包。每个 tarball 必须与 npm registry 的 `dist.integrity` 字节一致；`manifest.json` 记录 SHA-256、SHA-512 integrity、包内 name/version 和许可证，`licenses.json` 是独立许可证清单。

```sh
corepack yarn verify:dsh-runtime
corepack yarn verify:dsh-runtime:registry
corepack yarn install --immutable
```

第一条离线校验闭包、tar 元数据、root resolutions、lockfile 和七个补丁在 registry 原始 tarball 上的 clean apply。第二条联网向 npm registry 复核全部 245 个 SHA-512 integrity。

需要重新取得 registry 原始字节时运行 `corepack yarn vendor:dsh-runtime:registry`。脚本先写 staging 目录，全部 245 包通过后才原子替换目标 vendor 目录。

## 版本工具边界

```sh
corepack yarn set:dsh-version <目标版本> --dry-run
corepack yarn set:dsh-version <目标版本>
```

目标版本的完整 vendor 目录和版本化补丁必须事先存在。工具会在写入前校验：

- 当前与目标 vendor manifest、tar 大小与双哈希、包内 name/version/许可证；
- 当前和目标包集合完全相同；闭包变化必须先由人工完成兼容改造；
- patch inventory 完全相同，且目标补丁全部在目标 registry tarball 上 clean apply；
- 三份产品 manifest 的所有 DSH 依赖属于目标闭包；
- 根 `resolutions` 与当前 vendor manifest 精确一致。

成功时，工具只更新 `upstream.json`、三份 `package.json` 的 DSH pin 和根 `resolutions`。它不会下载或生成 vendor、不会改 `yarn.lock`、不会运行安装，也不会执行 `git add`/`git mv`。自身失败会把已写受管文件恢复为原始字节；`--dry-run` 写入零文件。

## alpha.2 迁移点

- 删除上游已移除的 `@deepseek-ai/dsh-client-runtime` 与 `@deepseek-ai/dsh-host-apiproxy`，改用拆分后的 session/workspace controller、ui-chat、util-time 等包。
- Client 统一使用 Cordis `Context` 和 alpha.2 公共服务；Turn Error 节点跟随 alpha.2 类型。
- New Session workaround 包装公开的 `uiWorkspace.startSession`，通过独立 `sessions`/`workspaces` controller 处理同工作区当前空白会话。
- Desktop/Gala 使用 alpha.2 settings API；`dsh-settings` 补丁只保留旧插件仍会导入的三个 legacy helper。
- 主窗口先通过 `connection.authenticatedUrl()` 生成的干净 origin URL交换 cookie，再加载保留桌面查询参数的 renderer URL。Gala panel 共享主窗口 Electron session，所有桌面 sibling routes 经过 `connection.requestRejection()`。
- Windows ACL 兼容修复移到 `dsh-win32-process`；目录选择、子进程与浏览器 helper 环境补丁各自版本化。Gala 自有 node-pty ASAR 修复继续保留。

## 产品默认行为

- Desktop 无条件禁用 session telemetry；会话日志上传保持关闭。
- `dsh_plugin_packages` 插件包名/版本清单上报按 alpha.2 默认保持启用。
- WebFetch 分层跟随上游：base/global disabled，默认 `standard` 与 `ptc`/`cordis` preset 启用，`minimal` 不启用；启用后不逐次审批。
- 会话记录只按上游方向单向原地升级，不承诺降级兼容。

用户可见披露位于[用户指南](user-guide.md)和 [`v2.2.0-preview.1` 候选说明](releases/v2.2.0-preview.1.md)。

## 合并门槛

先运行根 `check`、registry integrity、immutable install 和本机 package gate，再由独立 QA 从候选 SHA 的 clean clone 全量复验。Linux、macOS ARM64、Windows x64 的原生构建/PTY/安装，以及 assembled sidebar、旧 Preview 数据副本升级和跨电脑浏览器下载均是独立 gate。任一 gate 没有证据时，不得宣称“已兼容”，也不得创建 Preview tag 或 release。

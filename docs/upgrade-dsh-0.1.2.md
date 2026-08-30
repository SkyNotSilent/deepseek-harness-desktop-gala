# 升级到上游 DSH 0.1.2

当前上游运行时固定在 `0.1.1-rc.2`。这份文档只讲怎么把它抬到 `0.1.2`，以及哪些活工具链替不了。

## 前置阻塞：npm 上还没有 0.1.2

```sh
npm view @deepseek-ai/dsh dist-tags   # latest 与 next 都是 0.1.1-rc.2
```

`dsh-v0.1.2-alpha.1` 目前只是上游 GitHub 上的 tag，没发到 npm，`yarn install` 拿不到，所以升级动作现在做不了。等 npm 出包后再动。

alpha 只允许进 Preview 构建，不得进签名正式版；正式版必须等上游至少发到 `rc`。

## 一条命令抬版本

把 `<新版本>` 换成 npm 上真实存在的版本号（例如上游发到 `0.1.2-rc.1` 之后就写 `0.1.2-rc.1`），不要照抄占位符：

```sh
yarn set:dsh-version <新版本>
yarn install
yarn check
```

`set:dsh-version` 只做形式校验，不查 npm 有没有这个版本：任何合法 semver 都会被接受并写进三个 `package.json`，`rc.x` 这种「看着像占位符、其实是合法 semver 预发布标识」也会被照写。写错了要靠 `yarn install` 报错发现，回退需要 `yarn set:dsh-version <旧版本> --allow-downgrade`。先跑一次 `--dry-run` 看计划再执行。

`set:dsh-version` 会改三个 `package.json` 里所有精确等于当前 pin 的 `@deepseek-ai/dsh*` 依赖、根 `resolutions` 的两条 Windows ACL 补丁条目（含 `%3A` 编码与补丁文件名），并用 `git mv` 重命名 `patches/dsh-sandbox-windows-acl@<版本>.patch`。`@deepseek-ai/cordis*` 与 `@deepseek-ai/schemastery` 独立发版，脚本不碰；带 build metadata（`+`）的版本号会被拒绝，因为补丁文件名与 Yarn patch 描述符放不下 `+`。已经偏离当前 pin 的运行时依赖不会被改写，只会在输出里列成 `skipped ... off-version runtime pins`，需要手工处理。

`yarn check` 里的 `verify:dsh-version` 会拦住版本漂移：任何 `@deepseek-ai/dsh*` 依赖、补丁文件名、`resolutions` 或 README / 下载站里写的上游版本号跟 pin 不一致就失败。README、`README.en.md`、`site/` 里的上游版本号仍需手改，脚本不动文案。

### 漂移检查的已知盲区

文案那一项靠正则识别「`Harness` 或 `上游` 紧跟版本号」这个句式（`scripts/dsh-version.mjs` 的 `PROSE_SERIES_PATTERN`）。当前 5 处活文案全部命中，`docs/releases/` 里的历史版本号被正确忽略。但改写句式就会让检查静默失效——例如「跟随上游 DSH 0.1.0 运行时」「Tracks the DeepSeek Harness runtime 0.1.0 release」这两种写法都不会被抓到。改动这几处文案的措辞时，要么保持 `Harness <版本>` / `上游 <版本>` 的紧邻句式，要么同步改正则。

## 工具链替不了的破坏性改动

### 1. 删掉 `@deepseek-ai/dsh-host-apiproxy`

上游用 `@Remote` 网关取代了旧的 ApiProxy 接口。这个包没有任何源码 `import`，只作为运行时闭包依赖挂在 `dsh-plugin-desktop/package.json:164` 与 `dsh-plugin-gala/package.json:95`，直接删两行即可。判断依据是 `yarn verify:closure`（`dsh-plugin-desktop` 的 `verify:closure`）：闭包不再要求它，就说明可以删。

### 2. 会话 UI 分层重构

上游把会话界面拆成了分层模块。Gala 同时消费 `@deepseek-ai/dsh-client-ui-conversation`、`-slots`、`-sidebar`、`-theme`、`-primitives`、`-settings` 和 `dsh-client-runtime`（`dsh-plugin-gala/package.json` 的 `devDependencies` 与 `peerDependencies` 两处都有），import 路径与 slot 名预计都会挪位置。这是整个升级里最大的一块，靠 `yarn typecheck` 逐个暴露。

### 3. 复检 `new-session-fix.ts`，不要直接删

`dsh-plugin-desktop/src/client/new-session-fix.ts:31` 用 `publicWorkspaces as WorkspaceRuntimeWithSessions` 把运行时私有的 `sessions` API 断言成了手写形状，并 monkey-patch 了 `workspaces.startSession`。形状一变，编译照样通过，只在运行时静默失效。

上游 0.1.2 修的是一个**相关但不同**的空会话 bug，所以必须先跑 `dsh-plugin-desktop/tests/client-new-session-current-blank.spec.ts`，再手动点一次「新建会话」确认上游已经修对，才能删这个 workaround。

### 4. 先验证启动 URL 是否需要一次性 token

上游现在要求经网络访问 Web UI 时在启动 URL 里带一次性 token。桌面壳加载的是 `desktopRendererUrl()`（`dsh-plugin-desktop/src/index.ts:72`，在 `src/index.ts:160` 被使用）拼出的 `http://127.0.0.1:<port>/?dsh-desktop-mode=...`，Gala 面板窗口另有两处 `loadURL`（`dsh-plugin-desktop/src/gala-electron.ts:71` 与 `:89`）。

回环地址大概率豁免；如果不豁免，症状是启动后白窗。**升级后第一件事就验这个。**

### 5. 会话记录存储格式又变了

上游此前已明确宣告过一次格式不兼容，这次又改。按单向升级处理：从当前已发布的 Preview 做一次原地升级实测，并在 release notes 里写清降级后果（旧版读不回新格式的记录）。

### 6. 两个默认开启的上游行为，都对用户可见

- 官方 adapter 每次请求都会带上已启用插件的包名与版本，会泄露 `dsh-plugin-gala` 及其版本。决定是否用配置关掉；无论关不关，都要在用户指南里披露。
- 公网 WebFetch 不再需要逐次审批。
- 会话日志上传仍保持关闭，升级后确认一遍。

### 7. `Code mode` 改名 `PTC mode`

扫一遍 Gala 人格与预设文案里的旧名。当前仓库检索不到 `Code mode` / `代码模式` 字样，但上游改名后随上游文案变化的部分仍需复检。

## 验证与发布

`yarn check` 过了之后，按 [发布流程](release.md) 走 Preview 专项验收（Finder 启动、普通聊天、纯 HTML 小游戏、内置 `node`/`pnpm` 最小项目、多短进程构建，再换一台 Apple Silicon Mac 从浏览器下载复验）。

建议按 MINOR 发布，即 `2.2.0-preview.1`：运行时、权限默认值、可能还有磁盘上的记录格式三样都变了。

三个 `package.json` 的 `version` 应当一致，但实际拦住不一致的只有两道，且都不覆盖 `dsh-plugin-gala`：

- `preview-release.yml:29` 与 `signed-release.yml:30`、`:78` 只把**根** `package.json` 的 `version` 和 `GITHUB_REF_NAME` 比对；
- `dsh-plugin-desktop/tests/package.spec.ts:162` 只断言 `dsh-plugin-desktop` 的 `version` 等于根的 `version`。

也就是说 `dsh-plugin-gala/package.json` 的 `version` 写错不会让任何流程失败，只能靠人。`docs/release.md:7` 写的「三个必须一致，不一致直接失败」这句话对前半句成立、对后半句不成立；这份文档不去改它，但这个缺口应当单独补一条校验来堵。

`yarn check:upstream-dsh` 比对当前 pin 与 npm 上已发布的版本，随时可以手动跑。配套的 `.github/workflows/upstream-watch.yml` 每周自动跑一次并更新同一个 `upstream-watch` issue；推送 workflow 文件需要带 `workflow` scope 的凭据，在它落地之前先手动跑脚本。
